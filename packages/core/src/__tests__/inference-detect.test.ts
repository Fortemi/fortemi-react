/**
 * Tests for enhanced inference capability detection.
 * @implements #115 hardware capability detection improvements
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  detectInferenceCapabilities,
  estimateVramMB,
  estimateModelFit,
} from '../capabilities/inference-detect.js'
import type { GpuCapabilities } from '../capabilities/gpu-detect.js'

// ---------------------------------------------------------------------------
// estimateVramMB
// ---------------------------------------------------------------------------

describe('estimateVramMB', () => {
  it('returns 0 when webgpu is not available', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: false,
      vendor: 'none',
      architecture: 'unknown',
      maxBufferSizeBytes: 0,
      supportsF16: false,
    }
    expect(estimateVramMB(gpu)).toBe(0)
  })

  it('matches Apple M1 heuristic', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'apple',
      architecture: 'Apple M1',
      maxBufferSizeBytes: 2048 * 1024 * 1024,
      supportsF16: true,
    }
    expect(estimateVramMB(gpu)).toBe(5632)
  })

  it('matches Apple M4 Pro heuristic', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'apple',
      architecture: 'Apple M4 Pro',
      maxBufferSizeBytes: 4096 * 1024 * 1024,
      supportsF16: true,
    }
    expect(estimateVramMB(gpu)).toBe(16384)
  })

  it('matches NVIDIA RTX 4090 heuristic', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'nvidia',
      architecture: 'RTX 4090',
      maxBufferSizeBytes: 8192 * 1024 * 1024,
      supportsF16: true,
    }
    expect(estimateVramMB(gpu)).toBe(16384)
  })

  it('matches AMD RX 7900 heuristic', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'amd',
      architecture: 'RX 7900',
      maxBufferSizeBytes: 8192 * 1024 * 1024,
      supportsF16: true,
    }
    expect(estimateVramMB(gpu)).toBe(20480)
  })

  it('falls back to buffer-size estimation for unknown GPU', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'unknown-vendor',
      architecture: 'unknown-arch',
      maxBufferSizeBytes: 2048 * 1024 * 1024,
      supportsF16: false,
    }
    // 2048 MB * 2.5 = 5120
    expect(estimateVramMB(gpu)).toBe(5120)
  })

  it('returns 0 for unknown GPU with 0 buffer size', () => {
    const gpu: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'unknown',
      architecture: 'unknown',
      maxBufferSizeBytes: 0,
      supportsF16: false,
    }
    expect(estimateVramMB(gpu)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// estimateModelFit
// ---------------------------------------------------------------------------

describe('estimateModelFit', () => {
  it('reports model fits with plenty of headroom', () => {
    const result = estimateModelFit(2000, 8000)
    expect(result.fits).toBe(true)
    expect(result.estimatedVramMB).toBe(2400) // 2000 * 1.2
    expect(result.availableVramMB).toBe(8000)
    expect(result.recommendation).toContain('plenty of headroom')
  })

  it('reports model fits but tight', () => {
    const result = estimateModelFit(4000, 5000)
    expect(result.fits).toBe(true)
    expect(result.recommendation).toContain('tight but should work')
  })

  it('reports model does not fit', () => {
    const result = estimateModelFit(8000, 4000)
    expect(result.fits).toBe(false)
    expect(result.recommendation).toContain('Consider a smaller model')
  })

  it('handles zero available VRAM', () => {
    const result = estimateModelFit(1000, 0)
    expect(result.fits).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectInferenceCapabilities
// ---------------------------------------------------------------------------

describe('detectInferenceCapabilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns wasm: true always', async () => {
    vi.stubGlobal('navigator', {})
    const caps = await detectInferenceCapabilities()
    expect(caps.wasm).toBe(true)
  })

  it('returns cpu-only tier when no WebGPU', async () => {
    vi.stubGlobal('navigator', {})
    const caps = await detectInferenceCapabilities()
    expect(caps.webgpu).toBe(false)
    expect(caps.recommendedTier).toBe('cpu-only')
    expect(caps.estimatedVramMB).toBe(0)
  })

  it('includes gpu sub-object for backward compat', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          info: { vendor: 'NVIDIA', architecture: 'Ampere' },
          limits: { maxBufferSize: 4096 * 1024 * 1024 },
        }),
      },
    })

    const caps = await detectInferenceCapabilities()
    expect(caps.gpu.webgpuAvailable).toBe(true)
    expect(caps.gpu.vendor).toBe('NVIDIA')
    expect(caps.vramTier).toBeDefined()
  })

  it('detects SharedArrayBuffer', async () => {
    vi.stubGlobal('navigator', {})
    const caps = await detectInferenceCapabilities()
    // In test environment, SharedArrayBuffer is typically available
    expect(typeof caps.sharedArrayBuffer).toBe('boolean')
  })

  it('derives high tier for large VRAM', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          info: { vendor: 'nvidia', architecture: 'RTX 4090' },
          limits: { maxBufferSize: 8192 * 1024 * 1024 },
        }),
      },
    })

    const caps = await detectInferenceCapabilities()
    expect(caps.recommendedTier).toBe('high')
    expect(caps.estimatedVramMB).toBe(16384)
  })

  it('derives medium tier for moderate VRAM', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          info: { vendor: 'unknown', architecture: 'unknown' },
          limits: { maxBufferSize: 1024 * 1024 * 1024 }, // 1GB buffer
        }),
      },
    })

    const caps = await detectInferenceCapabilities()
    // 1024 * 2.5 = 2560 MB -> medium
    expect(caps.recommendedTier).toBe('medium')
  })
})
