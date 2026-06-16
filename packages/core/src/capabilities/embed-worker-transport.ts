/**
 * Off-main-thread query-embedding transport for the semantic capability.
 *
 * The semantic capability consumes a single `EmbedFunction`
 * (`(texts: string[]) => Promise<number[][]>`). With `executionMode="worker"`
 * (#146) the PGlite DB + HNSW query run off the main thread, but a
 * main-thread `EmbedFunction` closure still blocks the UI: model load janks
 * first paint of search, and every per-query embed blocks input.
 *
 * This module lets the host run the embed function inside a Worker (or behind
 * a MessagePort) so semantic search is off-thread end-to-end. Core posts
 * `{ texts }` to the port and awaits `number[][]`; the host owns the worker,
 * the model, and the model params (so build-time corpus embeddings stay an
 * exact match: `Xenova/all-MiniLM-L6-v2`, fp32, `{ pooling:'mean', normalize:true }`,
 * 384-d).
 *
 * Two halves:
 *  - {@link createWorkerEmbedFunction} — main-thread side. Wraps a transport
 *    into an `EmbedFunction` that round-trips each request to the worker.
 *  - {@link handleEmbedRequests} — worker side. Wires a host-owned
 *    `(texts) => Promise<number[][]>` to the message protocol.
 *
 * The existing main-thread `registerSemanticCapability(manager, embedFn)` path
 * is unchanged. This transport is additive and opt-in.
 *
 * @implements #180 off-main-thread / pluggable query-embedding transport
 */

import type { EmbedFunction } from './embedding-handler.js'

/**
 * Minimal transport contract satisfied by both `Worker` and `MessagePort`.
 * Core only needs to post messages and listen for replies.
 */
export interface EmbedTransportPort {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  /** MessagePort requires start() when using addEventListener; Worker does not. */
  start?(): void
}

/** Message discriminators for the embed protocol. */
export const EMBED_REQUEST_KIND = 'fortemi:embed:request' as const
export const EMBED_RESPONSE_KIND = 'fortemi:embed:response' as const

/** Request posted by core (main thread) to the worker. */
export interface EmbedRequestMessage {
  kind: typeof EMBED_REQUEST_KIND
  id: number
  texts: string[]
}

/** Reply posted by the worker back to core. Exactly one of `vectors`/`error`. */
export interface EmbedResponseMessage {
  kind: typeof EMBED_RESPONSE_KIND
  id: number
  vectors?: number[][]
  error?: string
}

/** Options for the main-thread worker embed function. */
export interface EmbedWorkerOptions {
  /**
   * Per-request timeout in milliseconds. A request that receives no reply
   * within this window rejects with a timeout error. Set to `0` to disable.
   * Default: 30000 (30s).
   */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

function isEmbedResponse(data: unknown): data is EmbedResponseMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === EMBED_RESPONSE_KIND &&
    typeof (data as { id?: unknown }).id === 'number'
  )
}

function isEmbedRequest(data: unknown): data is EmbedRequestMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === EMBED_REQUEST_KIND &&
    typeof (data as { id?: unknown }).id === 'number' &&
    Array.isArray((data as { texts?: unknown }).texts)
  )
}

interface PendingRequest {
  resolve: (vectors: number[][]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Wrap a Worker/MessagePort transport into an `EmbedFunction` (main-thread side).
 *
 * Each `embed(texts)` call posts an {@link EmbedRequestMessage} with a unique id
 * and resolves when the matching {@link EmbedResponseMessage} arrives. The
 * message listener is attached immediately and removed by `dispose()`.
 *
 * @param port - A `Worker`, `MessagePort`, or any {@link EmbedTransportPort}.
 * @param options - Optional timeout configuration.
 * @returns The `embed` function and a `dispose` cleanup (removes the listener
 *          and rejects any in-flight requests).
 *
 * @example
 * ```ts
 * const worker = new Worker(new URL('./queryEmbed.worker.ts', import.meta.url), { type: 'module' })
 * const { embed, dispose } = createWorkerEmbedFunction(worker)
 * setEmbedFunction(embed) // query + job embedding now run off-thread
 * // later: dispose(); worker.terminate()
 * ```
 */
export function createWorkerEmbedFunction(
  port: EmbedTransportPort,
  options?: EmbedWorkerOptions,
): { embed: EmbedFunction; dispose: () => void } {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pending = new Map<number, PendingRequest>()
  let nextId = 1
  let disposed = false

  const onMessage = (event: { data: unknown }): void => {
    const data = event.data
    if (!isEmbedResponse(data)) return
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (entry.timer !== null) clearTimeout(entry.timer)
    if (data.error !== undefined) {
      entry.reject(new Error(data.error))
    } else if (Array.isArray(data.vectors)) {
      entry.resolve(data.vectors)
    } else {
      entry.reject(new Error('Embed worker returned a malformed response (no vectors, no error)'))
    }
  }

  port.addEventListener('message', onMessage)
  // MessagePort needs an explicit start() when using addEventListener.
  port.start?.()

  const embed: EmbedFunction = (texts: string[]): Promise<number[][]> => {
    if (disposed) {
      return Promise.reject(new Error('Embed worker transport has been disposed'))
    }
    return new Promise<number[][]>((resolve, reject) => {
      const id = nextId++
      let timer: ReturnType<typeof setTimeout> | null = null
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`Embed worker request timed out after ${timeoutMs}ms`))
          }
        }, timeoutMs)
      }
      pending.set(id, { resolve, reject, timer })
      try {
        const message: EmbedRequestMessage = { kind: EMBED_REQUEST_KIND, id, texts }
        port.postMessage(message)
      } catch (err) {
        pending.delete(id)
        if (timer !== null) clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    port.removeEventListener('message', onMessage)
    for (const [, entry] of pending) {
      if (entry.timer !== null) clearTimeout(entry.timer)
      entry.reject(new Error('Embed worker transport has been disposed'))
    }
    pending.clear()
  }

  return { embed, dispose }
}

/**
 * Wire a host-owned embed function to the message protocol (worker side).
 *
 * Call this inside the worker (or behind a MessagePort) with the function that
 * loads the model and runs inference. It answers each {@link EmbedRequestMessage}
 * with an {@link EmbedResponseMessage}.
 *
 * @param port - The worker scope (`self`) or a `MessagePort`.
 * @param embed - The host embed function `(texts) => Promise<number[][]>`.
 * @returns A disposer that removes the listener.
 *
 * @example
 * ```ts
 * // queryEmbed.worker.ts
 * import { handleEmbedRequests } from '@fortemi/core'
 * import { pipeline } from '@huggingface/transformers'
 *
 * const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
 * handleEmbedRequests(self as unknown as EmbedTransportPort, async (texts) => {
 *   const out = await Promise.all(
 *     texts.map(async (t) => {
 *       const r = await extractor(t, { pooling: 'mean', normalize: true })
 *       return Array.from(r.data as Float32Array)
 *     }),
 *   )
 *   return out
 * })
 * ```
 */
export function handleEmbedRequests(
  port: EmbedTransportPort,
  embed: EmbedFunction,
): () => void {
  const onMessage = (event: { data: unknown }): void => {
    const data = event.data
    if (!isEmbedRequest(data)) return
    const { id, texts } = data
    void Promise.resolve()
      .then(() => embed(texts))
      .then((vectors) => {
        const reply: EmbedResponseMessage = { kind: EMBED_RESPONSE_KIND, id, vectors }
        port.postMessage(reply)
      })
      .catch((err: unknown) => {
        const reply: EmbedResponseMessage = {
          kind: EMBED_RESPONSE_KIND,
          id,
          error: err instanceof Error ? err.message : String(err),
        }
        port.postMessage(reply)
      })
  }

  port.addEventListener('message', onMessage)
  port.start?.()

  return () => {
    port.removeEventListener('message', onMessage)
  }
}
