import { useState, useCallback, useEffect, useRef } from 'react'
import {
  createWorkerEmbedFunction,
  setEmbedFunction,
  type EmbedTransportPort,
  type EmbedWorkerOptions,
} from '@fortemi/core'

export type EmbeddingWorkerStatus = 'idle' | 'connected'

export interface UseEmbeddingWorkerReturn {
  status: EmbeddingWorkerStatus
  /** Wire the worker transport into the core embed function (query + job embedding). */
  connect: () => void
  /** Tear down the transport and clear the core embed function. */
  disconnect: () => void
}

/**
 * Wire a host-owned Worker/MessagePort into the semantic capability so that
 * semantic search runs off the main thread end-to-end (#180).
 *
 * Unlike {@link useEmbeddingPipeline} — which loads the model on the main thread
 * — this hook hands every embed request to a worker the host owns. There is no
 * main-thread model load and no main-thread per-query inference. The host keeps
 * full control of the model and its params (so build-time corpus embeddings stay
 * an exact match).
 *
 * The transport is wired on `connect()` and torn down on `disconnect()` or unmount.
 * The host is responsible for the worker's own lifecycle (e.g. `worker.terminate()`).
 *
 * @example
 * ```tsx
 * const worker = useMemo(
 *   () => new Worker(new URL('./queryEmbed.worker.ts', import.meta.url), { type: 'module' }),
 *   [],
 * )
 * const { status, connect } = useEmbeddingWorker(worker)
 * useEffect(() => connect(), [connect])
 * ```
 */
export function useEmbeddingWorker(
  transport: EmbedTransportPort,
  options?: EmbedWorkerOptions,
): UseEmbeddingWorkerReturn {
  const [status, setStatus] = useState<EmbeddingWorkerStatus>('idle')
  const disposeRef = useRef<(() => void) | null>(null)

  const disconnect = useCallback(() => {
    if (disposeRef.current) {
      disposeRef.current()
      disposeRef.current = null
    }
    setEmbedFunction(null)
    setStatus('idle')
  }, [])

  const connect = useCallback(() => {
    // Re-connecting: drop any prior transport first.
    if (disposeRef.current) disposeRef.current()
    const { embed, dispose } = createWorkerEmbedFunction(transport, options)
    disposeRef.current = dispose
    setEmbedFunction(embed)
    setStatus('connected')
  }, [transport, options])

  // Tear down on unmount so a stale listener never outlives the component.
  useEffect(() => () => disconnect(), [disconnect])

  return { status, connect, disconnect }
}
