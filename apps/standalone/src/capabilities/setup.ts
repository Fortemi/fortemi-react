/**
 * Wire real capability loaders for the standalone app.
 * Connects transformers.js (semantic) and WebLLM (llm) with CapabilityManager.
 */

import type { CapabilityManager } from '@fortemi/core'
import {
  setEmbedFunction,
  setLlmFunction,
  detectGpuCapabilities,
  estimateVramTier,
  selectLlmModel,
  type EmbedFunction,
  type LlmCompleteFn,
} from '@fortemi/core'

/** Load transformers.js and return a real embed function */
async function loadTransformersEmbedFunction(onProgress?: (msg: string) => void): Promise<EmbedFunction> {
  onProgress?.('Downloading embedding model...')
  const { pipeline } = await import('@huggingface/transformers')

  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && p.progress != null) {
        onProgress?.(`Downloading ${p.file ?? 'model'}: ${Math.round(p.progress)}%`)
      } else if (p.status === 'ready') {
        onProgress?.('Model ready')
      }
    },
  })

  return async (texts: string[]): Promise<number[][]> => {
    const results: number[][] = []
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true })
      results.push(Array.from(output.data as Float32Array))
    }
    return results
  }
}

/** Curated model presets organized by size tier */
export const LLM_PRESETS = [
  { id: 'Qwen3-0.6B-q4f32_1-MLC', label: 'Qwen3 0.6B (fastest)', size: '~400 MB', tier: 'low' as const },
  { id: 'SmolLM2-1.7B-Instruct-q4f32_1-MLC', label: 'SmolLM2 1.7B (fast)', size: '~1.1 GB', tier: 'low' as const },
  { id: 'Qwen3-1.7B-q4f32_1-MLC', label: 'Qwen3 1.7B (recommended)', size: '~1.2 GB', tier: 'medium' as const },
  { id: 'Hermes-3-Llama-3.2-3B-q4f32_1-MLC', label: 'Hermes 3 Llama 3.2 3B (best quality/speed)', size: '~2.2 GB', tier: 'medium' as const },
  { id: 'Qwen3-4B-q4f32_1-MLC', label: 'Qwen3 4B (high quality)', size: '~2.8 GB', tier: 'high' as const },
  { id: 'Hermes-3-Llama-3.1-8B-q4f32_1-MLC', label: 'Hermes 3 Llama 3.1 8B (best quality)', size: '~5.5 GB', tier: 'high' as const },
  { id: 'Qwen3-8B-q4f32_1-MLC', label: 'Qwen3 8B (best quality)', size: '~5.5 GB', tier: 'high' as const },
]

const LLM_MODEL_KEY = 'fortemi:llm-model'
const ENABLED_CAPS_KEY = 'fortemi:enabled-capabilities'

export function getSelectedLlmModel(): string {
  return localStorage.getItem(LLM_MODEL_KEY) ?? ''
}

export function setSelectedLlmModel(modelId: string): void {
  localStorage.setItem(LLM_MODEL_KEY, modelId)
}

/** Persist which capabilities are enabled so they auto-start on next visit */
export function saveEnabledCapabilities(caps: string[]): void {
  localStorage.setItem(ENABLED_CAPS_KEY, JSON.stringify(caps))
}

/** Get previously enabled capabilities, or default to both enabled */
export function getEnabledCapabilities(): string[] {
  const stored = localStorage.getItem(ENABLED_CAPS_KEY)
  if (stored) {
    try { return JSON.parse(stored) } catch { /* fall through */ }
  }
  // Default: enable both on first visit
  return ['semantic', 'llm']
}

/** Load WebLLM engine and return an LLM completion function */
async function loadWebLLM(onProgress?: (msg: string) => void): Promise<LlmCompleteFn> {
  // Use user-selected model, or auto-detect from GPU
  let modelId = getSelectedLlmModel()
  if (!modelId) {
    const caps = await detectGpuCapabilities()
    const tier = estimateVramTier(caps)
    modelId = selectLlmModel(tier, caps.supportsF16)
  }

  onProgress?.(`Loading ${modelId}...`)
  console.log(`[LLM] Loading ${modelId}`)

  const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

  // CreateMLCEngine downloads multiple shards — transient fetch errors on individual
  // shards are retried internally. We retry the entire init up to 3 times for resilience.
  let engine: Awaited<ReturnType<typeof CreateMLCEngine>>
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report) => {
          onProgress?.(report.text)
          console.log(`[LLM] ${report.text}`)
        },
      })
      break
    } catch (err) {
      lastError = err
      console.warn(`[LLM] Attempt ${attempt}/3 failed:`, err)
      if (attempt < 3) {
        onProgress?.(`Download interrupted, retrying (attempt ${attempt + 1}/3)...`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }
  if (!engine!) throw lastError

  console.log(`[LLM] ${modelId} ready`)
  onProgress?.(`${modelId} ready`)

  return async (prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> => {
    const reply = await engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.7,
    })
    return reply.choices[0]?.message?.content ?? ''
  }
}

/**
 * Register all capability loaders with the CapabilityManager.
 * Call once at app startup.
 */
export function setupCapabilities(manager: CapabilityManager): void {
  // Semantic: transformers.js embedding (works in all browsers, WASM-based)
  manager.registerLoader('semantic', async () => {
    const embedFn = await loadTransformersEmbedFunction((msg) => {
      console.log(`[Semantic] ${msg}`)
      manager.setProgress?.('semantic', msg)
    })
    setEmbedFunction(embedFn)
  })

  // LLM: WebLLM (requires WebGPU)
  manager.registerLoader('llm', async () => {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new Error(
        'WebGPU is not available. Local LLM requires WebGPU.\n' +
        'Linux: Launch Chrome with --enable-features=Vulkan --enable-unsafe-webgpu'
      )
    }

    const completeFn = await loadWebLLM((msg) => {
      console.log(`[LLM] ${msg}`)
      manager.setProgress?.('llm', msg)
    })
    setLlmFunction(completeFn)
  })
}
