/**
 * Formal InferenceProvider interface.
 * Core contract for all inference providers — remote APIs, local servers, in-browser models.
 * Core stays dependency-free: interface only, no implementations.
 *
 * @implements #112 formal InferenceProvider interface
 */

// ---------------------------------------------------------------------------
// Capability descriptor
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  embeddings: boolean
  chat: boolean
  streaming: boolean
  vision: boolean
  toolCalling: boolean
  structuredOutput: boolean
  maxContextTokens?: number
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface EmbedRequest {
  texts: string[]
  model?: string
}

export interface EmbedResponse {
  vectors: number[][]
  model: string
  usage?: { totalTokens: number }
}

export interface CompletionRequest {
  prompt: string
  model?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  stopSequences?: string[]
}

export interface CompletionResponse {
  text: string
  model: string
  usage?: { promptTokens: number; completionTokens: number }
  finishReason?: 'stop' | 'length' | 'content_filter'
}

export interface StreamChunk {
  text: string
  done: boolean
}

// ---------------------------------------------------------------------------
// Discovery types
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string
  name?: string
  capabilities: Partial<ProviderCapabilities>
  contextWindow?: number
  owned_by?: string
}

export type ProbeStatus = 'ok' | 'degraded' | 'down'

export interface ProbeResult {
  status: ProbeStatus
  latencyMs: number
  message?: string
}

// ---------------------------------------------------------------------------
// Provider tiers
// ---------------------------------------------------------------------------

export type ProviderTier = 'remote' | 'local-server' | 'in-browser' | 'chrome-ai'

// ---------------------------------------------------------------------------
// InferenceProvider interface
// ---------------------------------------------------------------------------

export interface InferenceProvider {
  readonly id: string
  readonly name: string
  readonly tier: ProviderTier
  readonly capabilities: ProviderCapabilities

  /** Generate embeddings for text inputs */
  embed?(request: EmbedRequest): Promise<EmbedResponse>

  /** Generate a completion (non-streaming) */
  complete?(request: CompletionRequest): Promise<CompletionResponse>

  /** Generate a streaming completion */
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>

  /** List available models from this provider */
  listModels(): Promise<ModelInfo[]>

  /** Health check — probe the provider */
  probe(): Promise<ProbeResult>

  /** Clean up resources */
  dispose(): void
}
