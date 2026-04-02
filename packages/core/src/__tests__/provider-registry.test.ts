/**
 * Tests for ProviderRegistry and InferenceProvider interface.
 * @implements #112 formal InferenceProvider interface
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TypedEventBus } from '../event-bus.js'
import { ProviderRegistry, createLegacyProvider } from '../capabilities/provider-registry.js'
import { getEmbedFunction, setEmbedFunction } from '../capabilities/embedding-handler.js'
import { getLlmFunction, setLlmFunction } from '../capabilities/llm-handler.js'
import type { InferenceProvider } from '../capabilities/inference-provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockProvider(overrides: Partial<InferenceProvider> & { id: string }): InferenceProvider {
  return {
    name: overrides.id,
    tier: 'in-browser',
    capabilities: {
      embeddings: true,
      chat: true,
      streaming: false,
      vision: false,
      toolCalling: false,
      structuredOutput: false,
    },
    embed: vi.fn().mockResolvedValue({ vectors: [[1, 2, 3]], model: 'mock' }),
    complete: vi.fn().mockResolvedValue({ text: 'hello', model: 'mock' }),
    async listModels() { return [] },
    async probe() { return { status: 'ok' as const, latencyMs: 1 } },
    dispose: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  let events: TypedEventBus
  let registry: ProviderRegistry

  beforeEach(() => {
    events = new TypedEventBus()
    registry = new ProviderRegistry(events)
    // Clear legacy functions between tests
    setEmbedFunction(null)
    setLlmFunction(null)
  })

  describe('add / remove / list', () => {
    it('adds a provider and auto-activates the first one', () => {
      const p = mockProvider({ id: 'test-1' })
      registry.add(p)

      expect(registry.size).toBe(1)
      expect(registry.getActive()).toBe(p)
    })

    it('rejects duplicate provider IDs', () => {
      registry.add(mockProvider({ id: 'dup' }))
      expect(() => registry.add(mockProvider({ id: 'dup' }))).toThrow("'dup' already registered")
    })

    it('lists all registered providers', () => {
      registry.add(mockProvider({ id: 'a' }))
      registry.add(mockProvider({ id: 'b' }))

      const list = registry.list()
      expect(list).toHaveLength(2)
      expect(list.map(p => p.id)).toEqual(['a', 'b'])
    })

    it('removes a provider and disposes it', () => {
      const p = mockProvider({ id: 'rm-me' })
      registry.add(p)
      registry.remove('rm-me')

      expect(registry.size).toBe(0)
      expect(p.dispose).toHaveBeenCalled()
    })

    it('auto-activates next provider when active is removed', () => {
      const a = mockProvider({ id: 'a' })
      const b = mockProvider({ id: 'b' })
      registry.add(a)
      registry.add(b)

      registry.remove('a')
      expect(registry.getActive()?.id).toBe('b')
    })

    it('remove is a no-op for unknown ID', () => {
      registry.remove('nonexistent') // should not throw
    })
  })

  describe('setActive / getActive', () => {
    it('switches active provider', () => {
      registry.add(mockProvider({ id: 'a' }))
      registry.add(mockProvider({ id: 'b' }))

      registry.setActive('b')
      expect(registry.getActive()?.id).toBe('b')
    })

    it('throws for unknown provider ID', () => {
      expect(() => registry.setActive('nope')).toThrow("'nope' not found")
    })

    it('returns null when no providers registered', () => {
      expect(registry.getActive()).toBeNull()
    })
  })

  describe('get', () => {
    it('retrieves provider by ID', () => {
      const p = mockProvider({ id: 'find-me' })
      registry.add(p)
      expect(registry.get('find-me')).toBe(p)
    })

    it('returns undefined for unknown ID', () => {
      expect(registry.get('missing')).toBeUndefined()
    })
  })

  describe('capability queries', () => {
    it('hasEmbeddings returns true when provider supports it', () => {
      registry.add(mockProvider({ id: 'e', capabilities: {
        embeddings: true, chat: false, streaming: false,
        vision: false, toolCalling: false, structuredOutput: false,
      }}))
      expect(registry.hasEmbeddings()).toBe(true)
    })

    it('hasChat returns false when no chat provider', () => {
      registry.add(mockProvider({ id: 'no-chat', capabilities: {
        embeddings: true, chat: false, streaming: false,
        vision: false, toolCalling: false, structuredOutput: false,
      }, complete: undefined }))
      expect(registry.hasChat()).toBe(false)
    })

    it('findByCapability returns first matching provider', () => {
      registry.add(mockProvider({ id: 'no-vision', capabilities: {
        embeddings: true, chat: true, streaming: false,
        vision: false, toolCalling: false, structuredOutput: false,
      }}))
      registry.add(mockProvider({ id: 'has-vision', capabilities: {
        embeddings: true, chat: true, streaming: false,
        vision: true, toolCalling: false, structuredOutput: false,
      }}))
      expect(registry.findByCapability('vision')?.id).toBe('has-vision')
    })
  })

  describe('convenience methods (embed / complete / stream)', () => {
    it('embed delegates to active provider', async () => {
      const p = mockProvider({ id: 'active' })
      registry.add(p)

      const result = await registry.embed({ texts: ['hello'] })
      expect(result.vectors).toEqual([[1, 2, 3]])
      expect(p.embed).toHaveBeenCalledWith({ texts: ['hello'] })
    })

    it('complete delegates to active provider', async () => {
      const p = mockProvider({ id: 'active' })
      registry.add(p)

      const result = await registry.complete({ prompt: 'hi' })
      expect(result.text).toBe('hello')
    })

    it('embed throws when no active provider', async () => {
      await expect(registry.embed({ texts: ['x'] })).rejects.toThrow('No active provider')
    })

    it('complete throws when no active provider', async () => {
      await expect(registry.complete({ prompt: 'x' })).rejects.toThrow('No active provider')
    })

    it('stream throws when no active provider', () => {
      expect(() => registry.stream({ prompt: 'x' })).toThrow('No active provider')
    })
  })

  describe('legacy bridge — syncs setEmbedFunction / setLlmFunction', () => {
    it('sets embed function when provider with embeddings is activated', () => {
      registry.add(mockProvider({ id: 'has-embed' }))

      const fn = getEmbedFunction()
      expect(fn).not.toBeNull()
    })

    it('clears embed function when active provider is removed', () => {
      registry.add(mockProvider({ id: 'only' }))
      expect(getEmbedFunction()).not.toBeNull()

      registry.remove('only')
      expect(getEmbedFunction()).toBeNull()
    })

    it('sets LLM function when provider with chat is activated', () => {
      registry.add(mockProvider({ id: 'has-chat' }))

      const fn = getLlmFunction()
      expect(fn).not.toBeNull()
    })

    it('bridge embed function calls through to provider', async () => {
      const embedMock = vi.fn().mockResolvedValue({ vectors: [[4, 5, 6]], model: 'm' })
      registry.add(mockProvider({ id: 'p', embed: embedMock }))

      const fn = getEmbedFunction()!
      const result = await fn(['test text'])
      expect(result).toEqual([[4, 5, 6]])
      expect(embedMock).toHaveBeenCalledWith({ texts: ['test text'] })
    })

    it('bridge LLM function calls through to provider', async () => {
      const completeMock = vi.fn().mockResolvedValue({ text: 'response', model: 'm' })
      registry.add(mockProvider({ id: 'p', complete: completeMock }))

      const fn = getLlmFunction()!
      const result = await fn('my prompt', { maxTokens: 100, temperature: 0.5 })
      expect(result).toBe('response')
      expect(completeMock).toHaveBeenCalledWith({
        prompt: 'my prompt',
        maxTokens: 100,
        temperature: 0.5,
      })
    })
  })

  describe('events', () => {
    it('emits provider.added on add', () => {
      const handler = vi.fn()
      events.on('provider.added', handler)

      registry.add(mockProvider({ id: 'ev-add', name: 'Test' }))
      expect(handler).toHaveBeenCalledWith({ id: 'ev-add', name: 'Test' })
    })

    it('emits provider.removed on remove', () => {
      const handler = vi.fn()
      events.on('provider.removed', handler)

      registry.add(mockProvider({ id: 'ev-rm' }))
      registry.remove('ev-rm')
      expect(handler).toHaveBeenCalledWith({ id: 'ev-rm' })
    })

    it('emits provider.active on setActive', () => {
      const handler = vi.fn()
      events.on('provider.active', handler)

      registry.add(mockProvider({ id: 'a' }))
      registry.add(mockProvider({ id: 'b', name: 'Provider B' }))
      registry.setActive('b')
      expect(handler).toHaveBeenCalledWith({ id: 'b', name: 'Provider B' })
    })
  })

  describe('dispose', () => {
    it('disposes all providers and clears registry', () => {
      const a = mockProvider({ id: 'a' })
      const b = mockProvider({ id: 'b' })
      registry.add(a)
      registry.add(b)

      registry.dispose()

      expect(a.dispose).toHaveBeenCalled()
      expect(b.dispose).toHaveBeenCalled()
      expect(registry.size).toBe(0)
      expect(registry.getActive()).toBeNull()
    })

    it('clears legacy functions on dispose', () => {
      registry.add(mockProvider({ id: 'x' }))
      expect(getEmbedFunction()).not.toBeNull()

      registry.dispose()
      expect(getEmbedFunction()).toBeNull()
      expect(getLlmFunction()).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// createLegacyProvider
// ---------------------------------------------------------------------------

describe('createLegacyProvider', () => {
  it('creates provider from embed function', async () => {
    const embedFn = vi.fn().mockResolvedValue([[1, 2, 3]])
    const provider = createLegacyProvider({ embedFn })

    expect(provider.id).toBe('legacy')
    expect(provider.tier).toBe('in-browser')
    expect(provider.capabilities.embeddings).toBe(true)
    expect(provider.capabilities.chat).toBe(false)
    expect(provider.embed).toBeDefined()
    expect(provider.complete).toBeUndefined()

    const result = await provider.embed!({ texts: ['hello'] })
    expect(result.vectors).toEqual([[1, 2, 3]])
    expect(embedFn).toHaveBeenCalledWith(['hello'])
  })

  it('creates provider from LLM function', async () => {
    const llmFn = vi.fn().mockResolvedValue('response')
    const provider = createLegacyProvider({ llmFn })

    expect(provider.capabilities.embeddings).toBe(false)
    expect(provider.capabilities.chat).toBe(true)
    expect(provider.embed).toBeUndefined()
    expect(provider.complete).toBeDefined()

    const result = await provider.complete!({ prompt: 'hi', maxTokens: 50 })
    expect(result.text).toBe('response')
    expect(llmFn).toHaveBeenCalledWith('hi', { maxTokens: 50, temperature: undefined })
  })

  it('creates provider with both functions', () => {
    const provider = createLegacyProvider({
      embedFn: vi.fn(),
      llmFn: vi.fn(),
      id: 'custom',
      name: 'Custom',
    })

    expect(provider.id).toBe('custom')
    expect(provider.name).toBe('Custom')
    expect(provider.capabilities.embeddings).toBe(true)
    expect(provider.capabilities.chat).toBe(true)
  })

  it('listModels returns models based on available functions', async () => {
    const provider = createLegacyProvider({ embedFn: vi.fn(), llmFn: vi.fn() })
    const models = await provider.listModels()
    expect(models).toHaveLength(2)
    expect(models.map(m => m.id)).toContain('legacy-embed')
    expect(models.map(m => m.id)).toContain('legacy-llm')
  })

  it('probe returns ok status', async () => {
    const provider = createLegacyProvider({})
    const result = await provider.probe()
    expect(result.status).toBe('ok')
  })

  it('dispose is a no-op', () => {
    const provider = createLegacyProvider({})
    provider.dispose() // should not throw
  })
})
