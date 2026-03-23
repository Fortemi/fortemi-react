/**
 * Tests for GPU capability detection.
 *
 * Mocks navigator.gpu via vi.stubGlobal to simulate various WebGPU adapter states.
 * @implements #61 GPU capability detection
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  detectGpuCapabilities,
  estimateVramTier,
  selectLlmModel,
} from '../capabilities/gpu-detect.js'
import type { GpuCapabilities } from '../capabilities/gpu-detect.js'

// ---------------------------------------------------------------------------
// detectGpuCapabilities
// ---------------------------------------------------------------------------

describe('detectGpuCapabilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns webgpuAvailable: false when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined)

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(false)
    expect(caps.vendor).toBe('none')
    expect(caps.architecture).toBe('none')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('returns webgpuAvailable: false when navigator.gpu is missing', async () => {
    vi.stubGlobal('navigator', {})

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(false)
    expect(caps.vendor).toBe('none')
    expect(caps.architecture).toBe('none')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('returns webgpuAvailable: false when adapter is null', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue(null),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(false)
    expect(caps.vendor).toBe('unavailable')
    expect(caps.architecture).toBe('unknown')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('returns correct info when adapter is available with full info', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          info: {
            vendor: 'NVIDIA',
            architecture: 'Ampere',
          },
          limits: {
            maxBufferSize: 4096 * 1024 * 1024, // 4 GB
          },
        }),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(true)
    expect(caps.vendor).toBe('NVIDIA')
    expect(caps.architecture).toBe('Ampere')
    expect(caps.maxBufferSizeBytes).toBe(4096 * 1024 * 1024)
  })

  it('uses fallback values when adapter info/limits fields are absent', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({
          info: {},
          limits: {},
        }),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(true)
    expect(caps.vendor).toBe('unknown')
    expect(caps.architecture).toBe('unknown')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('uses fallback values when adapter has no info or limits properties', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({}),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(true)
    expect(caps.vendor).toBe('unknown')
    expect(caps.architecture).toBe('unknown')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('returns webgpuAvailable: false gracefully when requestAdapter throws', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue(new Error('GPU initialization failed')),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(false)
    expect(caps.vendor).toBe('error')
    expect(caps.architecture).toBe('error')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })

  it('returns webgpuAvailable: false gracefully when requestAdapter throws a non-Error', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue('string error'),
      },
    })

    const caps = await detectGpuCapabilities()

    expect(caps.webgpuAvailable).toBe(false)
    expect(caps.vendor).toBe('error')
    expect(caps.architecture).toBe('error')
    expect(caps.maxBufferSizeBytes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// estimateVramTier
// ---------------------------------------------------------------------------

describe('estimateVramTier', () => {
  it('returns "unknown" when webgpuAvailable is false', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: false,
      vendor: 'none',
      architecture: 'none',
      maxBufferSizeBytes: 8192 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('unknown')
  })

  it('returns "low" for maxBufferSizeBytes exactly at 256 MB boundary', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 256 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('low')
  })

  it('returns "low" for maxBufferSizeBytes below 256 MB', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 128 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('low')
  })

  it('returns "medium" for maxBufferSizeBytes just above 256 MB', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 257 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('medium')
  })

  it('returns "medium" for maxBufferSizeBytes exactly at 2048 MB boundary', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 2048 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('medium')
  })

  it('returns "high" for maxBufferSizeBytes above 2048 MB', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 4096 * 1024 * 1024,
    }
    expect(estimateVramTier(caps)).toBe('high')
  })

  it('returns "low" for 0 bytes (WebGPU available but no buffer reported)', () => {
    const caps: GpuCapabilities = {
      webgpuAvailable: true,
      vendor: 'test',
      architecture: 'test',
      maxBufferSizeBytes: 0,
    }
    expect(estimateVramTier(caps)).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// selectLlmModel
// ---------------------------------------------------------------------------

describe('selectLlmModel', () => {
  it('returns Llama model for "high" tier', () => {
    expect(selectLlmModel('high')).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC')
  })

  it('returns Llama model for "medium" tier', () => {
    expect(selectLlmModel('medium')).toBe('Llama-3.2-1B-Instruct-q4f16_1-MLC')
  })

  it('returns SmolLM2 model for "low" tier', () => {
    expect(selectLlmModel('low')).toBe('SmolLM2-360M-Instruct-q4f16_1-MLC')
  })

  it('returns SmolLM2 model for "unknown" tier', () => {
    expect(selectLlmModel('unknown')).toBe('SmolLM2-360M-Instruct-q4f16_1-MLC')
  })
})
