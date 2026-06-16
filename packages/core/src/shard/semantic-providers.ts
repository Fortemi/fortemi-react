/**
 * Pluggable semantic providers for the in-place shard reader (issue #189).
 *
 * The static-file tier is text/facets-only by default. Semantic is opt-in via a
 * `StaticSemanticProvider`, with three tradeoff points the host chooses from:
 *
 *   1. none          — don't configure a provider (text/facets only). Lightest.
 *   2. cosine-small  — `createCosineSemanticProvider`: brute-force cosine over a
 *                      small static vectors file. Zero prebuild; small corpora only.
 *   3. ANN-full      — implement `StaticSemanticProvider` yourself over a prebuilt
 *                      ANN snapshot (HNSW / flat-IVF served as a static asset),
 *                      loading it in `prepare()` and querying it in `search()`.
 *                      The interface is the extension point; no ANN engine is
 *                      bundled here.
 */

import type { ShardComponentStore, StaticSemanticProvider } from './shard-reader.js'

const decoder = new TextDecoder()

/** A note id paired with its embedding vector, as stored in a static vectors file. */
export interface VectorEntry {
  id: string
  vector: number[]
}

export interface CosineSemanticProviderOptions {
  /**
   * Embeds the query into the SAME space as the corpus vectors. Host-owned so it
   * matches the build-time embedding model exactly (sync or async).
   */
  embedQuery: (query: string) => Promise<number[]> | number[]
  /**
   * JSONL file (one `{ id, vector }` per line) mapping note id → vector, served
   * as a static asset alongside the shard. Default `vectors.jsonl`.
   */
  vectorsFile?: string
  /** Pre-supplied vectors — skips loading from the component store. */
  vectors?: VectorEntry[]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Brute-force cosine semantic provider — the "cosine-small" tradeoff point. Loads
 * a static vectors file and scores the query embedding against every corpus
 * vector. Fine for small/demo corpora; for the full corpus, supply a prebuilt-ANN
 * `StaticSemanticProvider` instead.
 */
export function createCosineSemanticProvider(
  options: CosineSemanticProviderOptions,
): StaticSemanticProvider {
  let vectors: VectorEntry[] = options.vectors ?? []
  return {
    async prepare(store: ShardComponentStore): Promise<void> {
      if (options.vectors) return
      const bytes = await store.read(options.vectorsFile ?? 'vectors.jsonl')
      if (!bytes || bytes.byteLength === 0) {
        vectors = []
        return
      }
      vectors = decoder.decode(bytes)
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as VectorEntry)
    },
    async search(query: string, k: number): Promise<Array<{ id: string; score: number }>> {
      const queryVector = await options.embedQuery(query)
      return vectors
        .map((entry) => ({ id: entry.id, score: cosine(queryVector, entry.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
    },
  }
}
