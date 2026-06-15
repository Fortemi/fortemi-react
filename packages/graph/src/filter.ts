import type { CommunityGraph, GraphNode } from './types.js'

export interface GraphFilter {
  /** Keep only nodes belonging to these communities (by community id). */
  communityIds?: string[]
  /** Keep only edges whose `kind` is in this set. */
  edgeKinds?: string[]
  /** Explicit allow-list of node ids. Useful for privacy / visibility filtering. */
  nodeIds?: string[]
  /**
   * Arbitrary per-node predicate evaluated against the (allow-listed) nodes.
   * Returning `false` removes the node and any edge touching it. Hosts whose
   * nodes carry extra metadata (privacy class, type, etc.) can filter on it here.
   */
  nodePredicate?: (node: GraphNode) => boolean
}

/**
 * Produce a new {@link CommunityGraph} containing only the nodes, edges, and
 * community memberships permitted by `filter`. Pure — the input is not mutated.
 *
 * Filtering precedence:
 *  1. `communityIds` (if non-empty) restricts the candidate node set to members
 *     of those communities; otherwise `nodeIds` (if given) is the candidate set,
 *     else all nodes.
 *  2. `nodePredicate` further narrows the candidate set.
 *  3. Edges survive only when both endpoints survive and `edgeKinds` permits.
 *  4. Empty communities are dropped.
 */
export function filterCommunityGraph(
  graph: CommunityGraph | null | undefined,
  filter?: GraphFilter,
): CommunityGraph {
  if (!graph) return { nodes: [], edges: [], communities: [] }

  const nodeIds = new Set(filter?.nodeIds ?? graph.nodes.map((node) => node.id))
  if (filter?.communityIds?.length) {
    const allowedCommunities = new Set(filter.communityIds)
    nodeIds.clear()
    for (const community of graph.communities) {
      if (allowedCommunities.has(community.id)) {
        for (const nodeId of community.nodes) nodeIds.add(nodeId)
      }
    }
  }

  const predicate = filter?.nodePredicate
  if (predicate) {
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id) && !predicate(node)) nodeIds.delete(node.id)
    }
  }

  const edgeKinds = filter?.edgeKinds ? new Set(filter.edgeKinds) : null
  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id))
  const edges = graph.edges.filter((edge) => (
    nodeIds.has(edge.source)
    && nodeIds.has(edge.target)
    && (!edgeKinds || edgeKinds.has(edge.kind ?? ''))
  ))
  const communities = graph.communities
    .map((community) => ({ ...community, nodes: community.nodes.filter((nodeId) => nodeIds.has(nodeId)) }))
    .filter((community) => community.nodes.length > 0)
  return { nodes, edges, communities }
}
