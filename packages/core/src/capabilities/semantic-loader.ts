/**
 * Semantic capability loader — registers the embedding pipeline with CapabilityManager.
 *
 * In production (browser), this loads @huggingface/transformers in a Web Worker.
 * In tests, call registerSemanticCapability() with a mock embed function.
 *
 * Two registration paths, both additive:
 *  - registerSemanticCapability(manager, embedFn) — main-thread embed closure.
 *  - registerSemanticCapabilityWorker(manager, port) — off-main-thread embed
 *    transport (#180), so semantic search runs off-thread end-to-end.
 *
 * @implements #62 semantic capability loader
 * @implements #180 off-main-thread / pluggable query-embedding transport
 */

import type { CapabilityManager } from '../capability-manager.js'
import { setEmbedFunction, type EmbedFunction } from './embedding-handler.js'
import {
  createWorkerEmbedFunction,
  type EmbedTransportPort,
  type EmbedWorkerOptions,
} from './embed-worker-transport.js'

/**
 * Cleanup for the currently-wired transport, if any. The worker path installs a
 * disposer (removes the message listener); the main-thread path leaves it null.
 * Tracked at module scope so unregisterSemanticCapability() can tear it down.
 */
let activeTransportDispose: (() => void) | null = null

function clearActiveTransport(): void {
  if (activeTransportDispose) {
    activeTransportDispose()
    activeTransportDispose = null
  }
}

/**
 * Register the semantic capability with a CapabilityManager.
 * The loader will be called when capabilityManager.enable('semantic') is invoked.
 *
 * @param manager - The CapabilityManager instance
 * @param embedFn - The embedding function (from transformers.js worker or mock)
 * @param onProgress - Optional progress callback for model download
 */
export function registerSemanticCapability(
  manager: CapabilityManager,
  embedFn: EmbedFunction,
  onProgress?: (pct: number) => void,
): void {
  manager.registerLoader('semantic', async () => {
    if (onProgress) onProgress(0)
    // Switching registration paths: drop any previously-wired transport.
    clearActiveTransport()
    // In real implementation: load transformers.js model here
    // For now, just wire the embed function
    setEmbedFunction(embedFn)
    if (onProgress) onProgress(100)
  })
}

/**
 * Register the semantic capability backed by an off-main-thread transport (#180).
 *
 * The embed function round-trips each request to a host-owned Worker/MessagePort,
 * so model load and per-query inference never touch the main thread. The host
 * owns the worker and the model params (build-time corpus match stays exact).
 *
 * The loader runs when `capabilityManager.enable('semantic')` is invoked; the
 * message listener is attached then and removed on
 * {@link unregisterSemanticCapability} (i.e. on `disable`).
 *
 * @param manager - The CapabilityManager instance.
 * @param port - A `Worker`, `MessagePort`, or any {@link EmbedTransportPort}.
 * @param options - Optional transport options (e.g. per-request timeout).
 *
 * @example
 * ```ts
 * const worker = new Worker(new URL('./queryEmbed.worker.ts', import.meta.url), { type: 'module' })
 * registerSemanticCapabilityWorker(capabilityManager, worker)
 * await capabilityManager.enable('semantic') // off-thread end-to-end
 * ```
 */
export function registerSemanticCapabilityWorker(
  manager: CapabilityManager,
  port: EmbedTransportPort,
  options?: EmbedWorkerOptions,
): void {
  manager.registerLoader('semantic', async () => {
    // Re-enabling: tear down a prior transport before wiring a fresh one.
    clearActiveTransport()
    const { embed, dispose } = createWorkerEmbedFunction(port, options)
    activeTransportDispose = dispose
    setEmbedFunction(embed)
  })
}

/**
 * Unregister the semantic capability — clears the embed function and tears down
 * any active off-main-thread transport. Called when the capability is disabled.
 */
export function unregisterSemanticCapability(): void {
  setEmbedFunction(null)
  clearActiveTransport()
}
