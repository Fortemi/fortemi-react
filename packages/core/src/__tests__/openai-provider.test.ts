/**
 * Tests for OpenAICompatibleProvider.
 * Uses vi.fn() to mock global fetch — no actual HTTP calls.
 *
 * @implements #113 remote provider support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAICompatibleProvider } from '../capabilities/openai-provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    body: null,
    headers: new Headers(),
  } as unknown as Response
}

function createProvider(overrides?: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]>) {
  return new OpenAICompatibleProvider({
    id: 'test',
    name: 'Test Provider',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAICompatibleProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('constructor', () => {
    it('sets provider metadata', () => {
      const p = createProvider()
      expect(p.id).toBe('test')
      expect(p.name).toBe('Test Provider')
      expect(p.tier).toBe('remote')
      expect(p.capabilities.embeddings).toBe(true)
      expect(p.capabilities.chat).toBe(true)
      expect(p.capabilities.streaming).toBe(true)
    })

    it('detects local-server tier for localhost URLs', () => {
      const p = createProvider({ baseURL: 'http://localhost:11434/v1' })
      expect(p.tier).toBe('local-server')
    })

    it('respects explicit tier override', () => {
      const p = createProvider({ tier: 'in-browser' })
      expect(p.tier).toBe('in-browser')
    })

    it('strips trailing slashes from baseURL', () => {
      const p = createProvider({ baseURL: 'https://api.example.com/v1///' })
      // Verify by calling probe which constructs URL
      fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }))
      p.probe() // just trigger a request
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.anything(),
      )
    })
  })

  describe('embed', () => {
    it('sends embedding request and returns vectors', async () => {
      const p = createProvider({ defaultEmbeddingModel: 'text-embedding-3-small' })
      fetchMock.mockResolvedValue(mockFetchResponse({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
        model: 'text-embedding-3-small',
        usage: { total_tokens: 10 },
      }))

      const result = await p.embed({ texts: ['hello', 'world'] })

      expect(result.vectors).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
      expect(result.model).toBe('text-embedding-3-small')
      expect(result.usage?.totalTokens).toBe(10)

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test',
            'Content-Type': 'application/json',
          }),
        }),
      )

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.input).toEqual(['hello', 'world'])
      expect(body.model).toBe('text-embedding-3-small')
    })

    it('sorts results by index', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({
        data: [
          { embedding: [0.4, 0.5], index: 1 },
          { embedding: [0.1, 0.2], index: 0 },
        ],
        model: 'test',
      }))

      const result = await p.embed({ texts: ['a', 'b'] })
      expect(result.vectors).toEqual([[0.1, 0.2], [0.4, 0.5]])
    })

    it('uses custom model from request', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({
        data: [{ embedding: [1], index: 0 }],
        model: 'custom-embed',
      }))

      await p.embed({ texts: ['test'], model: 'custom-embed' })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.model).toBe('custom-embed')
    })
  })

  describe('complete', () => {
    it('sends chat completion request', async () => {
      const p = createProvider({ defaultModel: 'gpt-4' })
      fetchMock.mockResolvedValue(mockFetchResponse({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        model: 'gpt-4',
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }))

      const result = await p.complete({ prompt: 'Say hi' })

      expect(result.text).toBe('Hello!')
      expect(result.model).toBe('gpt-4')
      expect(result.usage?.promptTokens).toBe(5)
      expect(result.finishReason).toBe('stop')

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.messages).toEqual([{ role: 'user', content: 'Say hi' }])
      expect(body.stream).toBe(false)
    })

    it('includes system prompt when provided', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({
        choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
        model: 'test',
      }))

      await p.complete({ prompt: 'hi', systemPrompt: 'You are a helper' })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'hi' },
      ])
    })

    it('passes optional parameters', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        model: 'test',
      }))

      await p.complete({
        prompt: 'test',
        maxTokens: 100,
        temperature: 0.7,
        stopSequences: ['END'],
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.max_tokens).toBe(100)
      expect(body.temperature).toBe(0.7)
      expect(body.stop).toEqual(['END'])
    })

    it('maps finish reasons correctly', async () => {
      const p = createProvider()

      for (const [apiReason, expected] of [
        ['stop', 'stop'],
        ['length', 'length'],
        ['content_filter', 'content_filter'],
        ['unknown_reason', undefined],
      ] as const) {
        fetchMock.mockResolvedValue(mockFetchResponse({
          choices: [{ message: { content: '' }, finish_reason: apiReason }],
          model: 'test',
        }))
        const result = await p.complete({ prompt: 'test' })
        expect(result.finishReason).toBe(expected)
      }
    })
  })

  describe('listModels', () => {
    it('returns model list', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({
        data: [
          { id: 'gpt-4', owned_by: 'openai' },
          { id: 'text-embedding-3-small', owned_by: 'openai' },
        ],
      }))

      const models = await p.listModels()
      expect(models).toHaveLength(2)
      expect(models[0].id).toBe('gpt-4')
      expect(models[0].capabilities.chat).toBe(true)
      expect(models[0].capabilities.embeddings).toBe(false)
      expect(models[1].id).toBe('text-embedding-3-small')
      expect(models[1].capabilities.embeddings).toBe(true)
    })

    it('returns empty array on error', async () => {
      const p = createProvider()
      fetchMock.mockRejectedValue(new Error('network error'))

      const models = await p.listModels()
      expect(models).toEqual([])
    })
  })

  describe('probe', () => {
    it('returns ok on success', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }))

      const result = await p.probe()
      expect(result.status).toBe('ok')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('returns down on failure', async () => {
      const p = createProvider()
      fetchMock.mockRejectedValue(new Error('connection refused'))

      const result = await p.probe()
      expect(result.status).toBe('down')
      expect(result.message).toContain('connection refused')
    })
  })

  describe('error handling', () => {
    it('throws on non-ok response for embed', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({ error: 'rate limited' }, 429))

      await expect(p.embed({ texts: ['test'] })).rejects.toThrow('API error 429')
    })

    it('throws on non-ok response for complete', async () => {
      const p = createProvider()
      fetchMock.mockResolvedValue(mockFetchResponse({ error: 'bad request' }, 400))

      await expect(p.complete({ prompt: 'test' })).rejects.toThrow('API error 400')
    })
  })

  describe('headers', () => {
    it('includes custom headers', async () => {
      const p = createProvider({
        headers: { 'X-Custom': 'value' },
      })
      fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }))

      await p.listModels()

      expect(fetchMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom': 'value' }),
        }),
      )
    })

    it('omits Authorization when no apiKey', async () => {
      const p = createProvider({ apiKey: undefined })
      fetchMock.mockResolvedValue(mockFetchResponse({ data: [] }))

      await p.listModels()

      const headers = fetchMock.mock.calls[0][1].headers
      expect(headers.Authorization).toBeUndefined()
    })
  })

  describe('dispose', () => {
    it('does not throw', () => {
      const p = createProvider()
      p.dispose()
    })
  })
})
