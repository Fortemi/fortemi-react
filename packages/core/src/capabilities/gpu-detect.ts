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
}

export type VramTier = 'low' | 'medium' | 'high' | 'unknown'

export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { webgpuAvailable: false, vendor: 'none', architecture: 'none', maxBufferSizeBytes: 0 }
  }

  try {
    const adapter = await (navigator as any).gpu.requestAdapter()
    if (!adapter) {
      return { webgpuAvailable: false, vendor: 'unavailable', architecture: 'unknown', maxBufferSizeBytes: 0 }
    }

    const info = adapter.info ?? {}
    const limits = adapter.limits ?? {}

    return {
      webgpuAvailable: true,
      vendor: info.vendor ?? 'unknown',
      architecture: info.architecture ?? 'unknown',
      maxBufferSizeBytes: limits.maxBufferSize ?? 0,
    }
  } catch {
    return { webgpuAvailable: false, vendor: 'error', architecture: 'error', maxBufferSizeBytes: 0 }
  }
}

export function estimateVramTier(caps: GpuCapabilities): VramTier {
  if (!caps.webgpuAvailable) return 'unknown'
  const mb = caps.maxBufferSizeBytes / (1024 * 1024)
  if (mb <= 256) return 'low'
  if (mb <= 2048) return 'medium'
  return 'high'
}

export function selectLlmModel(tier: VramTier): string {
  switch (tier) {
    case 'high':
    case 'medium':
      return 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
    case 'low':
    case 'unknown':
      return 'SmolLM2-360M-Instruct-q4f16_1-MLC'
  }
}
