/**
 * Off-main-thread query-embedding transport tests (#180).
 *
 * Exercises the full message protocol with a linked fake-port pair that
 * mimics a Worker/MessagePort channel (async microtask delivery), plus the
 * semantic-loader worker registration path.
 *
 * @implements #180 off-main-thread / pluggable query-embedding transport
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createWorkerEmbedFunction,
  handleEmbedRequests,
  EMBED_REQUEST_KIND,
  EMBED_RESPONSE_KIND,
  type EmbedTransportPort,
} from '../capabilities/embed-worker-transport.js'
import {
  registerSemanticCapabilityWorker,
  registerSemanticCapability,
  unregisterSemanticCapability,
} from '../capabilities/semantic-loader.js'
import { getEmbedFunction, setEmbedFunction, type EmbedFunction } from '../capabilities/embedding-handler.js'
import { CapabilityManager } from '../capability-manager.js'
import { TypedEventBus } from '../event-bus.js'

// ---------------------------------------------------------------------------
// Linked fake-port pair — postMessage on one delivers to the other's listeners
// asynchronously via microtask, mimicking a real MessageChannel / Worker.
// ---------------------------------------------------------------------------

type Listener = (event: { data: unknown }) => void

function createLinkedPorts(): { a: EmbedTransportPort; b: EmbedTransportPort } {
  const aListeners = new Set<Listener>()
  const bListeners = new Set<Listener>()

  const deliver = (listeners: Set<Listener>, data: unknown): void => {
    queueMicrotask(() => {
      for (const l of [...listeners]) l({ data })
    })
  }

  const a: EmbedTransportPort = {
    postMessage: (message) => deliver(bListeners, message),
    addEventListener: (_t, l) => { aListeners.add(l) },
    removeEventListener: (_t, l) => { aListeners.delete(l) },
    start: () => {},
  }
  const b: EmbedTransportPort = {
    postMessage: (message) => deliver(aListeners, message),
    addEventListener: (_t, l) => { bListeners.add(l) },
    removeEventListener: (_t, l) => { bListeners.delete(l) },
    start: () => {},
  }
  return { a, b }
}

/** Deterministic worker-side embed: one 4-dim vector per text, seeded by length. */
const workerEmbed: EmbedFunction = (texts) =>
  Promise.resolve(texts.map((t) => [t.length, t.charCodeAt(0) || 0, 0, 1]))

// ---------------------------------------------------------------------------

describe('createWorkerEmbedFunction + handleEmbedRequests', () => {
  it('round-trips texts → vectors through the transport', async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    const { embed, dispose } = createWorkerEmbedFunction(a)

    const out = await embed(['a', 'bb'])
    expect(out).toEqual([
      [1, 97, 0, 1],
      [2, 98, 0, 1],
    ])

    dispose()
    stopWorker()
  })

  it('matches concurrent requests to their own replies by id', async () => {
    const { a, b } = createLinkedPorts()
    // Worker echoes the first text length so we can tell responses apart.
    const stopWorker = handleEmbedRequests(b, (texts) =>
      Promise.resolve([[texts.length, texts[0].length, 0, 0]]),
    )
    const { embed, dispose } = createWorkerEmbedFunction(a)

    const [r1, r2, r3] = await Promise.all([
      embed(['x']),
      embed(['yy', 'zz']),
      embed(['www']),
    ])
    expect(r1).toEqual([[1, 1, 0, 0]])
    expect(r2).toEqual([[2, 2, 0, 0]])
    expect(r3).toEqual([[1, 3, 0, 0]])

    dispose()
    stopWorker()
  })

  it('works when the transport has no start() (real Worker has none)', async () => {
    const { a, b } = createLinkedPorts()
    const noStart = { ...a, start: undefined } as EmbedTransportPort
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    const { embed, dispose } = createWorkerEmbedFunction(noStart)

    await expect(embed(['hi'])).resolves.toEqual([[2, 104, 0, 1]])
    dispose()
    stopWorker()
  })

  it('propagates a worker-side error as a rejected promise', async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, () => Promise.reject(new Error('model OOM')))
    const { embed, dispose } = createWorkerEmbedFunction(a)

    await expect(embed(['anything'])).rejects.toThrow('model OOM')
    dispose()
    stopWorker()
  })

  it('rejects on a malformed response (neither vectors nor error)', async () => {
    const { a, b } = createLinkedPorts()
    // Worker that replies with the right id/kind but no payload.
    b.addEventListener('message', (event) => {
      const data = event.data as { kind?: string; id?: number }
      if (data?.kind === EMBED_REQUEST_KIND) {
        b.postMessage({ kind: EMBED_RESPONSE_KIND, id: data.id })
      }
    })
    const { embed, dispose } = createWorkerEmbedFunction(a)

    await expect(embed(['q'])).rejects.toThrow(/malformed response/)
    dispose()
  })

  it('ignores foreign (non-embed) messages on the port', async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    const { embed, dispose } = createWorkerEmbedFunction(a)

    // Inject unrelated traffic both directions; must not crash or resolve embed.
    b.postMessage({ kind: 'some-other-protocol', id: 999 })
    a.postMessage('a bare string')

    await expect(embed(['ok'])).resolves.toEqual([[2, 111, 0, 1]])
    dispose()
    stopWorker()
  })

  it('rejects in-flight requests when disposed', async () => {
    const { a } = createLinkedPorts()
    // No worker wired → the request never gets a reply.
    const { embed, dispose } = createWorkerEmbedFunction(a, { timeoutMs: 0 })
    const pending = embed(['never answered'])
    dispose()
    await expect(pending).rejects.toThrow(/disposed/)
  })

  it('rejects new requests after dispose', async () => {
    const { a } = createLinkedPorts()
    const { embed, dispose } = createWorkerEmbedFunction(a, { timeoutMs: 0 })
    dispose()
    await expect(embed(['too late'])).rejects.toThrow(/disposed/)
  })

  it('rejects when postMessage throws', async () => {
    const throwingPort: EmbedTransportPort = {
      postMessage: () => {
        throw new Error('port closed')
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    const { embed, dispose } = createWorkerEmbedFunction(throwingPort, { timeoutMs: 0 })
    await expect(embed(['x'])).rejects.toThrow('port closed')
    dispose()
  })

  it("handleEmbedRequests' disposer stops answering", async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    const { embed, dispose } = createWorkerEmbedFunction(a, { timeoutMs: 0 })

    await expect(embed(['first'])).resolves.toBeTruthy()
    stopWorker()
    // After the worker disposer runs, requests hang (no reply).
    let settled = false
    const p = embed(['second']).then(() => { settled = true }).catch(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    dispose() // cleans up the now-hanging request
    await p
  })

  describe('per-request timeout', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('rejects with a timeout error when no reply arrives', async () => {
      const { a } = createLinkedPorts() // no worker
      const { embed, dispose } = createWorkerEmbedFunction(a, { timeoutMs: 5000 })
      const pending = embed(['slow'])
      // Pre-attach a handler so the timer-driven rejection (fired inside
      // advanceTimersByTimeAsync) is never momentarily "unhandled".
      pending.catch(() => {})
      await vi.advanceTimersByTimeAsync(5000)
      await expect(pending).rejects.toThrow(/timed out after 5000ms/)
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Semantic-loader worker registration path
// ---------------------------------------------------------------------------

describe('registerSemanticCapabilityWorker', () => {
  let manager: CapabilityManager

  beforeEach(() => {
    manager = new CapabilityManager(new TypedEventBus())
  })

  afterEach(() => {
    unregisterSemanticCapability()
    setEmbedFunction(null)
  })

  it('wires an off-thread embed function on enable()', async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    registerSemanticCapabilityWorker(manager, a)

    expect(getEmbedFunction()).toBeNull() // not wired until enabled
    await manager.enable('semantic')
    expect(manager.isReady('semantic')).toBe(true)

    const fn = getEmbedFunction()
    expect(fn).not.toBeNull()
    await expect(fn!(['enabled'])).resolves.toEqual([[7, 101, 0, 1]])

    stopWorker()
  })

  it('tears down the transport on unregister (disable)', async () => {
    const { a, b } = createLinkedPorts()
    const stopWorker = handleEmbedRequests(b, workerEmbed)
    registerSemanticCapabilityWorker(manager, a)
    await manager.enable('semantic')
    const fn = getEmbedFunction()!

    unregisterSemanticCapability()
    expect(getEmbedFunction()).toBeNull()
    // The disposed transport rejects further calls.
    await expect(fn(['after-disable'])).rejects.toThrow(/disposed/)
    stopWorker()
  })

  it('does not disturb the existing main-thread registration path', async () => {
    const mainThreadEmbed: EmbedFunction = (texts) => Promise.resolve(texts.map(() => [9, 9, 9, 9]))
    registerSemanticCapability(manager, mainThreadEmbed)
    await manager.enable('semantic')
    expect(getEmbedFunction()).toBe(mainThreadEmbed)
  })
})
