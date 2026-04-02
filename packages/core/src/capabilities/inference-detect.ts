/**
 * Enhanced inference capability detection.
 * Extends gpu-detect.ts with VRAM estimation, model fit, Chrome AI, and WebNN detection.
 *
 * @implements #115 hardware capability detection improvements
 */

import { detectGpuCapabilities, estimateVramTier, type GpuCapabilities, type VramTier } from './gpu-detect.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendedTier = 'high' | 'medium' | 'low' | 'cpu-only'

export interface InferenceCapabilities {
  webgpu: boolean
  wasm: boolean
  webnn: boolean
  sharedArrayBuffer: boolean
  chromeAI: boolean
  estimatedVramMB: number
  recommendedTier: RecommendedTier
  gpu: GpuCapabilities
  vramTier: VramTier
}

export interface ModelFitResult {
  fits: boolean
  estimatedVramMB: number
  availableVramMB: number
  recommendation: string
}

// ---------------------------------------------------------------------------
// Known GPU VRAM heuristics
// ---------------------------------------------------------------------------

interface GpuVramHeuristic {
  pattern: RegExp
  vramMB: number
}

const GPU_VRAM_HEURISTICS: GpuVramHeuristic[] = [
  // Apple M-series (unified memory, ~70% available for GPU)
  { pattern: /apple.*m4\s*pro/i, vramMB: 16384 },
  { pattern: /apple.*m4\s*max/i, vramMB: 25600 },
  { pattern: /apple.*m4/i, vramMB: 11264 },
  { pattern: /apple.*m3\s*pro/i, vramMB: 12800 },
  { pattern: /apple.*m3\s*max/i, vramMB: 25600 },
  { pattern: /apple.*m3/i, vramMB: 5632 },
  { pattern: /apple.*m2\s*pro/i, vramMB: 12800 },
  { pattern: /apple.*m2\s*max/i, vramMB: 21504 },
  { pattern: /apple.*m2/i, vramMB: 5632 },
  { pattern: /apple.*m1\s*pro/i, vramMB: 11264 },
  { pattern: /apple.*m1\s*max/i, vramMB: 21504 },
  { pattern: /apple.*m1/i, vramMB: 5632 },

  // NVIDIA (discrete VRAM)
  { pattern: /rtx\s*40[89]0/i, vramMB: 16384 },
  { pattern: /rtx\s*4070/i, vramMB: 12288 },
  { pattern: /rtx\s*4060/i, vramMB: 8192 },
  { pattern: /rtx\s*30[89]0/i, vramMB: 10240 },
  { pattern: /rtx\s*3070/i, vramMB: 8192 },
  { pattern: /rtx\s*3060/i, vramMB: 12288 },

  // AMD (discrete VRAM)
  { pattern: /rx\s*7900/i, vramMB: 20480 },
  { pattern: /rx\s*7800/i, vramMB: 16384 },
  { pattern: /rx\s*7600/i, vramMB: 8192 },

  // Intel Arc
  { pattern: /arc\s*a770/i, vramMB: 16384 },
  { pattern: /arc\s*a750/i, vramMB: 8192 },
  { pattern: /arc\s*a580/i, vramMB: 8192 },
]

/**
 * Estimate VRAM in MB using known GPU heuristics.
 * Falls back to maxBufferSize-based estimation if no match.
 */
export function estimateVramMB(gpu: GpuCapabilities): number {
  if (!gpu.webgpuAvailable) return 0

  // Try to match against known GPU architectures
  const combinedInfo = `${gpu.vendor} ${gpu.architecture}`.toLowerCase()
  for (const h of GPU_VRAM_HEURISTICS) {
    if (h.pattern.test(combinedInfo)) {
      return h.vramMB
    }
  }

  // Fallback: use maxBufferSize as a rough proxy
  // Most GPUs report maxBufferSize as ~25-50% of total VRAM
  const bufferMB = gpu.maxBufferSizeBytes / (1024 * 1024)
  if (bufferMB > 0) {
    return Math.round(bufferMB * 2.5)
  }

  return 0
}

/**
 * Estimate whether a model will fit in available VRAM.
 */
export function estimateModelFit(
  modelSizeMB: number,
  availableVramMB: number,
): ModelFitResult {
  // Models need ~20% overhead for KV cache and runtime
  const requiredMB = Math.round(modelSizeMB * 1.2)
  const fits = availableVramMB >= requiredMB

  let recommendation: string
  if (fits) {
    const headroom = availableVramMB - requiredMB
    if (headroom > modelSizeMB * 0.5) {
      recommendation = `This model requires ~${requiredMB}MB VRAM. Your GPU has ~${availableVramMB}MB — plenty of headroom.`
    } else {
      recommendation = `This model requires ~${requiredMB}MB VRAM. Your GPU has ~${availableVramMB}MB — tight but should work.`
    }
  } else {
    recommendation = `This model requires ~${requiredMB}MB VRAM but your GPU only has ~${availableVramMB}MB. Consider a smaller model or use a remote provider.`
  }

  return {
    fits,
    estimatedVramMB: requiredMB,
    availableVramMB,
    recommendation,
  }
}

// ---------------------------------------------------------------------------
// Chrome Built-in AI detection
// ---------------------------------------------------------------------------

/**
 * Detect Chrome Built-in AI (Gemini Nano) availability.
 * This API is experimental and behind flags in Chrome 127+.
 */
async function detectChromeAI(): Promise<boolean> {
  try {
    if (typeof globalThis === 'undefined') return false
    // Chrome exposes ai.languageModel on the window object
    const ai = (globalThis as Record<string, unknown>).ai as
      | { languageModel?: { capabilities?: () => Promise<{ available: string }> } }
      | undefined
    if (!ai?.languageModel?.capabilities) return false
    const caps = await ai.languageModel.capabilities()
    return caps.available === 'readily' || caps.available === 'after-download'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// WebNN detection
// ---------------------------------------------------------------------------

function detectWebNN(): boolean {
  try {
    return typeof globalThis !== 'undefined' && 'ml' in (globalThis.navigator ?? {})
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// SharedArrayBuffer detection
// ---------------------------------------------------------------------------

function detectSharedArrayBuffer(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

function deriveRecommendedTier(vramMB: number, gpu: GpuCapabilities): RecommendedTier {
  if (!gpu.webgpuAvailable) return 'cpu-only'
  if (vramMB >= 8192) return 'high'
  if (vramMB >= 2048) return 'medium'
  if (vramMB > 0) return 'low'
  return 'cpu-only'
}

/**
 * Comprehensive inference capability detection.
 * Superset of detectGpuCapabilities() — adds VRAM estimation, WebNN, Chrome AI, etc.
 */
export async function detectInferenceCapabilities(): Promise<InferenceCapabilities> {
  const [gpu, chromeAI] = await Promise.all([
    detectGpuCapabilities(),
    detectChromeAI(),
  ])

  const vramTier = estimateVramTier(gpu)
  const vramMB = estimateVramMB(gpu)
  const webnn = detectWebNN()
  const sharedArrayBuffer = detectSharedArrayBuffer()

  return {
    webgpu: gpu.webgpuAvailable,
    wasm: true, // Always available in modern browsers
    webnn,
    sharedArrayBuffer,
    chromeAI,
    estimatedVramMB: vramMB,
    recommendedTier: deriveRecommendedTier(vramMB, gpu),
    gpu,
    vramTier,
  }
}
