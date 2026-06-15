import { filterCommunityGraph } from './filter.js'
import type { CommunityGraph } from './types.js'

/** Build an undirected adjacency map from a graph's edges. */
export function buildAdjacency(graph: CommunityGraph): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()
  const ensure = (id: string) => {
    let set = adjacency.get(id)
    if (!set) {
      set = new Set<string>()
      adjacency.set(id, set)
    }
    return set
  }
  for (const node of graph.nodes) ensure(node.id)
  for (const edge of graph.edges) {
    ensure(edge.source).add(edge.target)
    ensure(edge.target).add(edge.source)
  }
  return adjacency
}

/** Return the set of node ids directly adjacent to `nodeId` (excludes itself). */
export function neighborsOf(graph: CommunityGraph, nodeId: string): Set<string> {
  return new Set(buildAdjacency(graph).get(nodeId) ?? [])
}

export interface ExpandOptions {
  /** How many edge-hops to traverse from the seeds. Default 1. */
  depth?: number
  /** Include the seed ids in the result. Default true. */
  includeSeeds?: boolean
}

/**
 * Breadth-first expansion of one or more seed nodes out to `depth` hops.
 * Returns the set of reached node ids (seeds included by default).
 */
export function expandNeighborhood(
  graph: CommunityGraph,
  seeds: Iterable<string>,
  options: ExpandOptions = {},
): Set<string> {
  const depth = options.depth ?? 1
  const includeSeeds = options.includeSeeds ?? true
  const adjacency = buildAdjacency(graph)

  const seen = new Set<string>()
  let frontier = new Set<string>()
  for (const seed of seeds) {
    if (adjacency.has(seed) || depth === 0) {
      seen.add(seed)
      frontier.add(seed)
    }
  }

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>()
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor)
          next.add(neighbor)
        }
      }
    }
    if (next.size === 0) break
    frontier = next
  }

  if (!includeSeeds) {
    for (const seed of seeds) seen.delete(seed)
  }
  return seen
}

/**
 * Extract the induced subgraph over `nodeIds` — a {@link CommunityGraph}
 * containing only those nodes, the edges between them, and the trimmed
 * community memberships. Thin wrapper over {@link filterCommunityGraph}.
 */
export function subgraphForNodes(graph: CommunityGraph, nodeIds: Iterable<string>): CommunityGraph {
  return filterCommunityGraph(graph, { nodeIds: Array.from(nodeIds) })
}

/**
 * Convenience: the induced subgraph of a seed node plus its `depth`-hop
 * neighborhood. Useful for "expand selection" interactions.
 */
export function neighborhoodSubgraph(
  graph: CommunityGraph,
  seeds: Iterable<string>,
  options: ExpandOptions = {},
): CommunityGraph {
  return subgraphForNodes(graph, expandNeighborhood(graph, seeds, options))
}
