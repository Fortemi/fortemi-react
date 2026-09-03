import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TypedEventBus } from '../event-bus.js'
import { CapabilityManager } from '../capability-manager.js'
import {
  configureInferenceRuntime,
  defineInferenceProvider,
  defineInferenceRuntime,
  defineLegacyInferenceProvider,
  defineOpenAICompatibleProvider,
  getConfiguredInferenceProviderId,
  mergeInferenceRuntimeConfigs,
  type InferenceProvider,
  type FortemiBridge,
} from '../index.js'
import { getEmbedFunction, setEmbedFunction } from '../capabilities/embedding-handler.js'
import { getEmbeddingTaskSelectionOptions, setEmbeddingTaskSelectionOptions } from '../capabilities/embedding-handler.js'
import { setLlmFunction } from '../capabilities/llm-handler.js'

function provider(id: string, vectors: number[][]): InferenceProvider {
  return {
    id,
    name: id,
    tier: 'in-browser',
    capabilities: {
      embeddings: true,
      chat: false,
      streaming: false,
      vision: false,
      toolCalling: false,
      structuredOutput: false,
    },
    embed: vi.fn().mockResolvedValue({ vectors, model: id }),
    async listModels() { return [] },
    async probe() { return { status: 'ok' as const, latencyMs: 1 } },
    dispose: vi.fn(),
  }
}

describe('configureInferenceRuntime', () => {
  beforeEach(() => {
    setEmbedFunction(null)
    setLlmFunction(null)
    setEmbeddingTaskSelectionOptions()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setEmbeddingTaskSelectionOptions()
  })

  it('registers configured providers and task routes', async () => {
    const small = provider('small', [[1]])
    const large = provider('large', [[9]])
    const runtime = await configureInferenceRuntime({
      providers: [
        { kind: 'provider', provider: small },
        { kind: 'provider', provider: large },
      ],
      routes: {
        'embedding.document': { providerIds: ['large'], fallback: false },
      },
    })

    expect(runtime.providers.map(p => p.id)).toEqual(['small', 'large'])
    expect(runtime.routeIssues).toEqual([])
    await expect(runtime.registry.embed({ texts: ['doc'], task: 'embedding.document' }))
      .resolves.toMatchObject({ vectors: [[9]] })
  })

  it('returns route validation issues for invalid deployment routes', async () => {
    const runtime = await configureInferenceRuntime({
      providers: [
        { kind: 'provider', provider: provider('small', [[1]]) },
      ],
      routes: {
        'embedding.large-document': {
          providerIds: ['missing', 'small'],
          requirements: { minEmbeddingDimensions: 1536 },
          fallback: false,
        },
      },
    })

    expect(runtime.routeValidation).toHaveLength(1)
    expect(runtime.routeValidation[0]).toMatchObject({
      task: 'embedding.large-document',
      ok: false,
      providerIds: ['missing', 'small'],
      eligibleProviderIds: [],
    })
    expect(runtime.routeIssues.map(issue => issue.code)).toEqual([
      'missing-provider',
      'profile-requirement',
      'no-eligible-provider',
    ])
  })

  it('applies deployment embedding task selection thresholds', async () => {
    await configureInferenceRuntime({
      embeddingTaskSelection: {
        largeDocumentChars: 5000,
        largeDocumentChunks: 6,
      },
    })

    expect(getEmbeddingTaskSelectionOptions()).toEqual({
      largeDocumentChars: 5000,
      largeDocumentChunks: 6,
    })
  })

  it('wires capability loaders to routed providers', async () => {
    const events = new TypedEventBus()
    const manager = new CapabilityManager(events)
    const small = provider('small', [[1]])
    const large = provider('large', [[9]])

    await configureInferenceRuntime({
      events,
      capabilityManager: manager,
      providers: [
        { kind: 'provider', provider: small },
        { kind: 'provider', provider: large },
      ],
      routes: {
        'embedding.document': { providerIds: ['large'], fallback: false },
      },
    })

    await manager.enable('semantic')
    const embed = getEmbedFunction()
    expect(embed).not.toBeNull()
    await expect(embed!(['doc'])).resolves.toEqual([[9]])
    await expect(embed!(['query'], { task: 'embedding.query' })).resolves.toEqual([[1]])
  })

  it('adapts host bridge providers without exposing secrets to core', async () => {
    const bridge: FortemiBridge = {
      version: '1',
      async capabilities() {
        return { secureSecrets: true, providerRouting: true, localNetworkAccess: true, auditLog: true }
      },
      secrets: {
        isAvailable: () => true,
        getSecret: async () => null,
        setSecret: async () => {},
        deleteSecret: async () => {},
      },
      inference: {
        async listProviders() {
          return [{
            id: 'host:embed',
            name: 'Host Embedder',
            tier: 'remote',
            requiresApiKey: true,
            capabilities: { embeddings: true },
          }]
        },
        async probeProvider() {
          return { status: 'ok', latencyMs: 1 }
        },
        async complete() {
          throw new Error('unused')
        },
        async embed(_providerId, request) {
          return { vectors: request.texts.map(() => [7]), model: request.model ?? 'host-model' }
        },
      },
    }

    const runtime = await configureInferenceRuntime({
      bridgeHost: { fortemiBridge: bridge },
      routes: {
        'embedding.query': { providerIds: ['host:embed'], model: 'large-host-embed', fallback: false },
      },
    })

    await expect(runtime.registry.embed({ texts: ['q'], task: 'embedding.query' }))
      .resolves.toMatchObject({ vectors: [[7]], model: 'large-host-embed' })
  })

  it('discovers configured local servers as OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'nomic-embed-text' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const runtime = await configureInferenceRuntime({
      discoverLocal: {
        extraEndpoints: [{
          id: 'custom-local',
          name: 'Custom Local',
          baseURL: 'http://localhost:9999/v1',
          defaultPort: 9999,
        }],
        skipPorts: [11434, 1234, 8080, 8000, 1337],
      },
    })

    expect(runtime.registry.get('local:custom-local')?.tier).toBe('local-server')
  })

  it('composes runtime fragments without losing providers or route overrides', () => {
    const small = provider('small', [[1]])
    const large = provider('large', [[9]])
    const embedFn = vi.fn()

    const base = defineInferenceRuntime({
      providers: [
        defineInferenceProvider(small),
        defineOpenAICompatibleProvider({
          id: 'remote',
          name: 'Remote',
          baseURL: 'https://router.example.com/v1',
          defaultModel: 'fast-chat',
        }),
      ],
      routes: {
        'embedding.query': { providerIds: ['small'], model: 'small-query' },
        'chat.revision': { providerIds: ['remote'], model: 'fast-chat' },
      },
      discoverLocal: false,
      embeddingTaskSelection: {
        largeDocumentChars: 12000,
      },
    })

    const deployment = defineInferenceRuntime({
      providers: [
        defineInferenceProvider(large),
        defineLegacyInferenceProvider({ id: 'legacy', embedFn }),
      ],
      routes: {
        'embedding.query': { providerIds: ['large'], model: 'large-query', fallback: false },
      },
      activeProviderId: 'large',
      discoverLocal: { timeoutMs: 250 },
      embeddingTaskSelection: {
        largeDocumentChunks: 20,
      },
    })

    const merged = mergeInferenceRuntimeConfigs(base, undefined, deployment)

    expect(merged.providers?.map(item => item.kind)).toEqual(['provider', 'openai-compatible', 'provider', 'legacy'])
    expect(merged.providers?.map(getConfiguredInferenceProviderId)).toEqual(['small', 'remote', 'large', 'legacy'])
    expect(merged.routes?.['embedding.query']).toEqual({
      providerIds: ['large'],
      model: 'large-query',
      fallback: false,
    })
    expect(merged.routes?.['chat.revision']).toEqual({ providerIds: ['remote'], model: 'fast-chat' })
    expect(merged.activeProviderId).toBe('large')
    expect(merged.discoverLocal).toEqual({ timeoutMs: 250 })
    expect(merged.embeddingTaskSelection).toEqual({
      largeDocumentChars: 12000,
      largeDocumentChunks: 20,
    })
  })

  it('lets later runtime fragments override providers with the same configured ID', () => {
    const merged = mergeInferenceRuntimeConfigs(
      defineInferenceRuntime({
        providers: [
          defineOpenAICompatibleProvider({
            id: 'remote',
            name: 'Remote A',
            baseURL: 'https://a.example.com/v1',
          }),
          defineLegacyInferenceProvider({ embedFn: vi.fn() }),
        ],
      }),
      defineInferenceRuntime({
        providers: [
          defineOpenAICompatibleProvider({
            id: 'remote',
            name: 'Remote B',
            baseURL: 'https://b.example.com/v1',
          }),
          defineLegacyInferenceProvider({ id: 'legacy', llmFn: vi.fn() }),
        ],
      }),
    )

    expect(merged.providers?.map(getConfiguredInferenceProviderId)).toEqual(['remote', 'legacy'])
    expect(merged.providers?.[0]).toMatchObject({
      kind: 'openai-compatible',
      config: {
        name: 'Remote B',
        baseURL: 'https://b.example.com/v1',
      },
    })
    expect(merged.providers?.[1]).toMatchObject({
      kind: 'legacy',
      id: 'legacy',
    })
  })
})
