import type { QueryExecutor } from '../storage-backend.js'
import { computeHash } from '../hash.js'
import { EmbeddingSetsRepository, type EmbeddingSetSelector, type ResolvedEmbeddingSet } from './embedding-sets-repository.js'

export interface GraphNode {
  id: string
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  kind?: string
}

export interface GraphCommunity {
  id: string
  nodes: string[]
}

export interface CommunityGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: GraphCommunity[]
}

export interface SimilarityGraphOptions {
  k?: number
  minSimilarity?: number
  threshold?: number
}

export interface SimilarityGraphRequest extends SimilarityGraphOptions {
  selector: EmbeddingSetSelector
  metric?: 'cosine' | 'inner_product' | 'l2'
  source?: 'cache-preferred' | 'live-only' | 'cache-only'
}

export interface SimilarityGraphCacheKey {
  selectorHash: string
  resolvedEmbeddingSetId?: string
  virtualSetId?: string
  k: number
  minSimilarity: number
  metric: 'cosine' | 'inner_product' | 'l2'
  model: string
  dimension: number
  truncateDimension?: number | null
  memberHash: string
  vectorHash: string
  parameterHash: string
}

export interface SimilarityGraphResult {
  graph: CommunityGraph
  graphSource: {
    id: string
    name: string
    input_hash: string
    freshness: 'fresh' | 'stale' | 'unknown'
  }
  cache: 'hit' | 'miss-live-built' | 'stale-live-built' | 'live-only'
  freshness: 'fresh' | 'stale' | 'unknown'
}

export interface CommunityOptions {
  maxIterations?: number
}

const SIMILARITY_GRAPH_ALGORITHM = 'knn-v1'

function hashJson(value: unknown): string {
  return computeHash(new TextEncoder().encode(JSON.stringify(value)))
}

function sourceIdFor(inputHash: string): string {
  return `similarity-${inputHash.replace(/^sha256:/, '').slice(0, 24)}`
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

export function detectCommunities(
  edges: GraphEdge[],
  nodes: GraphNode[] = [],
  options: CommunityOptions = {},
): GraphCommunity[] {
  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const edge of edges) {
    nodeIds.add(edge.source)
    nodeIds.add(edge.target)
  }

  const labels = new Map<string, string>()
  const adjacency = new Map<string, Array<{ node: string; weight: number }>>()
  for (const id of nodeIds) {
    labels.set(id, id)
    adjacency.set(id, [])
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push({ node: edge.target, weight: edge.weight })
    adjacency.get(edge.target)?.push({ node: edge.source, weight: edge.weight })
  }

  const orderedNodes = Array.from(nodeIds).sort()
  const maxIterations = options.maxIterations ?? 20
  for (let i = 0; i < maxIterations; i++) {
    let changed = false
    for (const node of orderedNodes) {
      const scores = new Map<string, number>()
      for (const neighbor of adjacency.get(node) ?? []) {
        const label = labels.get(neighbor.node) ?? neighbor.node
        scores.set(label, (scores.get(label) ?? 0) + neighbor.weight)
      }
      if (scores.size === 0) continue
      const nextLabel = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
      if (nextLabel !== labels.get(node)) {
        labels.set(node, nextLabel)
        changed = true
      }
    }
    if (!changed) break
  }

  const byLabel = new Map<string, string[]>()
  for (const node of orderedNodes) {
    const label = labels.get(node) ?? node
    const members = byLabel.get(label) ?? []
    members.push(node)
    byLabel.set(label, members)
  }

  return Array.from(byLabel.values())
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
    .map((members, index) => ({ id: `community-${index + 1}`, nodes: members }))
}

export class GraphRepository {
  constructor(private db: QueryExecutor) {}

  normalizeSimilarityRequest(request: SimilarityGraphRequest): Required<Pick<SimilarityGraphRequest, 'selector' | 'k' | 'minSimilarity' | 'metric' | 'source'>> {
    if (request.minSimilarity !== undefined && request.threshold !== undefined && request.minSimilarity !== request.threshold) {
      throw new Error('conflicting-threshold')
    }
    return {
      selector: request.selector,
      k: request.k ?? 5,
      minSimilarity: request.minSimilarity ?? request.threshold ?? -1,
      metric: request.metric ?? 'cosine',
      source: request.source ?? 'cache-preferred',
    }
  }

  async buildSimilarityGraph(
    embeddingSet: string | EmbeddingSetSelector,
    options: SimilarityGraphOptions = {},
  ): Promise<CommunityGraph> {
    const selector = typeof embeddingSet === 'string'
      ? { kind: 'embedding-set' as const, embeddingSetId: embeddingSet }
      : embeddingSet
    return this.buildSimilarityGraphFromResolved(
      await new EmbeddingSetsRepository(this.db).resolveSelector(selector),
      options,
    )
  }

  async buildSimilarityGraphLive(request: SimilarityGraphRequest): Promise<CommunityGraph> {
    const normalized = this.normalizeSimilarityRequest({ ...request, source: 'live-only' })
    const resolved = await new EmbeddingSetsRepository(this.db).resolveSelector(normalized.selector)
    return this.buildSimilarityGraphFromResolved(resolved, normalized)
  }

  async getCachedSimilarityGraph(request: SimilarityGraphRequest): Promise<SimilarityGraphResult | null> {
    const normalized = this.normalizeSimilarityRequest(request)
    const resolved = await new EmbeddingSetsRepository(this.db).resolveSelector(normalized.selector)
    const cacheKey = await this.computeSimilarityGraphCacheKey(normalized, resolved)
    const inputHash = hashJson(cacheKey)
    const source = await this.findGraphSource(inputHash)
    if (!source) return null
    const graph = await this.graphFromArtifact(source.id, resolved.noteIds)
    return {
      graph,
      graphSource: { id: source.id, name: source.name, input_hash: source.input_hash, freshness: source.freshness },
      cache: 'hit',
      freshness: source.freshness,
    }
  }

  async buildOrLoadSimilarityGraph(request: SimilarityGraphRequest): Promise<SimilarityGraphResult> {
    const normalized = this.normalizeSimilarityRequest(request)
    const resolved = await new EmbeddingSetsRepository(this.db).resolveSelector(normalized.selector)
    const cacheKey = await this.computeSimilarityGraphCacheKey(normalized, resolved)
    const inputHash = hashJson(cacheKey)

    if (normalized.source !== 'live-only') {
      const cached = await this.findGraphSource(inputHash)
      if (cached?.freshness === 'fresh') {
        const graph = await this.graphFromArtifact(cached.id, resolved.noteIds)
        return {
          graph,
          graphSource: { id: cached.id, name: cached.name, input_hash: cached.input_hash, freshness: cached.freshness },
          cache: 'hit',
          freshness: 'fresh',
        }
      }
      if (normalized.source === 'cache-only') {
        throw new Error(cached ? 'similarity graph cache stale' : 'similarity graph cache miss')
      }
      const graph = await this.buildSimilarityGraphFromResolved(resolved, normalized)
      const graphSource = await this.saveSimilarityGraphArtifact({ graph, request: normalized, resolved, cacheKey, freshness: 'fresh' })
      return {
        graph,
        graphSource,
        cache: cached ? 'stale-live-built' : 'miss-live-built',
        freshness: cached ? cached.freshness : 'fresh',
      }
    }

    const graph = await this.buildSimilarityGraphFromResolved(resolved, normalized)
    return {
      graph,
      graphSource: { id: sourceIdFor(inputHash), name: 'Live similarity graph', input_hash: inputHash, freshness: 'unknown' },
      cache: 'live-only',
      freshness: 'unknown',
    }
  }

  async saveSimilarityGraphArtifact(input: {
    graph: CommunityGraph
    request: Required<Pick<SimilarityGraphRequest, 'selector' | 'k' | 'minSimilarity' | 'metric' | 'source'>>
    resolved: ResolvedEmbeddingSet
    cacheKey: SimilarityGraphCacheKey
    freshness?: 'fresh' | 'stale' | 'unknown'
  }): Promise<SimilarityGraphResult['graphSource']> {
    const inputHash = hashJson(input.cacheKey)
    const id = sourceIdFor(inputHash)
    const parameters = {
      k: input.request.k,
      minSimilarity: input.request.minSimilarity,
      metric: input.request.metric,
      algorithm: SIMILARITY_GRAPH_ALGORITHM,
      selectorHash: input.cacheKey.selectorHash,
      parameterHash: input.cacheKey.parameterHash,
    }
    await this.db.query(
      `INSERT INTO graph_source (id, name, kind, source_table, embedding_set_id, virtual_set_id, model, dimension, metric, algorithm, parameters_json, input_hash, freshness_json)
       VALUES ($1, $2, 'similarity', 'embedding', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb)
       ON CONFLICT (id) DO UPDATE SET parameters_json = $9::jsonb, input_hash = $10, freshness_json = $11::jsonb`,
      [
        id,
        'Cached similarity graph',
        input.request.selector.kind === 'embedding-set' ? input.request.selector.embeddingSetId ?? null : null,
        input.request.selector.kind !== 'embedding-set' ? input.request.selector.definition?.id ?? null : null,
        input.cacheKey.model,
        input.cacheKey.dimension,
        input.request.metric,
        SIMILARITY_GRAPH_ALGORITHM,
        JSON.stringify(parameters),
        inputHash,
        JSON.stringify({ status: input.freshness ?? 'fresh' }),
      ],
    )
    await this.db.query(`DELETE FROM graph_edge_artifact WHERE graph_source_id = $1`, [id])
    let rank = 1
    for (const edge of input.graph.edges) {
      await this.db.query(
        `INSERT INTO graph_edge_artifact (graph_source_id, from_note_id, to_note_id, weight, kind, rank)
         VALUES ($1, $2, $3, $4, 'similarity', $5)`,
        [id, edge.source, edge.target, edge.weight, rank++],
      )
    }
    return { id, name: 'Cached similarity graph', input_hash: inputHash, freshness: input.freshness ?? 'fresh' }
  }

  async markSimilarityGraphStale(graphSourceId: string, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE graph_source SET freshness_json = $2::jsonb WHERE id = $1`,
      [graphSourceId, JSON.stringify({ status: 'stale', stale_reason: reason, checked_at: new Date().toISOString() })],
    )
  }

  private async buildSimilarityGraphFromResolved(
    resolved: ResolvedEmbeddingSet,
    options: SimilarityGraphOptions,
  ): Promise<CommunityGraph> {
    const k = options.k ?? 5
    const minSimilarity = options.minSimilarity ?? options.threshold ?? -1
    const embeddings = resolved.rows

    const nodes = embeddings.map((row) => ({ id: row.note_id }))
    const edgeMap = new Map<string, GraphEdge>()
    for (const row of embeddings) {
      const neighbors = await this.db.query<{ note_id: string; similarity: number }>(
        `SELECT note_id, 1 - (vector <=> $2::vector) as similarity
         FROM embedding
         WHERE id = ANY($1) AND note_id != $3
         ORDER BY vector <=> $2::vector ASC
         LIMIT $4`,
        [resolved.embeddingIds, row.vector, row.note_id, k],
      )
      for (const neighbor of neighbors.rows) {
        if (neighbor.similarity < minSimilarity) continue
        const [source, target] = [row.note_id, neighbor.note_id].sort()
        const id = `${source}\u0000${target}`
        const existing = edgeMap.get(id)
        if (!existing || neighbor.similarity > existing.weight) {
          edgeMap.set(id, { source, target, weight: neighbor.similarity, kind: 'similarity' })
        }
      }
    }

    const edges = Array.from(edgeMap.values()).sort((a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    )
    return { nodes, edges, communities: detectCommunities(edges, nodes) }
  }

  private async computeSimilarityGraphCacheKey(
    request: Required<Pick<SimilarityGraphRequest, 'selector' | 'k' | 'minSimilarity' | 'metric' | 'source'>>,
    resolved: ResolvedEmbeddingSet,
  ): Promise<SimilarityGraphCacheKey> {
    const firstSetId = resolved.rows[0]?.embedding_set_id
    const set = firstSetId ? await new EmbeddingSetsRepository(this.db).get(firstSetId) : null
    return {
      selectorHash: hashJson(request.selector),
      resolvedEmbeddingSetId: request.selector.kind === 'embedding-set' ? request.selector.embeddingSetId : undefined,
      virtualSetId: request.selector.kind === 'virtual-definition' ? request.selector.definition?.id : undefined,
      k: request.k,
      minSimilarity: request.minSimilarity,
      metric: request.metric,
      model: set?.model_name ?? 'unknown',
      dimension: set?.dimensions ?? 0,
      truncateDimension: set?.truncate_dimension ?? null,
      memberHash: hashJson(resolved.rows.map((row) => [row.note_id, row.embedding_set_id, row.embedding_id])),
      vectorHash: hashJson(resolved.rows.map((row) => [row.embedding_id, row.vector])),
      parameterHash: hashJson({ k: request.k, minSimilarity: request.minSimilarity, metric: request.metric, algorithm: SIMILARITY_GRAPH_ALGORITHM }),
    }
  }

  private async findGraphSource(inputHash: string): Promise<{ id: string; name: string; input_hash: string; freshness: 'fresh' | 'stale' | 'unknown' } | null> {
    const result = await this.db.query<{ id: string; name: string; input_hash: string; freshness_json: unknown }>(
      `SELECT id, name, input_hash, freshness_json FROM graph_source WHERE kind = 'similarity' AND input_hash = $1 LIMIT 1`,
      [inputHash],
    )
    if (result.rows.length === 0) return null
    const row = result.rows[0]
    const freshness = jsonObject(row.freshness_json) as { status?: 'fresh' | 'stale' | 'unknown' } | null
    return { id: row.id, name: row.name, input_hash: row.input_hash, freshness: freshness?.status ?? 'unknown' }
  }

  private async graphFromArtifact(graphSourceId: string, noteIds: string[]): Promise<CommunityGraph> {
    const result = await this.db.query<GraphEdge>(
      `SELECT from_note_id as source, to_note_id as target, weight, kind
       FROM graph_edge_artifact
       WHERE graph_source_id = $1
       ORDER BY from_note_id, to_note_id`,
      [graphSourceId],
    )
    const nodes = Array.from(new Set([...noteIds, ...result.rows.flatMap((edge) => [edge.source, edge.target])]))
      .sort()
      .map((id) => ({ id }))
    return { nodes, edges: result.rows, communities: detectCommunities(result.rows, nodes) }
  }

  async buildLinkGraph(linkType?: string): Promise<CommunityGraph> {
    const params: unknown[] = []
    const typeFilter = linkType ? ' AND link_type = $1' : ''
    if (linkType) params.push(linkType)
    const result = await this.db.query<GraphEdge>(
      `SELECT source_note_id as source, target_note_id as target,
              COALESCE(confidence, 1.0) as weight, link_type as kind
       FROM link
       WHERE deleted_at IS NULL${typeFilter}
       ORDER BY source_note_id, target_note_id`,
      params,
    )
    const nodes = Array.from(new Set(result.rows.flatMap((edge) => [edge.source, edge.target])))
      .sort()
      .map((id) => ({ id }))
    return { nodes, edges: result.rows, communities: detectCommunities(result.rows, nodes) }
  }
}
