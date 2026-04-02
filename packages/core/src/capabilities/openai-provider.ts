/**
 * OpenAI-compatible inference provider.
 * Works with OpenAI, OpenRouter, Anthropic (via OpenRouter), Ollama, LM Studio,
 * llama.cpp, vLLM, Jan, and any OpenAI-compatible endpoint.
 *
 * No SDK dependencies — uses raw fetch() to keep @fortemi/core lightweight.
 *
 * @implements #113 remote provider support
 */

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

export interface OpenAIProviderConfig {
  id: string
  name: string
  baseURL: string
  apiKey?: string
  defaultModel?: string
  defaultEmbeddingModel?: string
  tier?: ProviderTier
  headers?: Record<string, string>
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// OpenAI API response shapes (subset we need)
// ---------------------------------------------------------------------------

interface OAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage?: { total_tokens: number }
}

interface OAIChatResponse {
  choices: Array<{
    message: { content: string }
    finish_reason: string
  }>
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

interface OAIChatStreamChunk {
  choices: Array<{
    delta: { content?: string }
    finish_reason: string | null
  }>
}

interface OAIModelsResponse {
  data: Array<{
    id: string
    owned_by?: string
  }>
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements InferenceProvider {
  readonly id: string
  readonly name: string
  readonly tier: ProviderTier
  readonly capabilities: ProviderCapabilities

  private baseURL: string
  private apiKey?: string
  private defaultModel: string
  private defaultEmbeddingModel: string
  private extraHeaders: Record<string, string>
  private timeoutMs: number
  private abortController: AbortController | null = null

  constructor(config: OpenAIProviderConfig) {
    this.id = config.id
    this.name = config.name
    this.baseURL = config.baseURL.replace(/\/+$/, '') // strip trailing slashes
    this.apiKey = config.apiKey
    this.defaultModel = config.defaultModel ?? 'gpt-3.5-turbo'
    this.defaultEmbeddingModel = config.defaultEmbeddingModel ?? 'text-embedding-3-small'
    this.tier = config.tier ?? (this.isLocalURL() ? 'local-server' : 'remote')
    this.extraHeaders = config.headers ?? {}
    this.timeoutMs = config.timeoutMs ?? 30000

    this.capabilities = {
      embeddings: true,
      chat: true,
      streaming: true,
      vision: false,
      toolCalling: false,
      structuredOutput: false,
    }
  }

  // -------------------------------------------------------------------------
  // InferenceProvider interface
  // -------------------------------------------------------------------------

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const model = request.model ?? this.defaultEmbeddingModel
    const body = {
      input: request.texts,
      model,
    }

    const response = await this.fetch('/embeddings', body)
    const data = response as OAIEmbeddingResponse

    // Sort by index to ensure correct order
    const sorted = [...data.data].sort((a, b) => a.index - b.index)

    return {
      vectors: sorted.map(d => d.embedding),
      model: data.model,
      usage: data.usage ? { totalTokens: data.usage.total_tokens } : undefined,
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.defaultModel
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(request),
      stream: false,
    }
    if (request.maxTokens) body.max_tokens = request.maxTokens
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.stopSequences?.length) body.stop = request.stopSequences

    const response = await this.fetch('/chat/completions', body)
    const data = response as OAIChatResponse

    const choice = data.choices[0]
    return {
      text: choice?.message?.content ?? '',
      model: data.model,
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
        : undefined,
      finishReason: this.mapFinishReason(choice?.finish_reason),
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const model = request.model ?? this.defaultModel
    const body: Record<string, unknown> = {
      model,
      messages: this.buildMessages(request),
      stream: true,
    }
    if (request.maxTokens) body.max_tokens = request.maxTokens
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.stopSequences?.length) body.stop = request.stopSequences

    const response = await this.rawFetch('/chat/completions', body)

    if (!response.body) {
      throw new Error('Streaming not supported: response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') {
            yield { text: '', done: true }
            return
          }

          try {
            const parsed = JSON.parse(data) as OAIChatStreamChunk
            const delta = parsed.choices[0]?.delta
            const finishReason = parsed.choices[0]?.finish_reason
            if (delta?.content) {
              yield { text: delta.content, done: false }
            }
            if (finishReason) {
              yield { text: '', done: true }
              return
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.fetch('/models', undefined, 'GET')
      const data = response as OAIModelsResponse
      return data.data.map(m => ({
        id: m.id,
        name: m.id,
        capabilities: {
          chat: !this.isEmbeddingModel(m.id),
          embeddings: this.isEmbeddingModel(m.id),
        },
        owned_by: m.owned_by,
      }))
    } catch {
      return []
    }
  }

  async probe(): Promise<ProbeResult> {
    const start = Date.now()
    try {
      await this.fetch('/models', undefined, 'GET')
      return {
        status: 'ok',
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  dispose(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private buildMessages(request: CompletionRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = []
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt })
    }
    messages.push({ role: 'user', content: request.prompt })
    return messages
  }

  private mapFinishReason(reason?: string): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop'
      case 'length': return 'length'
      case 'content_filter': return 'content_filter'
      default: return undefined
    }
  }

  private isEmbeddingModel(id: string): boolean {
    const lower = id.toLowerCase()
    return lower.includes('embed') || lower.includes('e5-') || lower.includes('bge-') ||
      lower.includes('nomic-') || lower.includes('mxbai-') || lower.includes('all-minilm')
  }

  private isLocalURL(): boolean {
    try {
      const url = new URL(this.baseURL)
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0'
    } catch {
      return false
    }
  }

  private async fetch(
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' = body ? 'POST' : 'GET',
  ): Promise<unknown> {
    const response = await this.rawFetch(path, body, method)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${this.name} API error ${response.status}: ${text}`)
    }
    return response.json()
  }

  private async rawFetch(
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' = body ? 'POST' : 'GET',
  ): Promise<Response> {
    this.abortController = new AbortController()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const url = `${this.baseURL}${path}`
    const response = await globalThis.fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok && method !== 'GET') {
      const text = await response.text().catch(() => '')
      throw new Error(`${this.name} API error ${response.status}: ${text}`)
    }

    return response
  }
}
