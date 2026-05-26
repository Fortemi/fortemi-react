import type { QueryExecutor } from '../storage-backend.js'
import { EmbeddingSetsRepository, type EmbeddingSetSelector } from './embedding-sets-repository.js'

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

export interface CommunityOptions {
  maxIterations?: number
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

  async buildSimilarityGraph(
    embeddingSet: string | EmbeddingSetSelector,
    options: SimilarityGraphOptions = {},
  ): Promise<CommunityGraph> {
    const k = options.k ?? 5
    const minSimilarity = options.minSimilarity ?? options.threshold ?? -1
    const selector = typeof embeddingSet === 'string'
      ? { kind: 'embedding-set' as const, embeddingSetId: embeddingSet }
      : embeddingSet
    const resolved = await new EmbeddingSetsRepository(this.db).resolveSelector(selector)
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
