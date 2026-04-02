/**
 * Local inference server auto-discovery.
 * Probes known local endpoints (Ollama, LM Studio, llama.cpp, vLLM, Jan, LocalAI)
 * and returns discovered providers ready for registration.
 *
 * @implements #116 local server auto-discovery
 */

import type { ModelInfo } from './inference-provider.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalEndpoint {
  id: string
  name: string
  baseURL: string
  defaultPort: number
}

export interface DiscoveredProvider {
  id: string
  name: string
  baseURL: string
  models: ModelInfo[]
}

export interface DiscoveryOptions {
  /** Additional endpoints to probe beyond the defaults */
  extraEndpoints?: LocalEndpoint[]
  /** Probe timeout per endpoint in ms (default: 2000) */
  timeoutMs?: number
  /** Ports to skip (e.g., if you know a port is used for something else) */
  skipPorts?: number[]
}

// ---------------------------------------------------------------------------
// Known local server endpoints
// ---------------------------------------------------------------------------

export const LOCAL_ENDPOINTS: LocalEndpoint[] = [
  { id: 'ollama', name: 'Ollama', baseURL: 'http://localhost:11434/v1', defaultPort: 11434 },
  { id: 'lm-studio', name: 'LM Studio', baseURL: 'http://localhost:1234/v1', defaultPort: 1234 },
  { id: 'llama-cpp', name: 'llama.cpp', baseURL: 'http://localhost:8080/v1', defaultPort: 8080 },
  { id: 'vllm', name: 'vLLM', baseURL: 'http://localhost:8000/v1', defaultPort: 8000 },
  { id: 'jan', name: 'Jan', baseURL: 'http://localhost:1337/v1', defaultPort: 1337 },
  { id: 'localai', name: 'LocalAI', baseURL: 'http://localhost:8080/v1', defaultPort: 8080 },
]

// ---------------------------------------------------------------------------
// Model capability heuristics
// ---------------------------------------------------------------------------

export type ModelCategory = 'embedding' | 'vision' | 'chat'

/**
 * Classify a model by its ID/name into embedding, vision, or chat.
 */
export function classifyModel(modelId: string): ModelCategory {
  const lower = modelId.toLowerCase()

  // Embedding models
  if (
    lower.includes('embed') || lower.includes('e5-') || lower.includes('bge-') ||
    lower.includes('nomic-') || lower.includes('mxbai-') || lower.includes('all-minilm') ||
    lower.includes('gte-')
  ) {
    return 'embedding'
  }

  // Vision models
  if (
    lower.includes('vision') || lower.includes('llava') || lower.includes('moondream') ||
    lower.includes('minicpm-v') || lower.includes('bakllava')
  ) {
    return 'vision'
  }

  // Default: chat
  return 'chat'
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface ModelsResponse {
  data?: Array<{ id: string; owned_by?: string }>
  models?: Array<{ name: string; model?: string }>
}

/**
 * Probe a single endpoint and return discovered provider info, or null if unreachable.
 */
async function probeEndpoint(
  endpoint: LocalEndpoint,
  timeoutMs: number,
): Promise<DiscoveredProvider | null> {
  try {
    const response = await globalThis.fetch(`${endpoint.baseURL}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null

    const data = (await response.json()) as ModelsResponse

    // OpenAI format: { data: [{ id: "model-name" }] }
    // Ollama format: { models: [{ name: "model-name" }] }
    let modelIds: string[]
    if (data.data && Array.isArray(data.data)) {
      modelIds = data.data.map(m => m.id)
    } else if (data.models && Array.isArray(data.models)) {
      modelIds = data.models.map(m => m.name ?? m.model ?? '')
    } else {
      modelIds = []
    }

    const models: ModelInfo[] = modelIds
      .filter(Boolean)
      .map(id => {
        const category = classifyModel(id)
        return {
          id,
          name: id,
          capabilities: {
            embeddings: category === 'embedding',
            chat: category === 'chat' || category === 'vision',
            vision: category === 'vision',
          },
        }
      })

    return {
      id: endpoint.id,
      name: endpoint.name,
      baseURL: endpoint.baseURL,
      models,
    }
  } catch {
    return null
  }
}

/**
 * Discover local inference servers by probing known endpoints.
 * Returns all reachable providers with their available models.
 */
export async function discoverLocalProviders(
  options: DiscoveryOptions = {},
): Promise<DiscoveredProvider[]> {
  const { extraEndpoints = [], timeoutMs = 2000, skipPorts = [] } = options

  // Deduplicate endpoints by baseURL (llama.cpp and LocalAI share port 8080)
  const allEndpoints = [...LOCAL_ENDPOINTS, ...extraEndpoints]
  const seen = new Set<string>()
  const uniqueEndpoints = allEndpoints.filter(ep => {
    if (seen.has(ep.baseURL)) return false
    if (skipPorts.includes(ep.defaultPort)) return false
    seen.add(ep.baseURL)
    return true
  })

  const results = await Promise.allSettled(
    uniqueEndpoints.map(ep => probeEndpoint(ep, timeoutMs)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<DiscoveredProvider | null> =>
      r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value!)
}
