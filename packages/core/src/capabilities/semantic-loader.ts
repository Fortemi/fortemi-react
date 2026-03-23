/**
 * Semantic capability loader — registers the embedding pipeline with CapabilityManager.
 *
 * In production (browser), this loads @huggingface/transformers in a Web Worker.
 * In tests, call registerSemanticCapability() with a mock embed function.
 *
 * @implements #62 semantic capability loader
 */

import type { CapabilityManager } from '../capability-manager.js'
import { setEmbedFunction, type EmbedFunction } from './embedding-handler.js'

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
    // In real implementation: load transformers.js model here
    // For now, just wire the embed function
    setEmbedFunction(embedFn)
    if (onProgress) onProgress(100)
  })
}

/**
 * Unregister the semantic capability — clears the embed function.
 * Called when the capability is disabled.
 */
export function unregisterSemanticCapability(): void {
  setEmbedFunction(null)
}
