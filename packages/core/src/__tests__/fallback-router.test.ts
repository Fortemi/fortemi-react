/**
 * Tests for FallbackRouter with cooldown and capability-aware routing.
 * @implements #114 provider fallback chains with cooldown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TypedEventBus } from '../event-bus.js'
import { FallbackRouter, classifyError } from '../capabilities/fallback-router.js'
import type { InferenceProvider, ProviderCapabilities } from '../capabilities/inference-provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockProvider(id: string, overrides?: Partial<InferenceProvider> & { capabilities?: Partial<ProviderCapabilities> }): InferenceProvider {
  const caps: ProviderCapabilities = {
    embeddings: true, chat: true, streaming: true,
    vision: false, toolCalling: false, structuredOutput: false,
    ...overrides?.capabilities,
  }
  return {
    id,
    name: id,
    tier: 'remote',
    capabilities: caps,
    embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: id }),
    complete: vi.fn().mockResolvedValue({ text: `from-${id}`, model: id }),
    stream: vi.fn(),
    listModels: vi.fn().mockResolvedValue([{ id: `model-${id}`, capabilities: {} }]),
    probe: vi.fn().mockResolvedValue({ status: 'ok', latencyMs: 1 }),
    dispose: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies rate limit errors', () => {
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('rate_limit')
    expect(classifyError(new Error('Rate limit exceeded'))).toBe('rate_limit')
  })

  it('classifies server errors', () => {
    expect(classifyError(new Error('500 Internal Server Error'))).toBe('server_error')
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('server_error')
    expect(classifyError(new Error('503 Service Unavailable'))).toBe('server_error')
  })

  it('classifies connection failures', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('connection_failure')
    expect(classifyError(new Error('NetworkError'))).toBe('connection_failure')
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('connection_failure')
    expect(classifyError(new Error('timeout'))).toBe('connection_failure')
  })

  it('classifies content policy errors', () => {
    expect(classifyError(new Error('content policy violation'))).toBe('content_policy')
    expect(classifyError(new Error('content filter triggered'))).toBe('content_policy')
  })

  it('classifies context window errors', () => {
    expect(classifyError(new Error('context window exceeded'))).toBe('context_window')
    expect(classifyError(new Error('context length too long'))).toBe('context_window')
  })

  it('returns unknown for unrecognized errors', () => {
    expect(classifyError(new Error('something weird'))).toBe('unknown')
    expect(classifyError('string error')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// FallbackRouter
// ---------------------------------------------------------------------------

describe('FallbackRouter', () => {
  let events: TypedEventBus

  beforeEach(() => {
    events = new TypedEventBus()
  })

  describe('basic routing', () => {
    it('routes to first available provider', async () => {
      const a = mockProvider('a')
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      const result = await router.complete({ prompt: 'test' })
      expect(result.text).toBe('from-a')
      expect(a.complete).toHaveBeenCalled()
      expect(b.complete).not.toHaveBeenCalled()
    })

    it('falls through to next provider on error', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 Internal Server Error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      const result = await router.complete({ prompt: 'test' })
      expect(result.text).toBe('from-b')
    })

    it('throws when all providers fail', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('fail-a')),
      })
      const b = mockProvider('b', {
        complete: vi.fn().mockRejectedValue(new Error('fail-b')),
      })
      const router = new FallbackRouter({ providers: [a, b], events })

      await expect(router.complete({ prompt: 'test' })).rejects.toThrow('fail-b')
    })

    it('throws when no providers available', async () => {
      const router = new FallbackRouter({ providers: [], events })
      await expect(router.complete({ prompt: 'test' })).rejects.toThrow('No available providers')
    })
  })

  describe('capability-aware routing', () => {
    it('only routes embeddings to providers with embedding capability', async () => {
      const chatOnly = mockProvider('chat', {
        capabilities: { embeddings: false, chat: true, streaming: false, vision: false, toolCalling: false, structuredOutput: false },
        embed: undefined,
      })
      const embedder = mockProvider('embedder', {
        capabilities: { embeddings: true, chat: false, streaming: false, vision: false, toolCalling: false, structuredOutput: false },
      })
      const router = new FallbackRouter({ providers: [chatOnly, embedder], events })

      const result = await router.embed({ texts: ['test'] })
      expect(result.vectors).toEqual([[1]])
      expect(embedder.embed).toHaveBeenCalled()
    })

    it('throws when no provider supports the requested capability', async () => {
      const chatOnly = mockProvider('chat', {
        capabilities: { embeddings: false, chat: true, streaming: false, vision: false, toolCalling: false, structuredOutput: false },
        embed: undefined,
      })
      const router = new FallbackRouter({ providers: [chatOnly], events })

      await expect(router.embed({ texts: ['test'] })).rejects.toThrow('No available providers')
    })
  })

  describe('cooldown mechanism', () => {
    it('puts failed provider in cooldown', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 Internal Server Error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({
        providers: [a, b],
        events,
        cooldowns: { serverError: 60000 },
      })

      await router.complete({ prompt: 'first' })

      // Provider 'a' should be in cooldown
      const cooling = router.getCoolingDown()
      expect(cooling).toHaveLength(1)
      expect(cooling[0].providerId).toBe('a')
      expect(cooling[0].category).toBe('server_error')
    })

    it('skips cooled-down providers on next request', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 Server Error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({
        providers: [a, b],
        events,
        cooldowns: { serverError: 60000 },
      })

      await router.complete({ prompt: 'first' })
      // Reset mock to track new calls
      vi.mocked(a.complete!).mockClear()
      vi.mocked(b.complete!).mockClear()

      await router.complete({ prompt: 'second' })
      // Provider 'a' should be skipped (in cooldown)
      expect(a.complete).not.toHaveBeenCalled()
      expect(b.complete).toHaveBeenCalled()
    })

    it('applies rate limit cooldown', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('429 rate limit')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({
        providers: [a, b],
        events,
        cooldowns: { rateLimit: 30000 },
      })

      await router.complete({ prompt: 'test' })

      const cooling = router.getCoolingDown()
      expect(cooling[0].category).toBe('rate_limit')
    })

    it('clearCooldown removes specific provider cooldown', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      await router.complete({ prompt: 'test' })
      expect(router.getCoolingDown()).toHaveLength(1)

      router.clearCooldown('a')
      expect(router.getCoolingDown()).toHaveLength(0)
    })

    it('clearAllCooldowns removes all cooldowns', async () => {
      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      // First call: a fails and enters cooldown, b succeeds
      await router.complete({ prompt: 'test' })
      expect(router.getCoolingDown()).toHaveLength(1)

      router.clearAllCooldowns()
      expect(router.getCoolingDown()).toHaveLength(0)
    })
  })

  describe('events', () => {
    it('emits provider.fallback on failover', async () => {
      const handler = vi.fn()
      events.on('provider.fallback', handler)

      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('500 Server Error')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      await router.complete({ prompt: 'test' })

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        fromProvider: 'a',
        toProvider: 'b',
        errorCategory: 'server_error',
      }))
    })

    it('emits provider.cooldown when provider enters cooldown', async () => {
      const handler = vi.fn()
      events.on('provider.cooldown', handler)

      const a = mockProvider('a', {
        complete: vi.fn().mockRejectedValue(new Error('429 rate limit')),
      })
      const b = mockProvider('b')
      const router = new FallbackRouter({
        providers: [a, b],
        events,
        cooldowns: { rateLimit: 30000 },
      })

      await router.complete({ prompt: 'test' })

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'a',
        errorCategory: 'rate_limit',
        cooldownMs: 30000,
      }))
    })
  })

  describe('provider management', () => {
    it('addProvider appends to chain', () => {
      const router = new FallbackRouter({ providers: [mockProvider('a')], events })
      router.addProvider(mockProvider('b'))

      expect(router.getAvailableProviders()).toHaveLength(2)
    })

    it('removeProvider removes from chain', () => {
      const router = new FallbackRouter({
        providers: [mockProvider('a'), mockProvider('b')],
        events,
      })
      router.removeProvider('a')

      expect(router.getAvailableProviders()).toHaveLength(1)
      expect(router.getAvailableProviders()[0].id).toBe('b')
    })

    it('setOrder reorders providers', async () => {
      const a = mockProvider('a')
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      router.setOrder(['b', 'a'])
      const result = await router.complete({ prompt: 'test' })
      expect(result.text).toBe('from-b')
    })
  })

  describe('aggregated capabilities', () => {
    it('aggregates capabilities from all providers', () => {
      const router = new FallbackRouter({
        providers: [
          mockProvider('a', { capabilities: { embeddings: true, chat: false, streaming: false, vision: false, toolCalling: false, structuredOutput: false } }),
          mockProvider('b', { capabilities: { embeddings: false, chat: true, streaming: true, vision: false, toolCalling: false, structuredOutput: false } }),
        ],
        events,
      })

      expect(router.capabilities.embeddings).toBe(true)
      expect(router.capabilities.chat).toBe(true)
      expect(router.capabilities.streaming).toBe(true)
    })
  })

  describe('listModels', () => {
    it('aggregates models from all available providers', async () => {
      const router = new FallbackRouter({
        providers: [mockProvider('a'), mockProvider('b')],
        events,
      })

      const models = await router.listModels()
      expect(models).toHaveLength(2)
    })
  })

  describe('probe', () => {
    it('returns ok when all providers healthy', async () => {
      const router = new FallbackRouter({
        providers: [mockProvider('a'), mockProvider('b')],
        events,
      })

      const result = await router.probe()
      expect(result.status).toBe('ok')
    })

    it('returns degraded when some providers down', async () => {
      const router = new FallbackRouter({
        providers: [
          mockProvider('a'),
          mockProvider('b', { probe: vi.fn().mockResolvedValue({ status: 'down', latencyMs: 0 }) }),
        ],
        events,
      })

      const result = await router.probe()
      expect(result.status).toBe('degraded')
    })

    it('returns down when no providers available', async () => {
      const router = new FallbackRouter({ providers: [], events })
      const result = await router.probe()
      expect(result.status).toBe('down')
    })
  })

  describe('dispose', () => {
    it('disposes all providers', () => {
      const a = mockProvider('a')
      const b = mockProvider('b')
      const router = new FallbackRouter({ providers: [a, b], events })

      router.dispose()
      expect(a.dispose).toHaveBeenCalled()
      expect(b.dispose).toHaveBeenCalled()
      expect(router.getAvailableProviders()).toHaveLength(0)
    })
  })
})
