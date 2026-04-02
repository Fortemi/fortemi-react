/**
 * FallbackRouter — wraps multiple InferenceProviders with automatic failover.
 * Routes requests to the highest-priority available provider, falling through
 * on errors. Failed providers enter cooldown before retry.
 *
 * @implements #114 provider fallback chains with cooldown
 */

import type { TypedEventBus } from '../event-bus.js'
import type {
  InferenceProvider,
  ProviderCapabilities,
  ProviderTier,
  EmbedRequest,
  EmbedResponse,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ModelInfo,
  ProbeResult,
} from './inference-provider.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FallbackRouterConfig {
  /** Ordered list of providers (highest priority first) */
  providers: InferenceProvider[]
  /** Cooldown durations by error type in ms */
  cooldowns?: CooldownConfig
  /** Event bus for fallback notifications */
  events?: TypedEventBus
}

export interface CooldownConfig {
  /** Cooldown for rate limit errors (HTTP 429) — default 30s */
  rateLimit?: number
  /** Cooldown for server errors (HTTP 5xx) — default 60s */
  serverError?: number
  /** Cooldown for connection failures — default 300s */
  connectionFailure?: number
  /** Cooldown for content policy errors — default 0 (immediate retry with next) */
  contentPolicy?: number
}

const DEFAULT_COOLDOWNS: Required<CooldownConfig> = {
  rateLimit: 30_000,
  serverError: 60_000,
  connectionFailure: 300_000,
  contentPolicy: 0,
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ErrorCategory = 'rate_limit' | 'server_error' | 'connection_failure' | 'content_policy' | 'context_window' | 'unknown'

export function classifyError(error: unknown): ErrorCategory {
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()

  if (lower.includes('429') || lower.includes('rate limit')) return 'rate_limit'
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('504')) return 'server_error'
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('filter'))) return 'content_policy'
  if (lower.includes('context') && (lower.includes('window') || lower.includes('length') || lower.includes('too long'))) return 'context_window'
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('connection') || lower.includes('econnrefused') || lower.includes('timeout')) return 'connection_failure'

  return 'unknown'
}

// ---------------------------------------------------------------------------
// Fallback event types
// ---------------------------------------------------------------------------

export interface FallbackEvent {
  fromProvider: string
  toProvider: string
  errorCategory: ErrorCategory
  error: string
}

export interface CooldownEvent {
  providerId: string
  errorCategory: ErrorCategory
  cooldownMs: number
  expiresAt: number
}

// ---------------------------------------------------------------------------
// Router implementation
// ---------------------------------------------------------------------------

interface CooldownEntry {
  expiresAt: number
  category: ErrorCategory
}

export class FallbackRouter implements InferenceProvider {
  readonly id = 'fallback-router'
  readonly name = 'Fallback Router'
  readonly tier: ProviderTier = 'remote'

  private providers: InferenceProvider[]
  private cooldowns: Required<CooldownConfig>
  private cooldownMap = new Map<string, CooldownEntry>()
  private events?: TypedEventBus

  get capabilities(): ProviderCapabilities {
    // Aggregate capabilities from all providers
    const available = this.getAvailableProviders()
    return {
      embeddings: available.some(p => p.capabilities.embeddings),
      chat: available.some(p => p.capabilities.chat),
      streaming: available.some(p => p.capabilities.streaming),
      vision: available.some(p => p.capabilities.vision),
      toolCalling: available.some(p => p.capabilities.toolCalling),
      structuredOutput: available.some(p => p.capabilities.structuredOutput),
      maxContextTokens: Math.max(
        ...available.map(p => p.capabilities.maxContextTokens ?? 0),
        0,
      ),
    }
  }

  constructor(config: FallbackRouterConfig) {
    this.providers = [...config.providers]
    this.cooldowns = { ...DEFAULT_COOLDOWNS, ...config.cooldowns }
    this.events = config.events
  }

  // -------------------------------------------------------------------------
  // Provider management
  // -------------------------------------------------------------------------

  /** Get providers not currently in cooldown */
  getAvailableProviders(): InferenceProvider[] {
    const now = Date.now()
    return this.providers.filter(p => {
      const cd = this.cooldownMap.get(p.id)
      if (!cd) return true
      if (now >= cd.expiresAt) {
        this.cooldownMap.delete(p.id)
        return true
      }
      return false
    })
  }

  /** Get providers in cooldown with their expiry info */
  getCoolingDown(): Array<{ providerId: string; category: ErrorCategory; expiresAt: number }> {
    const now = Date.now()
    const result: Array<{ providerId: string; category: ErrorCategory; expiresAt: number }> = []
    for (const [id, entry] of this.cooldownMap) {
      if (now < entry.expiresAt) {
        result.push({ providerId: id, category: entry.category, expiresAt: entry.expiresAt })
      }
    }
    return result
  }

  /** Manually clear cooldown for a provider */
  clearCooldown(providerId: string): void {
    this.cooldownMap.delete(providerId)
  }

  /** Clear all cooldowns */
  clearAllCooldowns(): void {
    this.cooldownMap.clear()
  }

  /** Add a provider to the chain (appended at lowest priority) */
  addProvider(provider: InferenceProvider): void {
    this.providers.push(provider)
  }

  /** Remove a provider from the chain */
  removeProvider(id: string): void {
    this.providers = this.providers.filter(p => p.id !== id)
    this.cooldownMap.delete(id)
  }

  /** Reorder providers (new priority order) */
  setOrder(ids: string[]): void {
    const byId = new Map(this.providers.map(p => [p.id, p]))
    const reordered: InferenceProvider[] = []
    for (const id of ids) {
      const p = byId.get(id)
      if (p) reordered.push(p)
    }
    // Append any providers not in the new order list
    for (const p of this.providers) {
      if (!ids.includes(p.id)) reordered.push(p)
    }
    this.providers = reordered
  }

  // -------------------------------------------------------------------------
  // InferenceProvider interface — with fallback
  // -------------------------------------------------------------------------

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return this.withFallback(
      p => p.capabilities.embeddings && !!p.embed,
      p => p.embed!(request),
    )
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withFallback(
      p => p.capabilities.chat && !!p.complete,
      p => p.complete!(request),
    )
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const candidates = this.getAvailableProviders()
      .filter(p => p.capabilities.streaming && p.stream)

    if (candidates.length === 0) {
      throw new Error('No available providers with streaming capability')
    }

    // For streaming, we try the first candidate only (can't retry mid-stream)
    yield* candidates[0].stream!(request)
  }

  async listModels(): Promise<ModelInfo[]> {
    const available = this.getAvailableProviders()
    const results = await Promise.allSettled(
      available.map(p => p.listModels()),
    )
    const models: ModelInfo[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') models.push(...r.value)
    }
    return models
  }

  async probe(): Promise<ProbeResult> {
    const available = this.getAvailableProviders()
    if (available.length === 0) {
      return { status: 'down', latencyMs: 0, message: 'All providers in cooldown' }
    }

    const start = Date.now()
    const results = await Promise.allSettled(
      available.map(p => p.probe()),
    )

    const okCount = results.filter(
      r => r.status === 'fulfilled' && r.value.status === 'ok',
    ).length

    return {
      status: okCount === available.length ? 'ok' : okCount > 0 ? 'degraded' : 'down',
      latencyMs: Date.now() - start,
      message: `${okCount}/${available.length} providers healthy`,
    }
  }

  dispose(): void {
    for (const p of this.providers) {
      p.dispose()
    }
    this.providers = []
    this.cooldownMap.clear()
  }

  // -------------------------------------------------------------------------
  // Core fallback logic
  // -------------------------------------------------------------------------

  private async withFallback<T>(
    filter: (p: InferenceProvider) => boolean,
    execute: (p: InferenceProvider) => Promise<T>,
  ): Promise<T> {
    const candidates = this.getAvailableProviders().filter(filter)

    if (candidates.length === 0) {
      throw new Error('No available providers for this request')
    }

    let lastError: Error | undefined

    for (const provider of candidates) {
      try {
        return await execute(provider)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const category = classifyError(err)
        this.applyCooldown(provider.id, category)

        // Emit fallback event
        const nextCandidate = candidates[candidates.indexOf(provider) + 1]
        if (nextCandidate) {
          this.events?.emit('provider.fallback', {
            fromProvider: provider.id,
            toProvider: nextCandidate.id,
            errorCategory: category,
            error: lastError.message,
          })
        }
      }
    }

    throw lastError ?? new Error('All providers failed')
  }

  private applyCooldown(providerId: string, category: ErrorCategory): void {
    let cooldownMs: number
    switch (category) {
      case 'rate_limit':
        cooldownMs = this.cooldowns.rateLimit
        break
      case 'server_error':
        cooldownMs = this.cooldowns.serverError
        break
      case 'connection_failure':
        cooldownMs = this.cooldowns.connectionFailure
        break
      case 'content_policy':
        cooldownMs = this.cooldowns.contentPolicy
        break
      default:
        cooldownMs = this.cooldowns.serverError // default to server error cooldown
    }

    if (cooldownMs > 0) {
      const expiresAt = Date.now() + cooldownMs
      this.cooldownMap.set(providerId, { expiresAt, category })

      this.events?.emit('provider.cooldown', {
        providerId,
        errorCategory: category,
        cooldownMs,
        expiresAt,
      })
    }
  }
}
