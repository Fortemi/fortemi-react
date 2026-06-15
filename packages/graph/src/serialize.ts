import type { CommunityGraph, GraphLayoutAlgorithm } from './types.js'

/** Current on-disk version for {@link GraphSnapshot}. */
export const GRAPH_SNAPSHOT_VERSION = 1

/**
 * A self-contained, serializable representation of a community graph plus the
 * layout intent used to render it. Designed to be written to a static JSON file
 * and consumed by a JS-only host (e.g. a documentation site) without recomputing
 * the graph.
 */
export interface GraphSnapshot {
  version: number
  graph: CommunityGraph
  layout?: {
    algorithm: GraphLayoutAlgorithm
    width: number
    height: number
  }
  generatedAt?: string
}

export interface SerializeSnapshotOptions {
  layout?: GraphSnapshot['layout']
  /** ISO timestamp to stamp into the snapshot. Omit for reproducible output. */
  generatedAt?: string
}

function sortedGraph(graph: CommunityGraph): CommunityGraph {
  return {
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => (
      a.source.localeCompare(b.source)
      || a.target.localeCompare(b.target)
      || (a.kind ?? '').localeCompare(b.kind ?? '')
    )),
    communities: [...graph.communities]
      .map((community) => ({ ...community, nodes: [...community.nodes].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/**
 * Build a deterministic {@link GraphSnapshot} from a graph. Nodes, edges, and
 * community members are sorted so that equal graphs serialize identically
 * (stable diffs, content-addressable caching).
 */
export function serializeGraphSnapshot(
  graph: CommunityGraph,
  options: SerializeSnapshotOptions = {},
): GraphSnapshot {
  const snapshot: GraphSnapshot = {
    version: GRAPH_SNAPSHOT_VERSION,
    graph: sortedGraph(graph),
  }
  if (options.layout) snapshot.layout = options.layout
  if (options.generatedAt) snapshot.generatedAt = options.generatedAt
  return snapshot
}

/** Stable JSON string for a graph snapshot. */
export function stringifyGraphSnapshot(
  graph: CommunityGraph,
  options: SerializeSnapshotOptions = {},
): string {
  return JSON.stringify(serializeGraphSnapshot(graph, options))
}

/**
 * Validate and unwrap a {@link GraphSnapshot} (or its JSON string) back into a
 * {@link CommunityGraph}. Throws on shape/version mismatch.
 */
export function deserializeGraphSnapshot(input: GraphSnapshot | string): CommunityGraph {
  const snapshot: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('invalid graph snapshot: not an object')
  }
  const candidate = snapshot as Partial<GraphSnapshot>
  if (candidate.version !== GRAPH_SNAPSHOT_VERSION) {
    throw new Error(`unsupported graph snapshot version: ${String(candidate.version)}`)
  }
  const graph = candidate.graph
  if (
    !graph
    || !Array.isArray(graph.nodes)
    || !Array.isArray(graph.edges)
    || !Array.isArray(graph.communities)
  ) {
    throw new Error('invalid graph snapshot: missing graph nodes/edges/communities')
  }
  return graph
}
