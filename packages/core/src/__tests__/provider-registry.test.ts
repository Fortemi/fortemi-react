/**
 * Tests for ProviderRegistry and InferenceProvider interface.
 * @implements #112 formal InferenceProvider interface
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TypedEventBus } from '../event-bus.js'
import {
  ProviderRegistry,
  createLegacyProvider,
  getProviderRouteRequirementIssue,
  inferInferenceTaskCapability,
  providerSatisfiesRouteRequirements,
  validateProviderRoute,
} from '../capabilities/provider-registry.js'
import { getEmbedFunction, setEmbedFunction } from '../capabilities/embedding-handler.js'
import { getLlmFunction, setLlmFunction } from '../capabilities/llm-handler.js'
import type { InferenceProvider } from '../capabilities/inference-provider.js'
import type { ProviderRoutePolicy } from '../capabilities/provider-registry.js'

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
      await expect(registry.embed({ texts: ['x'] })).rejects.toThrow('No provider satisfies embeddings route')
    })

    it('complete throws when no active provider', async () => {
      await expect(registry.complete({ prompt: 'x' })).rejects.toThrow('No provider satisfies chat route')
    })

    it('stream throws when no active provider', () => {
      expect(() => registry.stream({ prompt: 'x' })).toThrow('No provider satisfies streaming route')
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
      expect(embedMock).toHaveBeenCalledWith({
        texts: ['test text'],
        task: 'embedding.document',
      })
    })

    it('bridge LLM function calls through to provider', async () => {
      const completeMock = vi.fn().mockResolvedValue({ text: 'response', model: 'm' })
      registry.add(mockProvider({ id: 'p', complete: completeMock }))

      const fn = getLlmFunction()!
      const result = await fn('my prompt', { maxTokens: 100, temperature: 0.5 })
      expect(result).toBe('response')
      expect(completeMock).toHaveBeenCalledWith({
        prompt: 'my prompt',
        task: 'chat.general',
        maxTokens: 100,
        temperature: 0.5,
      })
    })
  })

  describe('task routing', () => {
    it('routes embeddings to a task-specific provider and model', async () => {
      const small = mockProvider({
        id: 'small',
        embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: 'small-embed' }),
      })
      const large = mockProvider({
        id: 'large',
        embed: vi.fn().mockResolvedValue({ vectors: [[9]], model: 'large-embed' }),
      })
      registry.add(small)
      registry.add(large)
      registry.setRoute('embedding.large-document', {
        providerIds: ['large'],
        model: 'text-embedding-3-large',
        fallback: false,
      })

      const result = await registry.embed({ texts: ['long document'], task: 'embedding.large-document' })

      expect(result.vectors).toEqual([[9]])
      expect(large.embed).toHaveBeenCalledWith({
        texts: ['long document'],
        task: 'embedding.large-document',
        model: 'text-embedding-3-large',
      })
      expect(small.embed).not.toHaveBeenCalled()
    })

    it('clones route policies on set and get', async () => {
      const first = mockProvider({
        id: 'first',
        embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: 'first' }),
      })
      const second = mockProvider({
        id: 'second',
        embed: vi.fn().mockResolvedValue({ vectors: [[2]], model: 'second' }),
      })
      const third = mockProvider({
        id: 'third',
        embed: vi.fn().mockResolvedValue({ vectors: [[3]], model: 'third' }),
      })
      registry.add(first)
      registry.add(second)
      registry.add(third)

      const policy: ProviderRoutePolicy = {
        providerIds: ['second'],
        requirements: {
          privacyTiers: ['local'],
        },
        fallback: false,
      }
      registry.setRoute('embedding.document', policy)

      policy.providerIds![0] = 'third'
      policy.requirements!.privacyTiers![0] = 'external'
      const snapshot = registry.getRoute('embedding.document')
      snapshot!.providerIds![0] = 'third'
      snapshot!.requirements!.privacyTiers![0] = 'external'

      await expect(registry.embed({ texts: ['doc'], task: 'embedding.document' }))
        .resolves.toMatchObject({ vectors: [[2]] })
      expect(second.embed).toHaveBeenCalled()
      expect(third.embed).not.toHaveBeenCalled()
    })

    it('legacy embedding bridge uses the document embedding route by default', async () => {
      const active = mockProvider({
        id: 'active',
        embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: 'active' }),
      })
      const documentEmbedder = mockProvider({
        id: 'document-embedder',
        embed: vi.fn().mockResolvedValue({ vectors: [[2]], model: 'document' }),
      })
      registry.add(active)
      registry.add(documentEmbedder)
      registry.setRoute('embedding.document', { providerIds: ['document-embedder'], fallback: false })

      const fn = getEmbedFunction()!
      const result = await fn(['note body'])

      expect(result).toEqual([[2]])
      expect(documentEmbedder.embed).toHaveBeenCalledWith({
        texts: ['note body'],
        task: 'embedding.document',
      })
      expect(active.embed).not.toHaveBeenCalled()
    })

    it('legacy embedding bridge accepts a query embedding route hint', async () => {
      const documentEmbedder = mockProvider({
        id: 'document-embedder',
        embed: vi.fn().mockResolvedValue({ vectors: [[2]], model: 'document' }),
      })
      const queryEmbedder = mockProvider({
        id: 'query-embedder',
        embed: vi.fn().mockResolvedValue({ vectors: [[3]], model: 'query' }),
      })
      registry.add(documentEmbedder)
      registry.add(queryEmbedder)
      registry.setRoute('embedding.document', { providerIds: ['document-embedder'], fallback: false })
      registry.setRoute('embedding.query', { providerIds: ['query-embedder'], fallback: false })

      const fn = getEmbedFunction()!
      const result = await fn(['search text'], { task: 'embedding.query' })

      expect(result).toEqual([[3]])
      expect(queryEmbedder.embed).toHaveBeenCalledWith({
        texts: ['search text'],
        task: 'embedding.query',
      })
      expect(documentEmbedder.embed).not.toHaveBeenCalled()
    })

    it('legacy LLM bridge accepts a chat task route hint', async () => {
      const general = mockProvider({
        id: 'general',
        complete: vi.fn().mockResolvedValue({ text: 'general', model: 'general' }),
      })
      const revision = mockProvider({
        id: 'revision',
        complete: vi.fn().mockResolvedValue({ text: 'revision', model: 'revision' }),
      })
      registry.add(general)
      registry.add(revision)
      registry.setRoute('chat.revision', { providerIds: ['revision'], model: 'larger-reviser', fallback: false })

      const fn = getLlmFunction()!
      const result = await fn('revise this', { task: 'chat.revision', maxTokens: 500 })

      expect(result).toBe('revision')
      expect(revision.complete).toHaveBeenCalledWith({
        prompt: 'revise this',
        task: 'chat.revision',
        model: 'larger-reviser',
        maxTokens: 500,
      })
      expect(general.complete).not.toHaveBeenCalled()
    })

    it('routes private document embeddings to a local provider when required', async () => {
      const remote = mockProvider({
        id: 'remote',
        tier: 'remote',
        profile: { privacyTier: 'external', costTier: 'low', dataClasses: ['public'] },
        embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: 'remote' }),
      })
      const local = mockProvider({
        id: 'local',
        tier: 'local-server',
        profile: {
          privacyTier: 'local',
          costTier: 'free',
          dataClasses: ['public', 'private', 'sensitive'],
        },
        embed: vi.fn().mockResolvedValue({ vectors: [[2]], model: 'local' }),
      })
      registry.add(remote)
      registry.add(local)
      registry.setRoute('embedding.document', {
        providerIds: ['remote', 'local'],
        requirements: { privacyTiers: ['local'], dataClass: 'private' },
      })

      await expect(registry.embed({ texts: ['private note'], task: 'embedding.document' }))
        .resolves.toMatchObject({ vectors: [[2]] })
      expect(remote.embed).not.toHaveBeenCalled()
    })

    it('skips providers above the route cost ceiling', async () => {
      const premium = mockProvider({
        id: 'premium',
        profile: { privacyTier: 'external', costTier: 'high', dataClasses: ['public'] },
        complete: vi.fn().mockResolvedValue({ text: 'premium', model: 'premium' }),
      })
      const cheap = mockProvider({
        id: 'cheap',
        profile: { privacyTier: 'external', costTier: 'low', dataClasses: ['public'] },
        complete: vi.fn().mockResolvedValue({ text: 'cheap', model: 'cheap' }),
      })
      registry.add(premium)
      registry.add(cheap)
      registry.setRoute('chat.tagging', {
        providerIds: ['premium', 'cheap'],
        requirements: { maxCostTier: 'low' },
      })

      await expect(registry.complete({ prompt: 'tag me', task: 'chat.tagging' }))
        .resolves.toMatchObject({ text: 'cheap' })
      expect(premium.complete).not.toHaveBeenCalled()
    })

    it('routes large document embeddings to a provider with enough dimensions', async () => {
      const small = mockProvider({
        id: 'small',
        profile: { embeddingDimensions: [384], privacyTier: 'local', costTier: 'free' },
        embed: vi.fn().mockResolvedValue({ vectors: [[1]], model: 'small' }),
      })
      const large = mockProvider({
        id: 'large',
        profile: { embeddingDimensions: [1024, 3072], privacyTier: 'local', costTier: 'free' },
        embed: vi.fn().mockResolvedValue({ vectors: [[9]], model: 'large' }),
      })
      registry.add(small)
      registry.add(large)
      registry.setRoute('embedding.large-document', {
        providerIds: ['small', 'large'],
        requirements: { minEmbeddingDimensions: 1536 },
      })

      await expect(registry.embed({ texts: ['long doc'], task: 'embedding.large-document' }))
        .resolves.toMatchObject({ vectors: [[9]] })
      expect(small.embed).not.toHaveBeenCalled()
    })

    it('fails closed when no provider satisfies route requirements', async () => {
      const failedHandler = vi.fn()
      events.on('provider.route.failed', failedHandler)
      registry.add(mockProvider({
        id: 'remote',
        tier: 'remote',
        profile: { privacyTier: 'external', dataClasses: ['public'], costTier: 'low' },
      }))
      registry.setRoute('embedding.document', {
        requirements: { dataClass: 'regulated', privacyTiers: ['local'] },
      })

      await expect(registry.embed({ texts: ['regulated'], task: 'embedding.document' }))
        .rejects.toThrow("No provider satisfies embeddings route for task 'embedding.document'")
      expect(failedHandler).toHaveBeenCalledWith(expect.objectContaining({
        providerId: undefined,
        capability: 'embeddings',
        task: 'embedding.document',
        attempt: 0,
        fallbackCount: 0,
        errorCategory: 'no_provider',
      }))
    })

    it('exposes route requirement validation for UI warnings', () => {
      const provider = mockProvider({
        id: 'local-small',
        tier: 'local-server',
        profile: {
          privacyTier: 'local',
          costTier: 'free',
          embeddingDimensions: [384],
          dataClasses: ['public', 'private'],
        },
      })

      expect(providerSatisfiesRouteRequirements(provider, {
        privacyTiers: ['local'],
        maxCostTier: 'free',
        dataClass: 'private',
      }, 'embeddings')).toBe(true)
      expect(getProviderRouteRequirementIssue(provider, {
        minEmbeddingDimensions: 1024,
      }, 'embeddings')).toContain('embedding dimensions')
    })

    it('infers provider capability from inference task names', () => {
      expect(inferInferenceTaskCapability('embedding.query')).toBe('embeddings')
      expect(inferInferenceTaskCapability('chat.revision')).toBe('chat')
      expect(inferInferenceTaskCapability('vision.general')).toBe('vision')
    })

    it('validates route chains without sending inference payloads', () => {
      const embedder = mockProvider({
        id: 'embedder',
        profile: {
          privacyTier: 'local',
          costTier: 'free',
          embeddingDimensions: [768],
          dataClasses: ['public', 'private', 'sensitive'],
        },
      })
      const chatOnly = mockProvider({
        id: 'chat-only',
        capabilities: {
          embeddings: false,
          chat: true,
          streaming: false,
          vision: false,
          toolCalling: false,
          structuredOutput: false,
        },
        embed: undefined,
      })

      const valid = validateProviderRoute('embedding.document', 'embeddings', {
        providerIds: ['embedder'],
        requirements: {
          privacyTiers: ['local'],
          minEmbeddingDimensions: 384,
          dataClass: 'private',
        },
      }, [embedder, chatOnly])
      expect(valid.ok).toBe(true)
      expect(valid.eligibleProviderIds).toEqual(['embedder'])

      const invalid = validateProviderRoute('embedding.document', 'embeddings', {
        providerIds: ['missing', 'chat-only', 'embedder'],
        requirements: {
          minEmbeddingDimensions: 1536,
        },
      }, [embedder, chatOnly])
      expect(invalid.ok).toBe(false)
      expect(invalid.issues.map(issue => issue.code)).toEqual([
        'missing-provider',
        'unsupported-capability',
        'profile-requirement',
        'no-eligible-provider',
      ])
    })

    it('previews and probes a routed task without running inference', async () => {
      const provider = mockProvider({
        id: 'probe-me',
        name: 'Probe Me',
        probe: vi.fn().mockResolvedValue({ status: 'ok', latencyMs: 12, message: 'ready' }),
      })
      registry.add(provider)
      registry.setRoute('embedding.query', {
        providerIds: ['probe-me'],
        model: 'query-model',
        fallback: false,
      })

      expect(registry.previewRoute('embedding.query', 'embeddings')).toMatchObject({
        providerId: 'probe-me',
        providerName: 'Probe Me',
        tier: 'in-browser',
        capability: 'embeddings',
        task: 'embedding.query',
        model: 'query-model',
        routeMatched: true,
      })

      await expect(registry.probeRoute('embedding.query', 'embeddings')).resolves.toMatchObject({
        providerId: 'probe-me',
        model: 'query-model',
        probe: { status: 'ok', latencyMs: 12, message: 'ready' },
      })
      expect(provider.embed).not.toHaveBeenCalled()
      expect(provider.probe).toHaveBeenCalled()
    })

    it('falls back to the next routed embedding provider when the first fails', async () => {
      const fallbackHandler = vi.fn()
      const completedHandler = vi.fn()
      events.on('provider.fallback', fallbackHandler)
      events.on('provider.route.completed', completedHandler)
      const first = mockProvider({
        id: 'first',
        embed: vi.fn().mockRejectedValue(new Error('503 unavailable')),
      })
      const second = mockProvider({
        id: 'second',
        embed: vi.fn().mockResolvedValue({ vectors: [[8]], model: 'second' }),
      })
      registry.add(first)
      registry.add(second)
      registry.setRoute('embedding.query', {
        providerIds: ['first', 'second'],
        fallback: true,
      })

      await expect(registry.embed({ texts: ['SECRET_PAYLOAD'], task: 'embedding.query' }))
        .resolves.toMatchObject({ vectors: [[8]] })
      expect(first.embed).toHaveBeenCalled()
      expect(second.embed).toHaveBeenCalled()
      expect(fallbackHandler).toHaveBeenCalledWith({
        fromProvider: 'first',
        toProvider: 'second',
        errorCategory: 'server_error',
        error: '503 unavailable',
      })
      expect(completedHandler).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'second',
        capability: 'embeddings',
        task: 'embedding.query',
        attempt: 2,
        fallbackCount: 1,
      }))
      expect(JSON.stringify(completedHandler.mock.calls)).not.toContain('SECRET_PAYLOAD')
    })

    it('does not fall back outside an explicit provider chain', async () => {
      const first = mockProvider({
        id: 'first',
        embed: vi.fn().mockRejectedValue(new Error('503 unavailable')),
      })
      const unlisted = mockProvider({
        id: 'unlisted',
        embed: vi.fn().mockResolvedValue({ vectors: [[99]], model: 'unlisted' }),
      })
      registry.add(first)
      registry.add(unlisted)
      registry.setRoute('embedding.query', {
        providerIds: ['first'],
        fallback: true,
      })

      await expect(registry.embed({ texts: ['query'], task: 'embedding.query' }))
        .rejects.toThrow('503 unavailable')
      expect(unlisted.embed).not.toHaveBeenCalled()
    })

    it('does not fall back after a routed provider error when fallback is disabled', async () => {
      const failedHandler = vi.fn()
      events.on('provider.route.failed', failedHandler)
      const first = mockProvider({
        id: 'first',
        complete: vi.fn().mockRejectedValue(new Error('network down')),
      })
      const second = mockProvider({
        id: 'second',
        complete: vi.fn().mockResolvedValue({ text: 'second', model: 'second' }),
      })
      registry.add(first)
      registry.add(second)
      registry.setRoute('chat.general', {
        providerIds: ['first', 'second'],
        fallback: false,
      })

      await expect(registry.complete({ prompt: 'hello', task: 'chat.general' }))
        .rejects.toThrow('network down')
      expect(second.complete).not.toHaveBeenCalled()
      expect(failedHandler).toHaveBeenCalledWith(expect.objectContaining({
        providerId: 'first',
        capability: 'chat',
        task: 'chat.general',
        attempt: 1,
        fallbackCount: 0,
        errorCategory: 'connection_failure',
        error: 'network down',
      }))
      expect(JSON.stringify(failedHandler.mock.calls)).not.toContain('hello')
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

    it('emits privacy-safe route configuration events', () => {
      const configured = vi.fn()
      const cleared = vi.fn()
      events.on('provider.route.configured', configured)
      events.on('provider.route.cleared', cleared)

      registry.setRoute('embedding.document', {
        providerIds: ['large'],
        model: 'large-embedder',
        fallback: false,
        requirements: { minEmbeddingDimensions: 1536 },
      })
      registry.clearRoute('embedding.document')

      expect(configured).toHaveBeenCalledWith({
        task: 'embedding.document',
        providerIds: ['large'],
        model: 'large-embedder',
        fallback: false,
        hasRequirements: true,
      })
      expect(cleared).toHaveBeenCalledWith({ task: 'embedding.document' })
      expect(JSON.stringify(configured.mock.calls)).not.toContain('prompt')
      expect(JSON.stringify(configured.mock.calls)).not.toContain('note')
    })

    it('emits privacy-safe provider.route.selected when routing a request', async () => {
      const handler = vi.fn()
      events.on('provider.route.selected', handler)
      registry.add(mockProvider({ id: 'route-event', name: 'Route Event Provider' }))

      await registry.embed({ texts: ['sensitive text must not be emitted'], task: 'embedding.query' })

      expect(handler).toHaveBeenCalledWith({
        providerId: 'route-event',
        providerName: 'Route Event Provider',
        tier: 'in-browser',
        capability: 'embeddings',
        task: 'embedding.query',
        model: undefined,
        routeMatched: false,
      })
      expect(JSON.stringify(handler.mock.calls)).not.toContain('sensitive text')
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
      expect(embedFn).toHaveBeenCalledWith(['hello'], undefined)
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
    expect(llmFn).toHaveBeenCalledWith('hi', { maxTokens: 50 })
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
