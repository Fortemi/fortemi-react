/**
 * ProviderRegistry — manages InferenceProvider instances.
 * Supports add/remove/getActive/setActive and derives CapabilityManager state.
 *
 * @implements #112 provider registry
 */

import type { TypedEventBus } from '../event-bus.js'
import type {
  InferenceProvider,
  EmbedRequest,
  EmbedResponse,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from './inference-provider.js'
import type { EmbedFunction } from './embedding-handler.js'
import type { LlmCompleteFn } from './llm-handler.js'
import { setEmbedFunction } from './embedding-handler.js'
import { setLlmFunction } from './llm-handler.js'

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private providers = new Map<string, InferenceProvider>()
  private activeId: string | null = null

  constructor(private events?: TypedEventBus) {}

  /** Register a provider. First provider with embedding capability becomes active. */
  add(provider: InferenceProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider '${provider.id}' already registered`)
    }
    this.providers.set(provider.id, provider)
    this.events?.emit('provider.added', { id: provider.id, name: provider.name })

    // Auto-activate first provider
    if (!this.activeId) {
      this.setActive(provider.id)
    }
  }

  /** Remove a provider by ID. If it was active, clears active. */
  remove(id: string): void {
    const provider = this.providers.get(id)
    if (!provider) return

    provider.dispose()
    this.providers.delete(id)

    if (this.activeId === id) {
      this.activeId = null
      this.syncLegacyFunctions()

      // Auto-activate next available provider
      const next = this.providers.values().next()
      if (!next.done) {
        this.setActive(next.value.id)
      }
    }

    this.events?.emit('provider.removed', { id })
  }

  /** Set the active provider by ID */
  setActive(id: string): void {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Provider '${id}' not found`)
    }
    this.activeId = id
    this.syncLegacyFunctions()
    this.events?.emit('provider.active', { id, name: provider.name })
  }

  /** Get the currently active provider */
  getActive(): InferenceProvider | null {
    if (!this.activeId) return null
    return this.providers.get(this.activeId) ?? null
  }

  /** Get a provider by ID */
  get(id: string): InferenceProvider | undefined {
    return this.providers.get(id)
  }

  /** List all registered providers */
  list(): InferenceProvider[] {
    return Array.from(this.providers.values())
  }

  /** Get provider count */
  get size(): number {
    return this.providers.size
  }

  /** Check if any provider supports embeddings */
  hasEmbeddings(): boolean {
    return this.list().some(p => p.capabilities.embeddings && p.embed)
  }

  /** Check if any provider supports chat */
  hasChat(): boolean {
    return this.list().some(p => p.capabilities.chat && p.complete)
  }

  /** Find first provider supporting a given capability */
  findByCapability(cap: keyof InferenceProvider['capabilities']): InferenceProvider | undefined {
    return this.list().find(p => p.capabilities[cap])
  }

  /** Convenience: embed using active provider */
  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const provider = this.getActive()
    if (!provider?.embed) {
      throw new Error('No active provider with embedding capability')
    }
    return provider.embed(request)
  }

  /** Convenience: complete using active provider */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.getActive()
    if (!provider?.complete) {
      throw new Error('No active provider with chat capability')
    }
    return provider.complete(request)
  }

  /** Convenience: stream using active provider */
  stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const provider = this.getActive()
    if (!provider?.stream) {
      throw new Error('No active provider with streaming capability')
    }
    return provider.stream(request)
  }

  /** Dispose all providers */
  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose()
    }
    this.providers.clear()
    this.activeId = null
    this.syncLegacyFunctions()
  }

  // -------------------------------------------------------------------------
  // Legacy bridge — keeps setEmbedFunction/setLlmFunction in sync
  // -------------------------------------------------------------------------

  /**
   * Sync the legacy bare function slots with the active provider.
   * This maintains backward compatibility: job-queue-worker.ts and other
   * consumers that call getEmbedFunction() / getLlmFunction() still work.
   */
  private syncLegacyFunctions(): void {
    const active = this.getActive()

    if (active?.embed && active.capabilities.embeddings) {
      const embedBridge: EmbedFunction = (texts) =>
        active.embed!({ texts }).then(r => r.vectors)
      setEmbedFunction(embedBridge)
    } else {
      setEmbedFunction(null)
    }

    if (active?.complete && active.capabilities.chat) {
      const llmBridge: LlmCompleteFn = (prompt, options) =>
        active.complete!({
          prompt,
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        }).then(r => r.text)
      setLlmFunction(llmBridge)
    } else {
      setLlmFunction(null)
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy adapter — wraps bare functions as an InferenceProvider
// ---------------------------------------------------------------------------

/**
 * Create an InferenceProvider from legacy bare functions.
 * Used by setEmbedFunction/setLlmFunction backward compat layer.
 */
export function createLegacyProvider(options: {
  embedFn?: EmbedFunction | null
  llmFn?: LlmCompleteFn | null
  id?: string
  name?: string
}): InferenceProvider {
  const { embedFn, llmFn, id = 'legacy', name = 'Legacy Provider' } = options

  return {
    id,
    name,
    tier: 'in-browser',
    capabilities: {
      embeddings: !!embedFn,
      chat: !!llmFn,
      streaming: false,
      vision: false,
      toolCalling: false,
      structuredOutput: false,
    },

    embed: embedFn
      ? async (request) => ({
          vectors: await embedFn(request.texts),
          model: 'legacy',
        })
      : undefined,

    complete: llmFn
      ? async (request) => ({
          text: await llmFn(request.prompt, {
            maxTokens: request.maxTokens,
            temperature: request.temperature,
          }),
          model: 'legacy',
        })
      : undefined,

    async listModels() {
      const models = []
      if (embedFn) models.push({ id: 'legacy-embed', capabilities: { embeddings: true } })
      if (llmFn) models.push({ id: 'legacy-llm', capabilities: { chat: true } })
      return models
    },

    async probe() {
      return { status: 'ok' as const, latencyMs: 0, message: 'Legacy function injection' }
    },

    dispose() {
      // No-op for legacy functions
    },
  }
}
