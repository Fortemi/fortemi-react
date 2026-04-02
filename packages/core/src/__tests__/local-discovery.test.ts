/**
 * Tests for local inference server auto-discovery.
 * @implements #116 local server auto-discovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  discoverLocalProviders,
  classifyModel,
  LOCAL_ENDPOINTS,
} from '../capabilities/local-discovery.js'

// ---------------------------------------------------------------------------
// classifyModel
// ---------------------------------------------------------------------------

describe('classifyModel', () => {
  it('classifies embedding models', () => {
    expect(classifyModel('nomic-embed-text')).toBe('embedding')
    expect(classifyModel('text-embedding-3-small')).toBe('embedding')
    expect(classifyModel('bge-large-en-v1.5')).toBe('embedding')
    expect(classifyModel('mxbai-embed-large')).toBe('embedding')
    expect(classifyModel('all-MiniLM-L6-v2')).toBe('embedding')
    expect(classifyModel('e5-large-v2')).toBe('embedding')
    expect(classifyModel('gte-large')).toBe('embedding')
  })

  it('classifies vision models', () => {
    expect(classifyModel('llava:13b')).toBe('vision')
    expect(classifyModel('moondream2')).toBe('vision')
    expect(classifyModel('minicpm-v')).toBe('vision')
    expect(classifyModel('bakllava:latest')).toBe('vision')
    expect(classifyModel('llava-v1.6-34b')).toBe('vision')
  })

  it('classifies chat models (default)', () => {
    expect(classifyModel('llama3.2:3b')).toBe('chat')
    expect(classifyModel('qwen3:1.7b')).toBe('chat')
    expect(classifyModel('mistral:7b')).toBe('chat')
    expect(classifyModel('gpt-4')).toBe('chat')
    expect(classifyModel('claude-3.5-sonnet')).toBe('chat')
  })
})

// ---------------------------------------------------------------------------
// LOCAL_ENDPOINTS
// ---------------------------------------------------------------------------

describe('LOCAL_ENDPOINTS', () => {
  it('contains known local servers', () => {
    const ids = LOCAL_ENDPOINTS.map(e => e.id)
    expect(ids).toContain('ollama')
    expect(ids).toContain('lm-studio')
    expect(ids).toContain('llama-cpp')
    expect(ids).toContain('vllm')
    expect(ids).toContain('jan')
    expect(ids).toContain('localai')
  })
})

// ---------------------------------------------------------------------------
// discoverLocalProviders
// ---------------------------------------------------------------------------

describe('discoverLocalProviders', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty array when no servers are reachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const result = await discoverLocalProviders({ timeoutMs: 100 })
    expect(result).toEqual([])
  })

  it('discovers Ollama with OpenAI-format models', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('11434')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { id: 'llama3.2:3b' },
              { id: 'nomic-embed-text' },
            ],
          }),
        })
      }
      return Promise.reject(new Error('not found'))
    })

    const result = await discoverLocalProviders({ timeoutMs: 100 })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ollama')
    expect(result[0].name).toBe('Ollama')
    expect(result[0].models).toHaveLength(2)

    const chat = result[0].models.find(m => m.id === 'llama3.2:3b')
    expect(chat?.capabilities.chat).toBe(true)

    const embed = result[0].models.find(m => m.id === 'nomic-embed-text')
    expect(embed?.capabilities.embeddings).toBe(true)
  })

  it('discovers server with Ollama-format models response', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('11434')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            models: [
              { name: 'mistral:7b' },
              { name: 'llava:13b' },
            ],
          }),
        })
      }
      return Promise.reject(new Error('not found'))
    })

    const result = await discoverLocalProviders({ timeoutMs: 100 })

    expect(result).toHaveLength(1)
    expect(result[0].models).toHaveLength(2)

    const vision = result[0].models.find(m => m.id === 'llava:13b')
    expect(vision?.capabilities.vision).toBe(true)
  })

  it('discovers multiple servers', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('11434')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 'llama3' }] }),
        })
      }
      if (url.includes('1234')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 'qwen3' }] }),
        })
      }
      return Promise.reject(new Error('not found'))
    })

    const result = await discoverLocalProviders({ timeoutMs: 100 })

    expect(result).toHaveLength(2)
    expect(result.map(r => r.id)).toContain('ollama')
    expect(result.map(r => r.id)).toContain('lm-studio')
  })

  it('skips ports in skipPorts list', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] }),
    })

    await discoverLocalProviders({
      timeoutMs: 100,
      skipPorts: [11434], // skip Ollama
    })

    // Should not have probed Ollama
    const urls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(urls.every((u) => !u.includes('11434'))).toBe(true)
  })

  it('supports extra endpoints', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('9999')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 'custom-model' }] }),
        })
      }
      return Promise.reject(new Error('not found'))
    })

    const result = await discoverLocalProviders({
      timeoutMs: 100,
      extraEndpoints: [{
        id: 'custom',
        name: 'Custom Server',
        baseURL: 'http://localhost:9999/v1',
        defaultPort: 9999,
      }],
    })

    expect(result.some(r => r.id === 'custom')).toBe(true)
  })

  it('handles non-ok responses gracefully', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    const result = await discoverLocalProviders({ timeoutMs: 100 })
    expect(result).toEqual([])
  })

  it('deduplicates endpoints with same baseURL', async () => {
    // llama.cpp and LocalAI both use port 8080
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'model' }] }),
    })

    await discoverLocalProviders({ timeoutMs: 100 })

    // Count calls to port 8080 — should only be once
    const calls8080 = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes(':8080'),
    )
    expect(calls8080.length).toBe(1)
  })
})
