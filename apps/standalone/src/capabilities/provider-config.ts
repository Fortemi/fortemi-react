import {
  OpenAICompatibleProvider,
  ProviderRegistry,
  getFortemiSecretStore,
  hasFortemiSecureSecrets,
  type CapabilityManager,
  type FortemiBridge,
  type FortemiSecretStore,
  type InferenceProvider,
  type OpenAIProviderConfig,
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
}

export interface ProviderActivationResult {
  ok: boolean
  message: string
}

const PROVIDERS_KEY = 'fortemi:provider-configs'
const ACTIVE_PROVIDER_KEY = 'fortemi:active-provider'
const SECRET_PREFIX = 'fortemi.provider.'

export const BROWSER_PROVIDER_ID = 'browser'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    defaultEmbeddingModel: 'text-embedding-3-small',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    defaultEmbeddingModel: 'openai/text-embedding-3-small',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    defaultEmbeddingModel: 'mistral-embed',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultEmbeddingModel: 'BAAI/bge-large-en-v1.5',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    defaultEmbeddingModel: 'BAAI/bge-base-en-v1.5',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'xai',
    name: 'xAI',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    tier: 'remote',
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    defaultEmbeddingModel: 'nomic-embed-text',
    tier: 'local-server',
    requiresApiKey: false,
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
  },
  {
    id: 'llama-cpp',
    name: 'llama.cpp',
    baseURL: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseURL: 'http://localhost:8000/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
  },
  {
    id: 'jan',
    name: 'Jan',
    baseURL: 'http://localhost:1337/v1',
    defaultModel: 'local-model',
    tier: 'local-server',
    requiresApiKey: false,
  },
]

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

function getRegistry(events: TypedEventBus): ProviderRegistry {
  if (!registry) registry = new ProviderRegistry(events)
  return registry
}

function clearRegistry(): void {
  registry?.dispose()
  registry = null
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
): Promise<ProviderActivationResult> {
  if (config.id === BROWSER_PROVIDER_ID) {
    clearRegistry()
    return { ok: true, message: 'Using in-browser transformers.js and WebLLM.' }
  }

  const apiKey = config.requiresApiKey ? await getProviderApiKey(config.id) : undefined
  if (config.requiresApiKey && !apiKey) {
    clearRegistry()
    return {
      ok: false,
      message: 'API key was not loaded because secure storage is unavailable or empty.',
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
  })
  clearRegistry()
  const nextRegistry = getRegistry(events)
  nextRegistry.add(provider)
  activeProvider = provider

  await enableReadyCapabilities(provider, capabilityManager)
  return { ok: true, message: `Using ${config.name}.` }
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
