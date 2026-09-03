import {
  createLocalProviderProfile,
  discoverLocalProviders,
  OpenAICompatibleProvider,
  ProviderRegistry,
  getFortemiSecretStore,
  hasFortemiSecureSecrets,
  inferLocalEmbeddingDimensions,
  type CapabilityManager,
  type DiscoveryOptions,
  type DiscoveredProvider,
  type FortemiBridge,
  type FortemiSecretStore,
  type InferenceProvider,
  type InferenceTask,
  type ModelInfo,
  type OpenAIProviderConfig,
  type ProviderCostTier,
  type ProviderDataClass,
  type ProviderPrivacyTier,
  type ProviderProfile,
  type TypedEventBus,
} from '@fortemi/core'

declare global {
  interface Window {
    fortemiBridge?: FortemiBridge
    fortemiSecureStorage?: FortemiSecretStore
  }
}

export type ProviderPresetId =
  | 'browser'
  | 'openai'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'fireworks'
  | 'deepinfra'
  | 'xai'
  | 'ollama'
  | 'lm-studio'
  | 'llama-cpp'
  | 'vllm'
  | 'jan'
  | 'custom'

export interface ProviderPreset {
  id: ProviderPresetId
  name: string
  baseURL: string
  defaultModel: string
  defaultEmbeddingModel?: string
  tier: OpenAIProviderConfig['tier']
  requiresApiKey: boolean
  headers?: Record<string, string>
  profile?: ProviderProfile
}

export interface StoredProviderConfig {
  id: string
  presetId: ProviderPresetId
  name: string
  baseURL: string
  defaultModel: string
  defaultEmbeddingModel?: string
  tier: OpenAIProviderConfig['tier']
  requiresApiKey: boolean
  headers?: Record<string, string>
  active: boolean
  profile?: ProviderProfile
}

export interface RouteTaskOption {
  task: InferenceTask
  label: string
  capability: 'embeddings' | 'chat'
}

export interface StoredProviderRouteConfig {
  task: InferenceTask
  providerIds?: string[]
  /** @deprecated use providerIds; retained to migrate existing saved settings. */
  providerId: string
  model?: string
  fallback: boolean
  privacyTier?: ProviderPrivacyTier | ''
  maxCostTier?: ProviderCostTier | ''
  dataClass?: ProviderDataClass | ''
  minEmbeddingDimensions?: number
  maxInputChars?: number
}

export interface ProviderActivationResult {
  ok: boolean
  message: string
}

export interface LocalProviderDiscoveryMergeResult {
  configs: StoredProviderConfig[]
  discovered: number
  added: number
  updated: number
  message: string
}

export interface ProviderModelRefreshResult extends ProviderActivationResult {
  config: StoredProviderConfig
  modelCount: number
}

const PROVIDERS_KEY = 'fortemi:provider-configs'
const ACTIVE_PROVIDER_KEY = 'fortemi:active-provider'
const ROUTES_KEY = 'fortemi:provider-routes'
const SECRET_PREFIX = 'fortemi.provider.'

export const BROWSER_PROVIDER_ID = 'browser'

export const ROUTE_TASKS: RouteTaskOption[] = [
  { task: 'embedding.query', label: 'Query embeddings', capability: 'embeddings' },
  { task: 'embedding.document', label: 'Document embeddings', capability: 'embeddings' },
  { task: 'embedding.large-document', label: 'Large document embeddings', capability: 'embeddings' },
  { task: 'chat.general', label: 'General chat', capability: 'chat' },
  { task: 'chat.revision', label: 'Revision', capability: 'chat' },
  { task: 'chat.tagging', label: 'Tagging', capability: 'chat' },
  { task: 'chat.linking', label: 'Linking', capability: 'chat' },
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    defaultEmbeddingModel: 'text-embedding-3-small',
    tier: 'remote',
    requiresApiKey: true,
    profile: {
      privacyTier: 'external',
      costTier: 'medium',
      embeddingDimensions: [1536, 3072],
      dataClasses: ['public'],
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    defaultEmbeddingModel: 'openai/text-embedding-3-small',
    tier: 'remote',
    requiresApiKey: true,
    profile: {
      privacyTier: 'external',
      costTier: 'medium',
      embeddingDimensions: [1536],
      dataClasses: ['public'],
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    tier: 'remote',
    requiresApiKey: true,
    profile: remotePublicProfile('low'),
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    defaultEmbeddingModel: 'mistral-embed',
    tier: 'remote',
    requiresApiKey: true,
    profile: {
      privacyTier: 'external',
      costTier: 'low',
      embeddingDimensions: [1024],
      dataClasses: ['public'],
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultEmbeddingModel: 'BAAI/bge-large-en-v1.5',
    tier: 'remote',
    requiresApiKey: true,
    profile: {
      privacyTier: 'external',
      costTier: 'medium',
      embeddingDimensions: [1024],
      dataClasses: ['public'],
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    tier: 'remote',
    requiresApiKey: true,
    profile: remotePublicProfile('low'),
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    defaultEmbeddingModel: 'BAAI/bge-base-en-v1.5',
    tier: 'remote',
    requiresApiKey: true,
    profile: {
      privacyTier: 'external',
      costTier: 'low',
      embeddingDimensions: [768],
      dataClasses: ['public'],
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    tier: 'remote',
    requiresApiKey: true,
    profile: remotePublicProfile('medium'),
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    defaultEmbeddingModel: 'nomic-embed-text',
    tier: 'local-server',
    requiresApiKey: false,
    profile: localPrivateProfile([768]),
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
    profile: localPrivateProfile(),
  },
  {
    id: 'llama-cpp',
    name: 'llama.cpp',
    baseURL: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
    profile: localPrivateProfile(),
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseURL: 'http://localhost:8000/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
    profile: localPrivateProfile(),
  },
  {
    id: 'jan',
    name: 'Jan',
    baseURL: 'http://localhost:1337/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
    profile: localPrivateProfile(),
  },
]

function remotePublicProfile(costTier: ProviderCostTier): ProviderProfile {
  return {
    privacyTier: 'external',
    costTier,
    dataClasses: ['public'],
  }
}

function localPrivateProfile(embeddingDimensions?: number[]): ProviderProfile {
  return {
    privacyTier: 'local',
    costTier: 'free',
    embeddingDimensions,
    dataClasses: ['public', 'private', 'sensitive'],
  }
}

export function getDefaultProviderConfigs(): StoredProviderConfig[] {
  return [
    {
      id: BROWSER_PROVIDER_ID,
      presetId: 'browser',
      name: 'In-browser ML',
      baseURL: '',
      defaultModel: '',
      tier: 'in-browser',
      requiresApiKey: false,
      active: true,
      profile: localPrivateProfile([384]),
    },
    ...PROVIDER_PRESETS.map((preset) => ({
      id: preset.id,
      presetId: preset.id,
      name: preset.name,
      baseURL: preset.baseURL,
      defaultModel: preset.defaultModel,
      defaultEmbeddingModel: preset.defaultEmbeddingModel,
      tier: preset.tier,
      requiresApiKey: preset.requiresApiKey,
      headers: preset.headers,
      active: false,
      profile: preset.profile,
    })),
  ]
}

export function loadProviderConfigs(): StoredProviderConfig[] {
  const stored = localStorage.getItem(PROVIDERS_KEY)
  const defaults = getDefaultProviderConfigs()
  if (!stored) return defaults
  try {
    const parsed = JSON.parse(stored) as StoredProviderConfig[]
    const merged = new Map(defaults.map((config) => [config.id, config]))
    for (const config of parsed) {
      merged.set(config.id, { ...merged.get(config.id), ...config })
    }
    const activeId = localStorage.getItem(ACTIVE_PROVIDER_KEY) ?? BROWSER_PROVIDER_ID
    return Array.from(merged.values()).map((config) => ({
      ...config,
      profile: normalizeProviderProfile(config.profile),
      active: config.id === activeId,
    }))
  } catch {
    return defaults
  }
}

export function saveProviderConfigs(configs: StoredProviderConfig[]): void {
  const sanitized = configs.map((config) => ({ ...config, active: false }))
  localStorage.setItem(PROVIDERS_KEY, JSON.stringify(sanitized))
  const active = configs.find((config) => config.active)
  localStorage.setItem(ACTIVE_PROVIDER_KEY, active?.id ?? BROWSER_PROVIDER_ID)
}

export async function discoverAndMergeLocalProviderConfigs(
  current: StoredProviderConfig[],
  options: DiscoveryOptions = {},
): Promise<LocalProviderDiscoveryMergeResult> {
  const discovered = await discoverLocalProviders(options)
  if (!discovered.length) {
    return {
      configs: current,
      discovered: 0,
      added: 0,
      updated: 0,
      message: 'No local OpenAI-compatible providers were discovered.',
    }
  }

  const configs = current.map((config) => ({ ...config }))
  let added = 0
  let updated = 0

  for (const provider of discovered) {
    const index = findMatchingProviderConfig(configs, provider)
    if (index >= 0) {
      configs[index] = mergeDiscoveredProviderConfig(configs[index], provider)
      updated += 1
    } else {
      configs.push(createDiscoveredProviderConfig(provider))
      added += 1
    }
  }

  return {
    configs,
    discovered: discovered.length,
    added,
    updated,
    message: `Discovered ${discovered.length} local provider${discovered.length === 1 ? '' : 's'} (${added} added, ${updated} updated).`,
  }
}

export function getDefaultRouteConfigs(): StoredProviderRouteConfig[] {
  return ROUTE_TASKS.map(({ task }) => ({
    task,
    providerId: '',
    fallback: true,
  }))
}

export function createSuggestedProviderRouteConfigs(
  configs: StoredProviderConfig[],
): StoredProviderRouteConfig[] {
  const embeddingLocal = sortEmbeddingProviders(configs.filter(isLocalProvider).filter(supportsConfiguredEmbeddings), 'query')
  const embeddingAny = sortEmbeddingProviders(configs.filter(supportsConfiguredEmbeddings), 'depth')
  const chatLocal = sortChatProviders(configs.filter(isLocalProvider).filter(supportsConfiguredChat))
  const chatAny = sortChatProviders(configs.filter(supportsConfiguredChat))

  return ROUTE_TASKS.map(({ task }) => {
    switch (task) {
      case 'embedding.query':
        return createRouteConfig(task, embeddingLocal.slice(0, 3), {
          privacyTier: embeddingLocal.length ? 'local' : '',
          maxCostTier: embeddingLocal.length ? 'free' : '',
          dataClass: embeddingLocal.length ? 'private' : '',
          minEmbeddingDimensions: embeddingLocal.length ? Math.min(bestEmbeddingDimension(embeddingLocal[0]), 384) || undefined : undefined,
        })
      case 'embedding.document': {
        const providers = embeddingLocal.length ? sortEmbeddingProviders(embeddingLocal, 'depth') : embeddingAny
        return createRouteConfig(task, providers.slice(0, 3), {
          privacyTier: providers.length && providers.every(isLocalProvider) ? 'local' : '',
          maxCostTier: providers.length && providers.every(isLocalProvider) ? 'free' : '',
          dataClass: providers.length && providers.every(isLocalProvider) ? 'private' : '',
        })
      }
      case 'embedding.large-document': {
        const providers = embeddingAny
        const minDimensions = suggestedLargeEmbeddingDimensions(providers[0])
        return createRouteConfig(task, providers.slice(0, 3), {
          privacyTier: providers.length && providers.every(isLocalProvider) ? 'local' : '',
          maxCostTier: providers.length && providers.every(isLocalProvider) ? 'free' : '',
          dataClass: providers.length && providers.every(isLocalProvider) ? 'private' : '',
          minEmbeddingDimensions: minDimensions,
        })
      }
      case 'chat.revision':
        return createRouteConfig(task, preferActiveProvider(chatAny).slice(0, 3))
      case 'chat.general':
      case 'chat.tagging':
      case 'chat.linking': {
        const providers = chatLocal.length ? chatLocal : chatAny
        return createRouteConfig(task, providers.slice(0, 3), {
          privacyTier: providers.length && providers.every(isLocalProvider) ? 'local' : '',
          maxCostTier: providers.length && providers.every(isLocalProvider) ? 'free' : '',
          dataClass: providers.length && providers.every(isLocalProvider) ? 'private' : '',
        })
      }
      default:
        return createRouteConfig(task, [])
    }
  })
}

export function loadProviderRouteConfigs(): StoredProviderRouteConfig[] {
  const defaults = getDefaultRouteConfigs()
  const stored = localStorage.getItem(ROUTES_KEY)
  if (!stored) return defaults
  try {
    const parsed = JSON.parse(stored) as StoredProviderRouteConfig[]
    const merged = new Map(defaults.map((config) => [config.task, config]))
    for (const config of parsed) {
      if (merged.has(config.task)) {
        merged.set(config.task, {
          ...merged.get(config.task),
          ...config,
          providerIds: normalizeProviderIds(config),
          minEmbeddingDimensions: normalizeOptionalNumber(config.minEmbeddingDimensions),
          maxInputChars: normalizeOptionalNumber(config.maxInputChars),
        })
      }
    }
    return Array.from(merged.values())
  } catch {
    return defaults
  }
}

export function saveProviderRouteConfigs(configs: StoredProviderRouteConfig[]): void {
  localStorage.setItem(ROUTES_KEY, JSON.stringify(configs))
}

export function applyProviderRouteConfigs(
  configs: StoredProviderRouteConfig[],
  providerRegistry: ProviderRegistry,
): void {
  for (const config of configs) {
    const providerIds = normalizeProviderIds(config)
    if (!providerIds.length) {
      providerRegistry.clearRoute(config.task)
      continue
    }

    providerRegistry.setRoute(config.task, {
      providerIds,
      model: config.model?.trim() || undefined,
      fallback: config.fallback,
      requirements: {
        privacyTiers: config.privacyTier ? [config.privacyTier] : undefined,
        maxCostTier: config.maxCostTier || undefined,
        dataClass: config.dataClass || undefined,
        minEmbeddingDimensions: config.minEmbeddingDimensions,
        maxInputChars: config.maxInputChars,
      },
    })
  }
}

export async function hasSecureStorage(): Promise<boolean> {
  return hasFortemiSecureSecrets(window)
}

export function getSecretKey(providerId: string): string {
  return `${SECRET_PREFIX}${providerId}.apiKey`
}

export async function setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  const secrets = getFortemiSecretStore(window)
  if (!secrets || !(await hasSecureStorage())) {
    throw new Error('Secure storage is not available in this browser host.')
  }
  await secrets.setSecret(getSecretKey(providerId), apiKey)
}

export async function clearProviderApiKey(providerId: string): Promise<void> {
  const secrets = getFortemiSecretStore(window)
  if (!secrets || !(await hasSecureStorage())) return
  await secrets.deleteSecret(getSecretKey(providerId))
}

async function getProviderApiKey(providerId: string): Promise<string | undefined> {
  const secrets = getFortemiSecretStore(window)
  if (!secrets || !(await hasSecureStorage())) return undefined
  return (await secrets.getSecret(getSecretKey(providerId))) ?? undefined
}

let registry: ProviderRegistry | null = null
let activeProvider: InferenceProvider | null = null

function getRegistry(events: TypedEventBus, sharedRegistry?: ProviderRegistry): ProviderRegistry {
  if (sharedRegistry) return sharedRegistry
  if (!registry) registry = new ProviderRegistry(events)
  return registry
}

function clearRegistry(sharedRegistry?: ProviderRegistry): void {
  if (sharedRegistry) {
    for (const provider of sharedRegistry.list()) {
      if (provider.id !== BROWSER_PROVIDER_ID) sharedRegistry.remove(provider.id)
    }
  } else {
    registry?.dispose()
    registry = null
  }
  activeProvider = null
}

export function activeConfiguredProviderSupports(capability: 'semantic' | 'llm'): boolean {
  if (!activeProvider) return false
  if (capability === 'semantic') {
    return activeProvider.capabilities.embeddings && !!activeProvider.embed
  }
  return activeProvider.capabilities.chat && !!activeProvider.complete
}

export async function activateProvider(
  config: StoredProviderConfig,
  capabilityManager: CapabilityManager,
  events: TypedEventBus,
  sharedRegistry?: ProviderRegistry,
): Promise<ProviderActivationResult> {
  if (config.id === BROWSER_PROVIDER_ID) {
    const nextRegistry = getRegistry(events, sharedRegistry)
    if (nextRegistry.get(BROWSER_PROVIDER_ID)) {
      nextRegistry.setActive(BROWSER_PROVIDER_ID)
      activeProvider = nextRegistry.get(BROWSER_PROVIDER_ID) ?? null
    } else {
      clearRegistry(sharedRegistry)
    }
    return { ok: true, message: 'Using in-browser transformers.js and WebLLM.' }
  }

  const apiKey = config.requiresApiKey ? await getProviderApiKey(config.id) : undefined
  if (config.requiresApiKey && !apiKey) {
    if (!sharedRegistry) clearRegistry()
    return {
      ok: false,
      message: 'API key was not loaded because secure storage is unavailable or empty.',
    }
  }

  const nextRegistry = getRegistry(events, sharedRegistry)
  if (nextRegistry.get(config.id)) nextRegistry.remove(config.id)
  const provider = createOpenAIProvider(config, apiKey)
  nextRegistry.add(provider)
  nextRegistry.setActive(provider.id)
  activeProvider = provider

  await enableReadyCapabilities(provider, capabilityManager)
  return { ok: true, message: `Using ${config.name}.` }
}

export async function syncConfiguredProviders(
  configs: StoredProviderConfig[],
  capabilityManager: CapabilityManager,
  events: TypedEventBus,
  sharedRegistry?: ProviderRegistry,
): Promise<ProviderActivationResult> {
  const nextRegistry = getRegistry(events, sharedRegistry)
  const activeConfig = configs.find((config) => config.active) ?? configs.find((config) => config.id === BROWSER_PROVIDER_ID)
  const messages: string[] = []

  for (const provider of nextRegistry.list()) {
    if (provider.id !== BROWSER_PROVIDER_ID && configs.some((config) => config.id === provider.id)) {
      nextRegistry.remove(provider.id)
    }
  }

  for (const config of configs) {
    if (config.id === BROWSER_PROVIDER_ID) continue
    const apiKey = config.requiresApiKey ? await getProviderApiKey(config.id) : undefined
    if (config.requiresApiKey && !apiKey) {
      messages.push(`${config.name}: secure key unavailable`)
      continue
    }
    nextRegistry.add(createOpenAIProvider(config, apiKey))
  }

  if (activeConfig?.id === BROWSER_PROVIDER_ID) {
    if (nextRegistry.get(BROWSER_PROVIDER_ID)) {
      nextRegistry.setActive(BROWSER_PROVIDER_ID)
      activeProvider = nextRegistry.get(BROWSER_PROVIDER_ID) ?? null
      return { ok: true, message: messages.length ? messages.join('; ') : 'Using in-browser transformers.js and WebLLM.' }
    }
    activeProvider = null
    return { ok: true, message: messages.length ? messages.join('; ') : 'Using browser-local capability loaders.' }
  }

  const active = activeConfig ? nextRegistry.get(activeConfig.id) : null
  if (!active || !activeConfig) {
    activeProvider = nextRegistry.get(BROWSER_PROVIDER_ID) ?? null
    if (activeProvider) nextRegistry.setActive(activeProvider.id)
    return {
      ok: false,
      message: messages.length ? messages.join('; ') : 'Active provider is unavailable.',
    }
  }

  nextRegistry.setActive(active.id)
  activeProvider = active
  await enableReadyCapabilities(active, capabilityManager)
  return {
    ok: true,
    message: messages.length ? `${active.name} active; ${messages.join('; ')}` : `Using ${active.name}.`,
  }
}

function createOpenAIProvider(config: StoredProviderConfig, apiKey?: string): InferenceProvider {
  return new OpenAICompatibleProvider({
    id: config.id,
    name: config.name,
    baseURL: config.baseURL,
    apiKey,
    defaultModel: config.defaultModel,
    defaultEmbeddingModel: config.defaultEmbeddingModel,
    tier: config.tier,
    headers: config.headers,
    profile: normalizeProviderProfile(config.profile),
  })
}

function findMatchingProviderConfig(
  configs: StoredProviderConfig[],
  provider: DiscoveredProvider,
): number {
  const discoveredBaseURL = normalizeBaseURL(provider.baseURL)
  return configs.findIndex((config) =>
    config.id === provider.id || normalizeBaseURL(config.baseURL) === discoveredBaseURL,
  )
}

function createDiscoveredProviderConfig(provider: DiscoveredProvider): StoredProviderConfig {
  return {
    id: provider.id,
    presetId: toProviderPresetId(provider.id),
    name: provider.name,
    baseURL: provider.baseURL,
    defaultModel: selectDiscoveredModel(provider, 'chat') ?? 'local-model',
    defaultEmbeddingModel: selectDiscoveredModel(provider, 'embeddings'),
    tier: 'local-server',
    requiresApiKey: false,
    active: false,
    profile: createLocalProviderProfile(provider.models),
  }
}

function mergeDiscoveredProviderConfig(
  config: StoredProviderConfig,
  provider: DiscoveredProvider,
): StoredProviderConfig {
  const discoveredDimensions = inferLocalEmbeddingDimensions(provider.models)
  return {
    ...config,
    name: config.name || provider.name,
    baseURL: provider.baseURL,
    defaultModel: selectDiscoveredModel(provider, 'chat') ?? config.defaultModel,
    defaultEmbeddingModel: selectDiscoveredModel(provider, 'embeddings') ?? config.defaultEmbeddingModel,
    tier: 'local-server',
    requiresApiKey: false,
    profile: normalizeProviderProfile({
      ...localPrivateProfile(discoveredDimensions),
      ...config.profile,
      embeddingDimensions: config.profile?.embeddingDimensions ?? discoveredDimensions,
    }),
  }
}

function selectDiscoveredModel(
  provider: DiscoveredProvider,
  capability: 'chat' | 'embeddings',
): string | undefined {
  return provider.models.find((model) => model.capabilities[capability])?.id
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

function toProviderPresetId(id: string): ProviderPresetId {
  return PROVIDER_PRESETS.some((preset) => preset.id === id) ? id as ProviderPresetId : 'custom'
}

function createRouteConfig(
  task: InferenceTask,
  providers: StoredProviderConfig[],
  overrides: Partial<StoredProviderRouteConfig> = {},
): StoredProviderRouteConfig {
  const providerIds = providers.map((provider) => provider.id)
  const first = providers[0]
  const model = task.startsWith('embedding.')
    ? first?.defaultEmbeddingModel
    : first?.defaultModel || undefined

  return {
    task,
    providerId: providerIds[0] ?? '',
    providerIds,
    model,
    fallback: true,
    ...overrides,
  }
}

function supportsConfiguredEmbeddings(config: StoredProviderConfig): boolean {
  return config.id === BROWSER_PROVIDER_ID || Boolean(config.defaultEmbeddingModel) || Boolean(config.profile?.embeddingDimensions?.length)
}

function supportsConfiguredChat(config: StoredProviderConfig): boolean {
  return config.id === BROWSER_PROVIDER_ID || Boolean(config.defaultModel)
}

function isLocalProvider(config: StoredProviderConfig): boolean {
  return config.tier === 'in-browser' || config.tier === 'local-server' || config.profile?.privacyTier === 'local'
}

function sortEmbeddingProviders(
  configs: StoredProviderConfig[],
  mode: 'query' | 'depth',
): StoredProviderConfig[] {
  return [...configs].sort((a, b) => {
    const privacy = providerLocalityScore(b) - providerLocalityScore(a)
    if (privacy !== 0) return privacy

    const dimensions = mode === 'query'
      ? bestEmbeddingDimension(a) - bestEmbeddingDimension(b)
      : bestEmbeddingDimension(b) - bestEmbeddingDimension(a)
    if (dimensions !== 0) return dimensions

    return providerCostScore(a) - providerCostScore(b)
  })
}

function sortChatProviders(configs: StoredProviderConfig[]): StoredProviderConfig[] {
  return preferActiveProvider([...configs].sort((a, b) => {
    const privacy = providerLocalityScore(b) - providerLocalityScore(a)
    if (privacy !== 0) return privacy
    return providerCostScore(a) - providerCostScore(b)
  }))
}

function preferActiveProvider(configs: StoredProviderConfig[]): StoredProviderConfig[] {
  return [...configs].sort((a, b) => Number(b.active) - Number(a.active))
}

function bestEmbeddingDimension(config: StoredProviderConfig | undefined): number {
  if (!config) return 0
  if (config.profile?.embeddingDimensions?.length) {
    return Math.max(...config.profile.embeddingDimensions)
  }
  return config.id === BROWSER_PROVIDER_ID ? 384 : 0
}

function suggestedLargeEmbeddingDimensions(config: StoredProviderConfig | undefined): number | undefined {
  const dimension = bestEmbeddingDimension(config)
  if (dimension >= 1536) return 1536
  if (dimension >= 1024) return 1024
  if (dimension >= 768) return 768
  if (dimension >= 384) return 384
  return undefined
}

function providerLocalityScore(config: StoredProviderConfig): number {
  if (config.profile?.privacyTier === 'local') return 3
  if (config.tier === 'in-browser' || config.tier === 'local-server') return 2
  if (config.profile?.privacyTier === 'host-managed') return 1
  return 0
}

function providerCostScore(config: StoredProviderConfig): number {
  switch (config.profile?.costTier) {
    case 'free':
      return 0
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    default:
      return 4
  }
}

async function enableReadyCapabilities(
  provider: InferenceProvider,
  capabilityManager: CapabilityManager,
): Promise<void> {
  if (provider.capabilities.embeddings && provider.embed) {
    await capabilityManager.enable('semantic')
  }
  if (provider.capabilities.chat && provider.complete) {
    await capabilityManager.enable('llm')
  }
}

export async function probeProvider(config: StoredProviderConfig): Promise<ProviderActivationResult> {
  if (config.id === BROWSER_PROVIDER_ID) {
    return { ok: true, message: 'Browser-local provider is available after capabilities load.' }
  }
  const apiKey = config.requiresApiKey ? await getProviderApiKey(config.id) : undefined
  if (config.requiresApiKey && !apiKey) {
    return { ok: false, message: 'Secure API key is not available.' }
  }
  const provider = new OpenAICompatibleProvider({
    id: config.id,
    name: config.name,
    baseURL: config.baseURL,
    apiKey,
    defaultModel: config.defaultModel,
    defaultEmbeddingModel: config.defaultEmbeddingModel,
    tier: config.tier,
    headers: config.headers,
    timeoutMs: 5000,
  })
  const result = await provider.probe()
  provider.dispose()
  return {
    ok: result.status === 'ok',
    message: result.message ?? `${result.status} (${result.latencyMs}ms)`,
  }
}

export async function refreshProviderModels(
  config: StoredProviderConfig,
): Promise<ProviderModelRefreshResult> {
  if (config.id === BROWSER_PROVIDER_ID) {
    return {
      ok: true,
      config,
      modelCount: 0,
      message: 'Browser-local provider models load lazily with capabilities.',
    }
  }

  const apiKey = config.requiresApiKey ? await getProviderApiKey(config.id) : undefined
  if (config.requiresApiKey && !apiKey) {
    return {
      ok: false,
      config,
      modelCount: 0,
      message: 'Secure API key is not available.',
    }
  }

  const provider = new OpenAICompatibleProvider({
    id: config.id,
    name: config.name,
    baseURL: config.baseURL,
    apiKey,
    defaultModel: config.defaultModel,
    defaultEmbeddingModel: config.defaultEmbeddingModel,
    tier: config.tier,
    headers: config.headers,
    timeoutMs: 5000,
  })
  try {
    const probe = await provider.probe()
    if (probe.status !== 'ok') {
      return {
        ok: false,
        config,
        modelCount: 0,
        message: probe.message ?? `Provider is ${probe.status}.`,
      }
    }

    const models = await provider.listModels()
    const nextConfig = mergeProviderModelDefaults(config, models)
    return {
      ok: true,
      config: nextConfig,
      modelCount: models.length,
      message: models.length
        ? `Found ${models.length} model${models.length === 1 ? '' : 's'} for ${config.name}.`
        : `${config.name} is reachable but did not report models.`,
    }
  } finally {
    provider.dispose()
  }
}

function mergeProviderModelDefaults(
  config: StoredProviderConfig,
  models: ModelInfo[],
): StoredProviderConfig {
  if (!models.length) return config

  const chatModel = selectModelByCapability(models, 'chat')
  const embeddingModel = selectModelByCapability(models, 'embeddings')
  const dimensions = config.tier === 'local-server'
    ? inferLocalEmbeddingDimensions(models)
    : undefined

  return {
    ...config,
    defaultModel: shouldFillModel(config.defaultModel) ? chatModel ?? config.defaultModel : config.defaultModel,
    defaultEmbeddingModel: shouldFillModel(config.defaultEmbeddingModel) ? embeddingModel ?? config.defaultEmbeddingModel : config.defaultEmbeddingModel,
    profile: normalizeProviderProfile({
      ...config.profile,
      embeddingDimensions: config.profile?.embeddingDimensions ?? dimensions,
    }),
  }
}

function selectModelByCapability(
  models: ModelInfo[],
  capability: 'chat' | 'embeddings',
): string | undefined {
  return models.find((model) => model.capabilities[capability])?.id
}

function shouldFillModel(model: string | undefined): boolean {
  return !model || model === 'local-model'
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function normalizeProviderIds(config: Pick<StoredProviderRouteConfig, 'providerId' | 'providerIds'>): string[] {
  const ids = config.providerIds?.length ? config.providerIds : [config.providerId]
  return ids
    .map((id) => id.trim())
    .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index)
}

function normalizeProviderProfile(profile: ProviderProfile | undefined): ProviderProfile | undefined {
  if (!profile) return undefined
  const normalized: ProviderProfile = {}

  if (profile.privacyTier) normalized.privacyTier = profile.privacyTier
  if (profile.costTier) normalized.costTier = profile.costTier
  const maxInputChars = normalizeOptionalNumber(profile.maxInputChars)
  if (maxInputChars) normalized.maxInputChars = maxInputChars
  if (profile.embeddingDimensions?.length) {
    const dimensions = profile.embeddingDimensions
      .map(normalizeOptionalNumber)
      .filter((dimension): dimension is number => dimension !== undefined)
    if (dimensions.length) normalized.embeddingDimensions = dimensions
  }
  if (profile.dataClasses?.length) normalized.dataClasses = profile.dataClasses

  return Object.keys(normalized).length ? normalized : undefined
}
