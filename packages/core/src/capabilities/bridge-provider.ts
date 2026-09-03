import type { FortemiBridge, BridgeProviderInfo } from '../fortemi-bridge.js'
import type {
  CompletionRequest,
  CompletionResponse,
  EmbedRequest,
  EmbedResponse,
  InferenceProvider,
  ModelInfo,
  ProbeResult,
  ProviderCapabilities,
  ProviderTier,
  StreamChunk,
} from './inference-provider.js'

function capabilitiesFromBridge(info: BridgeProviderInfo): ProviderCapabilities {
  return {
    embeddings: Boolean(info.capabilities.embeddings),
    chat: Boolean(info.capabilities.chat),
    streaming: Boolean(info.capabilities.streaming),
    vision: false,
    toolCalling: false,
    structuredOutput: false,
  }
}

export class BridgeInferenceProvider implements InferenceProvider {
  readonly id: string
  readonly name: string
  readonly tier: ProviderTier
  readonly capabilities: ProviderCapabilities
  readonly profile: InferenceProvider['profile']

  constructor(
    private bridge: FortemiBridge,
    info: BridgeProviderInfo,
  ) {
    this.id = info.id
    this.name = info.name
    this.tier = info.tier
    this.capabilities = capabilitiesFromBridge(info)
    this.profile = info.profile ?? {
      privacyTier: 'host-managed',
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    if (!this.capabilities.embeddings) {
      throw new Error(`Bridge provider '${this.id}' does not support embeddings`)
    }
    if (!this.bridge.inference) {
      throw new Error('Fortemi bridge inference router is unavailable')
    }
    return this.bridge.inference.embed(this.id, request)
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.capabilities.chat) {
      throw new Error(`Bridge provider '${this.id}' does not support chat`)
    }
    if (!this.bridge.inference) {
      throw new Error('Fortemi bridge inference router is unavailable')
    }
    return this.bridge.inference.complete(this.id, request)
  }

  stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    if (!this.capabilities.streaming) {
      throw new Error(`Bridge provider '${this.id}' does not support streaming`)
    }
    if (!this.bridge.inference?.stream) {
      throw new Error('Fortemi bridge streaming router is unavailable')
    }
    return this.bridge.inference.stream(this.id, request)
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async probe(): Promise<ProbeResult> {
    if (!this.bridge.inference) {
      return { status: 'down', latencyMs: 0, message: 'Fortemi bridge inference router is unavailable' }
    }
    return this.bridge.inference.probeProvider(this.id)
  }

  dispose(): void {
    // Host owns bridge provider lifecycle.
  }
}

export async function createBridgeInferenceProviders(bridge: FortemiBridge): Promise<BridgeInferenceProvider[]> {
  if (!bridge.inference) return []
  const providers = await bridge.inference.listProviders()
  return providers.map(info => new BridgeInferenceProvider(bridge, info))
}
