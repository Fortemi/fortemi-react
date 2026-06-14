import type {
  CompletionRequest,
  CompletionResponse,
  EmbedRequest,
  EmbedResponse,
  ProbeResult,
  StreamChunk,
} from './capabilities/inference-provider.js'

export interface FortemiBridgeCapabilities {
  secureSecrets: boolean
  providerRouting: boolean
  localNetworkAccess: boolean
  auditLog: boolean
}

export interface FortemiSecretStore {
  isAvailable(): boolean | Promise<boolean>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  deleteSecret(key: string): Promise<void>
}

export interface BridgeProviderInfo {
  id: string
  name: string
  tier: 'remote' | 'local-server' | 'in-browser' | 'chrome-ai'
  requiresApiKey: boolean
  capabilities: {
    chat?: boolean
    embeddings?: boolean
    streaming?: boolean
  }
}

export interface FortemiInferenceRouter {
  listProviders(): Promise<BridgeProviderInfo[]>
  probeProvider(providerId: string): Promise<ProbeResult>
  complete(providerId: string, request: CompletionRequest): Promise<CompletionResponse>
  embed(providerId: string, request: EmbedRequest): Promise<EmbedResponse>
  stream?(providerId: string, request: CompletionRequest): AsyncIterable<StreamChunk>
}

export interface FortemiBridge {
  version: string
  capabilities(): Promise<FortemiBridgeCapabilities>
  secrets: FortemiSecretStore
  inference?: FortemiInferenceRouter
}

export interface FortemiBridgeHost {
  fortemiBridge?: FortemiBridge
  fortemiSecureStorage?: FortemiSecretStore
}

export function getFortemiBridge(host: FortemiBridgeHost | undefined = globalThis as FortemiBridgeHost): FortemiBridge | null {
  return host?.fortemiBridge ?? null
}

export function getFortemiSecretStore(host: FortemiBridgeHost | undefined = globalThis as FortemiBridgeHost): FortemiSecretStore | null {
  return host?.fortemiBridge?.secrets ?? host?.fortemiSecureStorage ?? null
}

export async function hasFortemiSecureSecrets(host: FortemiBridgeHost | undefined = globalThis as FortemiBridgeHost): Promise<boolean> {
  const bridge = getFortemiBridge(host)
  if (bridge) {
    try {
      const capabilities = await bridge.capabilities()
      if (!capabilities.secureSecrets) return false
      return Boolean(await bridge.secrets.isAvailable())
    } catch {
      return false
    }
  }

  const legacySecrets = host?.fortemiSecureStorage
  if (!legacySecrets) return false
  try {
    return Boolean(await legacySecrets.isAvailable())
  } catch {
    return false
  }
}
