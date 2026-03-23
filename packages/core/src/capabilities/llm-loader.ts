/**
 * LLM capability loader — registers the local LLM with CapabilityManager.
 *
 * In production (browser), this loads @mlc-ai/web-llm in a Web Worker.
 * In tests, call registerLlmCapability() with a mock completion function.
 *
 * @implements #65 LLM capability loader
 */

import type { CapabilityManager } from '../capability-manager.js'
import { setLlmFunction, type LlmCompleteFn } from './llm-handler.js'
import { detectGpuCapabilities, estimateVramTier, selectLlmModel } from './gpu-detect.js'

export interface LlmCapabilityOptions {
  modelOverride?: string  // Force specific model (bypass VRAM detection)
  onProgress?: (pct: number, text: string) => void
}

/**
 * Register the LLM capability with a CapabilityManager.
 * The loader checks WebGPU availability before loading.
 *
 * @param manager - The CapabilityManager instance
 * @param completeFn - The LLM completion function (from WebLLM worker or mock)
 * @param options - Optional model override and progress callback
 */
export function registerLlmCapability(
  manager: CapabilityManager,
  completeFn: LlmCompleteFn,
  options: LlmCapabilityOptions = {},
): void {
  manager.registerLoader('llm', async () => {
    // Check GPU capabilities
    const gpuCaps = await detectGpuCapabilities()
    if (!gpuCaps.webgpuAvailable) {
      throw new Error(
        'WebGPU is not available. Local LLM requires WebGPU support (Chrome 113+ or Firefox 141+).',
      )
    }

    const tier = estimateVramTier(gpuCaps)
    const model = options.modelOverride ?? selectLlmModel(tier)

    if (options.onProgress) {
      options.onProgress(0, `Loading ${model}...`)
    }

    // In real implementation: load WebLLM model here
    // For now, just wire the completion function
    setLlmFunction(completeFn)

    if (options.onProgress) {
      options.onProgress(100, `${model} ready`)
    }
  })
}

/**
 * Unregister the LLM capability — clears the completion function.
 */
export function unregisterLlmCapability(): void {
  setLlmFunction(null)
}
