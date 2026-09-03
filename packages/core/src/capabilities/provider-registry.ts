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
  InferenceTask,
  ProviderCapabilities,
  ProviderCostTier,
  ProviderDataClass,
  ProviderPrivacyTier,
  ProviderTier,
  ProbeResult,
  StreamChunk,
} from './inference-provider.js'
import type { EmbedFunction } from './embedding-handler.js'
import type { LlmCompleteFn } from './llm-handler.js'
import { setEmbedFunction } from './embedding-handler.js'
import { setLlmFunction } from './llm-handler.js'
import { classifyError } from './fallback-router.js'

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private providers = new Map<string, InferenceProvider>()
  private activeId: string | null = null
  private routes = new Map<InferenceTask, ProviderRoutePolicy>()

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

  setRoute(task: InferenceTask, policy: ProviderRoutePolicy): void {
    const cloned = cloneProviderRoutePolicy(policy)
    this.routes.set(task, cloned)
    this.events?.emit('provider.route.configured', {
      task,
      providerIds: cloned.providerIds ?? [],
      model: cloned.model,
      fallback: cloned.fallback,
      hasRequirements: Boolean(cloned.requirements),
    })
  }

  getRoute(task: InferenceTask): ProviderRoutePolicy | undefined {
    const route = this.routes.get(task)
    return route ? cloneProviderRoutePolicy(route) : undefined
  }

  clearRoute(task: InferenceTask): void {
    this.routes.delete(task)
    this.events?.emit('provider.route.cleared', { task })
  }

  clearRoutes(): void {
    const tasks = Array.from(this.routes.keys())
    this.routes.clear()
    if (tasks.length === 0) {
      this.events?.emit('provider.route.cleared', {})
      return
    }
    for (const task of tasks) {
      this.events?.emit('provider.route.cleared', { task })
    }
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
    const route = request.task ? this.routes.get(request.task) : undefined
    return this.withRouteFallback(request.task, 'embeddings', request.model, async (selection) => {
      if (!selection.provider.embed) throw new Error('No routed provider with embedding capability')
      return selection.provider.embed(withResolvedModel(request, selection.model))
    }, route?.fallback !== false)
  }

  /** Convenience: complete using active provider */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const route = request.task ? this.routes.get(request.task) : undefined
    return this.withRouteFallback(request.task, 'chat', request.model, async (selection) => {
      if (!selection.provider.complete) throw new Error('No routed provider with chat capability')
      return selection.provider.complete(withResolvedModel(request, selection.model))
    }, route?.fallback !== false)
  }

  /** Convenience: stream using active provider */
  stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const { provider, model } = this.resolveProvider(request.task, 'streaming', request.model, true)
    if (!provider.stream) throw new Error('No routed provider with streaming capability')
    return provider.stream(withResolvedModel(request, model))
  }

  previewRoute(
    task: InferenceTask | undefined,
    capability: keyof ProviderCapabilities,
    requestModel?: string,
  ): ProviderRouteSelection {
    const { provider, model, routeMatched } = this.resolveProvider(task, capability, requestModel, false)
    return {
      provider,
      providerId: provider.id,
      providerName: provider.name,
      tier: provider.tier,
      capability,
      task,
      model,
      routeMatched,
    }
  }

  async probeRoute(
    task: InferenceTask | undefined,
    capability: keyof ProviderCapabilities,
    requestModel?: string,
  ): Promise<ProviderRouteProbeResult> {
    const selection = this.previewRoute(task, capability, requestModel)
    const probe = await selection.provider.probe()
    return { ...selection, probe }
  }

  validateRoute(
    task: InferenceTask,
    capability = inferInferenceTaskCapability(task),
    policy = this.routes.get(task),
  ): ProviderRouteValidation {
    return validateProviderRoute(task, capability, policy, this.list())
  }

  validateRoutes(): ProviderRouteValidation[] {
    return Array.from(this.routes.entries()).map(([task, policy]) =>
      this.validateRoute(task, inferInferenceTaskCapability(task), policy),
    )
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
      const embedBridge: EmbedFunction = (texts, options) => {
        const request: EmbedRequest = {
          texts,
          task: options?.task ?? 'embedding.document',
        }
        if (options?.model) request.model = options.model
        return this.embed(request).then(r => r.vectors)
      }
      setEmbedFunction(embedBridge)
    } else {
      setEmbedFunction(null)
    }

    if (active?.complete && active.capabilities.chat) {
      const llmBridge: LlmCompleteFn = (prompt, options) => {
        const request: CompletionRequest = {
          prompt,
          task: options?.task ?? 'chat.general',
        }
        if (options?.model) request.model = options.model
        if (options?.maxTokens !== undefined) request.maxTokens = options.maxTokens
        if (options?.temperature !== undefined) request.temperature = options.temperature
        return this.complete(request).then(r => r.text)
      }
      setLlmFunction(llmBridge)
    } else {
      setLlmFunction(null)
    }
  }

  private resolveProvider(
    task: InferenceTask | undefined,
    capability: keyof ProviderCapabilities,
    requestModel?: string,
    emitSelection = false,
  ): ProviderRouteSelection {
    const candidates = this.resolveRouteSelections(task, capability, requestModel)

    const selection = candidates[0]
    if (!selection) {
      const label = task ? ` for task '${task}'` : ''
      throw new Error(`No provider satisfies ${String(capability)} route${label}`)
    }

    if (emitSelection) {
      this.emitRouteSelected(selection)
    }

    return selection
  }

  private resolveRouteSelections(
    task: InferenceTask | undefined,
    capability: keyof ProviderCapabilities,
    requestModel?: string,
  ): ProviderRouteSelection[] {
    const route = task ? this.routes.get(task) : undefined
    const model = requestModel ?? route?.model
    const routeMatched = Boolean(route)
    return this.resolveCandidates(route, capability)
      .filter(provider => Boolean(provider.capabilities[capability]))
      .filter(provider => capability !== 'embeddings' || Boolean(provider.embed))
      .filter(provider => capability !== 'chat' || Boolean(provider.complete))
      .filter(provider => capability !== 'streaming' || Boolean(provider.stream))
      .map(provider => ({
        provider,
        providerId: provider.id,
        providerName: provider.name,
        tier: provider.tier,
        capability,
        task,
        model,
        routeMatched,
      }))
  }

  private emitRouteSelected(selection: ProviderRouteSelection): void {
    this.events?.emit('provider.route.selected', {
      providerId: selection.providerId,
      providerName: selection.providerName,
      tier: selection.tier,
      capability: String(selection.capability),
      task: selection.task,
      model: selection.model,
      routeMatched: selection.routeMatched,
    })
  }

  private async withRouteFallback<T>(
    task: InferenceTask | undefined,
    capability: keyof ProviderCapabilities,
    requestModel: string | undefined,
    execute: (selection: ProviderRouteSelection) => Promise<T>,
    allowFallback: boolean,
  ): Promise<T> {
    const selections = this.resolveRouteSelections(task, capability, requestModel)
    const candidates = allowFallback ? selections : selections.slice(0, 1)
    if (!candidates.length) {
      const label = task ? ` for task '${task}'` : ''
      const route = task ? this.routes.get(task) : undefined
      this.emitRouteFailed(
        undefined,
        capability,
        task,
        requestModel ?? route?.model,
        Boolean(route),
        0,
        0,
        0,
        'no_provider',
        `No provider satisfies ${String(capability)} route${label}`,
      )
      throw new Error(`No provider satisfies ${String(capability)} route${label}`)
    }

    let lastError: Error | undefined
    let lastSelection: ProviderRouteSelection | undefined
    let lastErrorCategory = 'unknown'
    const start = Date.now()
    for (let index = 0; index < candidates.length; index++) {
      const selection = candidates[index]
      try {
        this.emitRouteSelected(selection)
        const result = await execute(selection)
        this.emitRouteCompleted(selection, index + 1, index, Date.now() - start)
        return result
      } catch (err) {
        lastSelection = selection
        lastError = err instanceof Error ? err : new Error(String(err))
        lastErrorCategory = classifyError(err)
        const next = candidates[index + 1]
        if (next) {
          this.events?.emit('provider.fallback', {
            fromProvider: selection.providerId,
            toProvider: next.providerId,
            errorCategory: lastErrorCategory,
            error: lastError.message,
          })
        }
      }
    }

    this.emitRouteFailed(
      lastSelection,
      capability,
      task,
      requestModel,
      candidates[0]?.routeMatched ?? Boolean(task && this.routes.get(task)),
      candidates.length,
      Math.max(candidates.length - 1, 0),
      Date.now() - start,
      lastErrorCategory,
      lastError?.message ?? 'All routed providers failed',
    )
    throw lastError ?? new Error('All routed providers failed')
  }

  private emitRouteCompleted(
    selection: ProviderRouteSelection,
    attempt: number,
    fallbackCount: number,
    latencyMs: number,
  ): void {
    this.events?.emit('provider.route.completed', {
      providerId: selection.providerId,
      providerName: selection.providerName,
      tier: selection.tier,
      capability: String(selection.capability),
      task: selection.task,
      model: selection.model,
      routeMatched: selection.routeMatched,
      attempt,
      fallbackCount,
      latencyMs,
    })
  }

  private emitRouteFailed(
    selection: ProviderRouteSelection | undefined,
    capability: keyof ProviderCapabilities,
    task: InferenceTask | undefined,
    model: string | undefined,
    routeMatched: boolean,
    attempt: number,
    fallbackCount: number,
    latencyMs: number,
    errorCategory: string,
    error: string,
  ): void {
    this.events?.emit('provider.route.failed', {
      providerId: selection?.providerId,
      providerName: selection?.providerName,
      tier: selection?.tier,
      capability: String(capability),
      task,
      model: selection?.model ?? model,
      routeMatched,
      attempt,
      fallbackCount,
      latencyMs,
      errorCategory,
      error,
    })
  }

  private resolveCandidates(
    route: ProviderRoutePolicy | undefined,
    capability: keyof ProviderCapabilities,
  ): InferenceProvider[] {
    const all = this.list()
    if (!route) {
      const active = this.getActive()
      return active ? [active, ...all.filter(provider => provider.id !== active.id)] : all
    }

    const byId = new Map(all.map(provider => [provider.id, provider]))
    const selected: InferenceProvider[] = []

    for (const id of route.providerIds ?? []) {
      const provider = byId.get(id)
      if (provider) selected.push(provider)
    }

    const hasExplicitProviderIds = Boolean(route.providerIds?.length)
    const remaining = hasExplicitProviderIds || route.fallback === false
      ? selected
      : all

    return remaining.filter(provider => {
      if (route.tiers?.length && !route.tiers.includes(provider.tier)) return false
      if (!providerSatisfiesRouteRequirements(provider, route.requirements, capability)) return false
      return true
    })
  }
}

function withResolvedModel<T extends { model?: string }>(request: T, model?: string): T {
  return model === undefined ? request : { ...request, model }
}

export interface ProviderRoutePolicy {
  providerIds?: string[]
  tiers?: ProviderTier[]
  model?: string
  fallback?: boolean
  requirements?: ProviderRouteRequirements
}

export interface ProviderRouteRequirements {
  privacyTiers?: ProviderPrivacyTier[]
  maxCostTier?: ProviderCostTier
  minContextTokens?: number
  minEmbeddingDimensions?: number
  dataClass?: ProviderDataClass
  maxInputChars?: number
}

export interface ProviderRouteSelection {
  provider: InferenceProvider
  providerId: string
  providerName: string
  tier: ProviderTier
  capability: keyof ProviderCapabilities
  task?: InferenceTask
  model?: string
  routeMatched: boolean
}

export interface ProviderRouteProbeResult extends ProviderRouteSelection {
  probe: ProbeResult
}

export type ProviderRouteValidationSeverity = 'error' | 'warning'

export interface ProviderRouteValidationIssue {
  severity: ProviderRouteValidationSeverity
  code:
    | 'missing-provider'
    | 'unsupported-capability'
    | 'missing-handler'
    | 'profile-requirement'
    | 'empty-explicit-chain'
    | 'no-eligible-provider'
  message: string
  providerId?: string
}

export interface ProviderRouteValidation {
  task: InferenceTask
  capability: keyof ProviderCapabilities
  policy?: ProviderRoutePolicy
  providerIds: string[]
  eligibleProviderIds: string[]
  issues: ProviderRouteValidationIssue[]
  ok: boolean
}

export function inferInferenceTaskCapability(task: InferenceTask): keyof ProviderCapabilities {
  if (task.startsWith('embedding.')) return 'embeddings'
  if (task.startsWith('vision.')) return 'vision'
  return 'chat'
}

export function validateProviderRoute(
  task: InferenceTask,
  capability: keyof ProviderCapabilities,
  policy: ProviderRoutePolicy | undefined,
  providers: InferenceProvider[],
): ProviderRouteValidation {
  const byId = new Map(providers.map(provider => [provider.id, provider]))
  const providerIds = policy?.providerIds ?? []
  const issues: ProviderRouteValidationIssue[] = []
  const eligibleProviderIds: string[] = []

  if (policy && providerIds.length === 0 && policy.fallback === false) {
    issues.push({
      severity: 'error',
      code: 'empty-explicit-chain',
      message: `Route '${task}' disables fallback but does not name a provider.`,
    })
  }

  const candidates = providerIds.length
    ? providerIds.map(id => byId.get(id)).filter((provider): provider is InferenceProvider => Boolean(provider))
    : providers

  for (const providerId of providerIds) {
    if (!byId.has(providerId)) {
      issues.push({
        severity: 'error',
        code: 'missing-provider',
        providerId,
        message: `Route '${task}' references missing provider '${providerId}'.`,
      })
    }
  }

  for (const provider of candidates) {
    if (policy?.tiers?.length && !policy.tiers.includes(provider.tier)) continue

    if (!provider.capabilities[capability]) {
      issues.push({
        severity: 'error',
        code: 'unsupported-capability',
        providerId: provider.id,
        message: `Provider '${provider.id}' does not support ${String(capability)} for route '${task}'.`,
      })
      continue
    }

    if (capability === 'embeddings' && !provider.embed) {
      issues.push({
        severity: 'error',
        code: 'missing-handler',
        providerId: provider.id,
        message: `Provider '${provider.id}' has no embedding handler for route '${task}'.`,
      })
      continue
    }
    if (capability === 'chat' && !provider.complete) {
      issues.push({
        severity: 'error',
        code: 'missing-handler',
        providerId: provider.id,
        message: `Provider '${provider.id}' has no chat handler for route '${task}'.`,
      })
      continue
    }
    if (capability === 'streaming' && !provider.stream) {
      issues.push({
        severity: 'error',
        code: 'missing-handler',
        providerId: provider.id,
        message: `Provider '${provider.id}' has no streaming handler for route '${task}'.`,
      })
      continue
    }

    const requirementIssue = getProviderRouteRequirementIssue(provider, policy?.requirements, capability)
    if (requirementIssue) {
      issues.push({
        severity: 'error',
        code: 'profile-requirement',
        providerId: provider.id,
        message: requirementIssue,
      })
      continue
    }

    eligibleProviderIds.push(provider.id)
  }

  if (!eligibleProviderIds.length) {
    issues.push({
      severity: 'error',
      code: 'no-eligible-provider',
      message: `Route '${task}' has no eligible ${String(capability)} provider.`,
    })
  }

  return {
    task,
    capability,
    policy: policy ? cloneProviderRoutePolicy(policy) : undefined,
    providerIds,
    eligibleProviderIds,
    issues,
    ok: !issues.some(issue => issue.severity === 'error'),
  }
}

function cloneProviderRoutePolicy(policy: ProviderRoutePolicy): ProviderRoutePolicy {
  return {
    ...policy,
    providerIds: policy.providerIds ? [...policy.providerIds] : undefined,
    tiers: policy.tiers ? [...policy.tiers] : undefined,
    requirements: policy.requirements
      ? {
          ...policy.requirements,
          privacyTiers: policy.requirements.privacyTiers
            ? [...policy.requirements.privacyTiers]
            : undefined,
        }
      : undefined,
  }
}

const COST_ORDER: ProviderCostTier[] = ['free', 'low', 'medium', 'high']

export function providerSatisfiesRouteRequirements(
  provider: InferenceProvider,
  requirements: ProviderRouteRequirements | undefined,
  capability: keyof ProviderCapabilities,
): boolean {
  return getProviderRouteRequirementIssue(provider, requirements, capability) === undefined
}

export function getProviderRouteRequirementIssue(
  provider: InferenceProvider,
  requirements: ProviderRouteRequirements | undefined,
  capability: keyof ProviderCapabilities,
): string | undefined {
  if (!requirements) return undefined
  const profile = provider.profile

  if (requirements.privacyTiers?.length) {
    const privacy = profile?.privacyTier ?? privacyTierFromProviderTier(provider.tier)
    if (!requirements.privacyTiers.includes(privacy)) {
      return `Provider '${provider.id}' does not match required privacy tier`
    }
  }

  if (requirements.maxCostTier) {
    const cost = profile?.costTier
    if (!cost || COST_ORDER.indexOf(cost) > COST_ORDER.indexOf(requirements.maxCostTier)) {
      return `Provider '${provider.id}' does not match required cost tier`
    }
  }

  if (requirements.minContextTokens) {
    const context = provider.capabilities.maxContextTokens
    if (!context || context < requirements.minContextTokens) {
      return `Provider '${provider.id}' does not advertise enough context`
    }
  }

  if (capability === 'embeddings' && requirements.minEmbeddingDimensions) {
    const dimensions = profile?.embeddingDimensions ?? []
    if (!dimensions.some(dimension => dimension >= requirements.minEmbeddingDimensions!)) {
      return `Provider '${provider.id}' does not advertise enough embedding dimensions`
    }
  }

  if (requirements.dataClass) {
    const allowed = profile?.dataClasses ?? defaultDataClasses(provider.tier)
    if (!allowed.includes(requirements.dataClass)) {
      return `Provider '${provider.id}' does not allow required data class`
    }
  }

  if (requirements.maxInputChars) {
    const maxInputChars = profile?.maxInputChars
    if (!maxInputChars || maxInputChars < requirements.maxInputChars) {
      return `Provider '${provider.id}' does not advertise enough input capacity`
    }
  }

  return undefined
}

function privacyTierFromProviderTier(tier: ProviderTier): ProviderPrivacyTier {
  if (tier === 'remote') return 'external'
  if (tier === 'chrome-ai') return 'host-managed'
  return 'local'
}

function defaultDataClasses(tier: ProviderTier): ProviderDataClass[] {
  if (tier === 'remote') return ['public']
  return ['public', 'private', 'sensitive']
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
  profile?: InferenceProvider['profile']
}): InferenceProvider {
  const { embedFn, llmFn, id = 'legacy', name = 'Legacy Provider' } = options

  return {
    id,
    name,
    tier: 'in-browser',
    profile: options.profile ?? {
      privacyTier: 'local',
      costTier: 'free',
      dataClasses: ['public', 'private', 'sensitive'],
    },
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
          vectors: await embedFn(request.texts, embedOptionsFromRequest(request)),
          model: 'legacy',
        })
      : undefined,

    complete: llmFn
      ? async (request) => ({
          text: await llmFn(request.prompt, llmOptionsFromRequest(request)),
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

function embedOptionsFromRequest(request: EmbedRequest): Parameters<EmbedFunction>[1] {
  const options: NonNullable<Parameters<EmbedFunction>[1]> = {}
  if (request.task) options.task = request.task
  if (request.model) options.model = request.model
  return Object.keys(options).length ? options : undefined
}

function llmOptionsFromRequest(request: CompletionRequest): Parameters<LlmCompleteFn>[1] {
  const options: NonNullable<Parameters<LlmCompleteFn>[1]> = {}
  if (request.maxTokens !== undefined) options.maxTokens = request.maxTokens
  if (request.temperature !== undefined) options.temperature = request.temperature
  if (request.task) options.task = request.task
  if (request.model) options.model = request.model
  return Object.keys(options).length ? options : undefined
}
