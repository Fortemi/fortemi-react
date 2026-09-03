import type { CapabilityManager } from '../capability-manager.js'
import type { TypedEventBus } from '../event-bus.js'
import { getFortemiBridge, type FortemiBridgeHost } from '../fortemi-bridge.js'
import { setLlmFunction, type LlmCompleteFn } from './llm-handler.js'
import {
  setEmbedFunction,
  setEmbeddingTaskSelectionOptions,
  type EmbedFunction,
  type EmbeddingTaskSelectionOptions,
} from './embedding-handler.js'
import { OpenAICompatibleProvider, type OpenAIProviderConfig } from './openai-provider.js'
import {
  ProviderRegistry,
  createLegacyProvider,
  type ProviderRoutePolicy,
  type ProviderRouteValidation,
} from './provider-registry.js'
import { createBridgeInferenceProviders } from './bridge-provider.js'
import { createLocalProviderProfile, discoverLocalProviders, type DiscoveryOptions } from './local-discovery.js'
import type { InferenceProvider, InferenceTask } from './inference-provider.js'

export type ConfiguredInferenceProvider =
  | { kind: 'provider'; provider: InferenceProvider }
  | { kind: 'openai-compatible'; config: OpenAIProviderConfig }
  | { kind: 'legacy'; id?: string; name?: string; embedFn?: EmbedFunction | null; llmFn?: LlmCompleteFn | null; profile?: InferenceProvider['profile'] }

export type LegacyInferenceProviderConfig = Omit<Extract<ConfiguredInferenceProvider, { kind: 'legacy' }>, 'kind'>

export interface InferenceRuntimeConfig {
  providers?: ConfiguredInferenceProvider[]
  routes?: Partial<Record<InferenceTask, ProviderRoutePolicy>>
  activeProviderId?: string
  bridgeHost?: FortemiBridgeHost
  includeBridgeProviders?: boolean
  discoverLocal?: boolean | DiscoveryOptions
  embeddingTaskSelection?: EmbeddingTaskSelectionOptions
}

export interface ConfigureInferenceRuntimeOptions extends InferenceRuntimeConfig {
  registry?: ProviderRegistry
  events?: TypedEventBus
  capabilityManager?: CapabilityManager
}

export interface ConfiguredInferenceRuntime {
  registry: ProviderRegistry
  providers: InferenceProvider[]
  routeValidation: ProviderRouteValidation[]
  routeIssues: ProviderRouteValidation['issues']
}

export function defineInferenceRuntime(config: InferenceRuntimeConfig): InferenceRuntimeConfig {
  return config
}

export function defineInferenceProvider(provider: InferenceProvider): ConfiguredInferenceProvider {
  return { kind: 'provider', provider }
}

export function defineOpenAICompatibleProvider(config: OpenAIProviderConfig): ConfiguredInferenceProvider {
  return { kind: 'openai-compatible', config }
}

export function defineLegacyInferenceProvider(config: LegacyInferenceProviderConfig): ConfiguredInferenceProvider {
  return { kind: 'legacy', ...config }
}

export function mergeInferenceRuntimeConfigs(
  ...configs: Array<InferenceRuntimeConfig | null | undefined>
): InferenceRuntimeConfig {
  const merged: InferenceRuntimeConfig = {}

  for (const config of configs) {
    if (!config) continue

    if (config.providers?.length) {
      merged.providers = mergeConfiguredProviders(merged.providers, config.providers)
    }
    if (config.routes) {
      merged.routes = { ...(merged.routes ?? {}), ...config.routes }
    }
    if (config.activeProviderId !== undefined) {
      merged.activeProviderId = config.activeProviderId
    }
    if (config.bridgeHost !== undefined) {
      merged.bridgeHost = config.bridgeHost
    }
    if (config.includeBridgeProviders !== undefined) {
      merged.includeBridgeProviders = config.includeBridgeProviders
    }
    if (config.discoverLocal !== undefined) {
      merged.discoverLocal = config.discoverLocal
    }
    if (config.embeddingTaskSelection) {
      merged.embeddingTaskSelection = {
        ...(merged.embeddingTaskSelection ?? {}),
        ...config.embeddingTaskSelection,
      }
    }
  }

  return merged
}

export function getConfiguredInferenceProviderId(config: ConfiguredInferenceProvider): string {
  switch (config.kind) {
    case 'provider':
      return config.provider.id
    case 'openai-compatible':
      return config.config.id
    case 'legacy':
      return config.id ?? 'legacy'
  }
}

function mergeConfiguredProviders(
  previous: ConfiguredInferenceProvider[] | undefined,
  next: ConfiguredInferenceProvider[],
): ConfiguredInferenceProvider[] {
  const byId = new Map<string, ConfiguredInferenceProvider>()

  for (const provider of previous ?? []) {
    byId.set(getConfiguredInferenceProviderId(provider), provider)
  }
  for (const provider of next) {
    const id = getConfiguredInferenceProviderId(provider)
    byId.delete(id)
    byId.set(id, provider)
  }

  return Array.from(byId.values())
}

export async function configureInferenceRuntime(
  options: ConfigureInferenceRuntimeOptions = {},
): Promise<ConfiguredInferenceRuntime> {
  const registry = options.registry ?? new ProviderRegistry(options.events)

  setEmbeddingTaskSelectionOptions(options.embeddingTaskSelection)

  for (const providerConfig of options.providers ?? []) {
    registry.add(createConfiguredProvider(providerConfig))
  }

  if (options.includeBridgeProviders !== false) {
    const bridge = getFortemiBridge(options.bridgeHost)
    if (bridge) {
      for (const provider of await createBridgeInferenceProviders(bridge)) {
        if (!registry.get(provider.id)) registry.add(provider)
      }
    }
  }

  if (options.discoverLocal) {
    const discoveryOptions = options.discoverLocal === true ? {} : options.discoverLocal
    const discovered = await discoverLocalProviders(discoveryOptions)
    for (const provider of discovered) {
      const id = `local:${provider.id}`
      if (registry.get(id)) continue
      registry.add(new OpenAICompatibleProvider({
        id,
        name: provider.name,
        baseURL: provider.baseURL,
        tier: 'local-server',
        defaultModel: provider.models.find(model => model.capabilities.chat)?.id,
        defaultEmbeddingModel: provider.models.find(model => model.capabilities.embeddings)?.id,
        profile: createLocalProviderProfile(provider.models),
      }))
    }
  }

  for (const [task, route] of Object.entries(options.routes ?? {}) as Array<[InferenceTask, ProviderRoutePolicy | undefined]>) {
    if (route) registry.setRoute(task, route)
  }

  if (options.activeProviderId) {
    registry.setActive(options.activeProviderId)
  }

  if (options.capabilityManager) {
    wireCapabilities(options.capabilityManager, registry)
  }

  const routeValidation = registry.validateRoutes()
  return {
    registry,
    providers: registry.list(),
    routeValidation,
    routeIssues: routeValidation.flatMap(route => route.issues),
  }
}

function createConfiguredProvider(config: ConfiguredInferenceProvider): InferenceProvider {
  switch (config.kind) {
    case 'provider':
      return config.provider
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config.config)
    case 'legacy':
      return createLegacyProvider(config)
  }
}

function wireCapabilities(manager: CapabilityManager, registry: ProviderRegistry): void {
  if (registry.hasEmbeddings()) {
    manager.registerLoader('semantic', async () => {
      setEmbedFunction((texts, options) => {
        const request = {
          texts,
          task: options?.task ?? 'embedding.document',
        }
        if (options?.model) Object.assign(request, { model: options.model })
        return registry.embed(request).then(result => result.vectors)
      })
    })
  }

  if (registry.hasChat()) {
    manager.registerLoader('llm', async () => {
      setLlmFunction((prompt, options) => {
        const request = {
          prompt,
          task: options?.task ?? 'chat.general',
        }
        if (options?.model) Object.assign(request, { model: options.model })
        if (options?.maxTokens !== undefined) Object.assign(request, { maxTokens: options.maxTokens })
        if (options?.temperature !== undefined) Object.assign(request, { temperature: options.temperature })
        return registry.complete(request).then(result => result.text)
      })
    })
  }
}
