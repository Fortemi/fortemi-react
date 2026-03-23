/**
 * GPU capability detection for WebGPU-based LLM inference.
 * Used to select appropriate model tier based on available GPU memory.
 *
 * @implements #61 GPU capability detection
 */

export interface GpuCapabilities {
  webgpuAvailable: boolean
  vendor: string
  architecture: string
  maxBufferSizeBytes: number
  supportsF16: boolean
}

export type VramTier = 'low' | 'medium' | 'high' | 'unknown'

type AdapterLike = {
  info?: Record<string, string>
  limits?: Record<string, number>
  features?: { has(f: string): boolean }
}
type GpuApi = { requestAdapter(options?: Record<string, string>): Promise<AdapterLike | null> }

const NO_GPU: GpuCapabilities = { webgpuAvailable: false, vendor: 'none', architecture: 'unknown', maxBufferSizeBytes: 0, supportsF16: false }

function capsFromAdapter(adapter: AdapterLike, archSuffix = ''): GpuCapabilities {
  const info = adapter.info ?? {}
  const limits = adapter.limits ?? {}
  const f16 = adapter.features?.has('shader-f16') ?? false
  return {
    webgpuAvailable: true,
    vendor: info.vendor ?? 'unknown',
    architecture: (info.architecture ?? 'unknown') + archSuffix,
    maxBufferSizeBytes: limits.maxBufferSize ?? 0,
    supportsF16: f16,
  }
}

export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return NO_GPU

  try {
    const gpu = (navigator as unknown as { gpu: GpuApi }).gpu
    const preferences: Array<Record<string, string>> = [
      { powerPreference: 'high-performance' },
      { powerPreference: 'low-power' },
      {},
    ]

    let swiftshaderAdapter: AdapterLike | null = null

    for (const pref of preferences) {
      const adapter = await gpu.requestAdapter(pref)
      if (!adapter) continue

      const arch = (adapter.info?.architecture ?? '').toLowerCase()
      const vendor = (adapter.info?.vendor ?? '').toLowerCase()

      if (arch === 'swiftshader' || vendor === 'google') {
        if (!swiftshaderAdapter) swiftshaderAdapter = adapter
        continue
      }

      return capsFromAdapter(adapter)
    }

    if (swiftshaderAdapter) return capsFromAdapter(swiftshaderAdapter, ' (software)')
    return { ...NO_GPU, vendor: 'unavailable' }
  } catch {
    return { ...NO_GPU, vendor: 'error', architecture: 'error' }
  }
}

export function estimateVramTier(caps: GpuCapabilities): VramTier {
  if (!caps.webgpuAvailable) return 'unknown'
  const mb = caps.maxBufferSizeBytes / (1024 * 1024)
  if (mb <= 256) return 'low'
  if (mb <= 2048) return 'medium'
  return 'high'
}

/**
 * Select an LLM model based on VRAM tier and f16 shader support.
 * Uses f32 quantization when f16 shaders aren't available (e.g., SwiftShader).
 */
export function selectLlmModel(tier: VramTier, supportsF16 = false): string {
  const q = supportsF16 ? 'q4f16_1' : 'q4f32_1'
  switch (tier) {
    case 'high':
      return `Hermes-3-Llama-3.2-3B-${q}-MLC`
    case 'medium':
      return `Qwen3-1.7B-${q}-MLC`
    case 'low':
    case 'unknown':
      return `Qwen3-0.6B-${q}-MLC`
  }
}
