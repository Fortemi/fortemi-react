import { computeDegrees } from './degree.js'
import type {
  CommunityGraph,
  GraphLayoutAlgorithm,
  PositionedGraph,
  PositionedGraphNode,
} from './types.js'

export interface LayoutOptions {
  algorithm?: GraphLayoutAlgorithm
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 760
const DEFAULT_HEIGHT = 460

/**
 * Deterministically position the nodes of a {@link CommunityGraph} in 2D space.
 *
 * The layout is a closed-form function of (graph, algorithm, width, height) with
 * no randomness or iteration, so the same input always yields the same
 * coordinates — safe for snapshot rendering and server-side generation. Each
 * node is also annotated with its degree and resolved community.
 *
 * Algorithms:
 *  - `force`    radial ring with a mild degree-based jitter (default)
 *  - `radial`   plain radial ring at the full layout radius
 *  - `community` nodes orbit their community's anchor on the ring
 *  - `manual`   same ring as `radial`; intended as a base for host-driven pinning
 */
export function layoutCommunityGraph(
  graph: CommunityGraph,
  options: LayoutOptions = {},
): PositionedGraph {
  const algorithm = options.algorithm ?? 'force'
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT

  const degree = computeDegrees(graph)

  const communityByNode = new Map<string, string>()
  for (const community of graph.communities) {
    for (const nodeId of community.nodes) {
      if (!communityByNode.has(nodeId)) communityByNode.set(nodeId, community.id)
    }
  }

  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.max(40, Math.min(width, height) * 0.38)

  const nodes = graph.nodes.map((node, index): PositionedGraphNode => {
    const angle = (Math.PI * 2 * index) / Math.max(1, graph.nodes.length)
    const communityIndex = graph.communities.findIndex(
      (community) => community.id === communityByNode.get(node.id),
    )
    const communityAngle = (Math.PI * 2 * Math.max(0, communityIndex)) / Math.max(1, graph.communities.length)
    const communityRadius = algorithm === 'community' ? radius * 0.55 : radius
    const localRadius = algorithm === 'force'
      ? radius * (0.7 + ((degree.get(node.id) ?? 0) % 4) * 0.08)
      : radius
    const x = algorithm === 'community'
      ? centerX + Math.cos(communityAngle) * communityRadius + Math.cos(angle) * 46
      : centerX + Math.cos(angle) * localRadius
    const y = algorithm === 'community'
      ? centerY + Math.sin(communityAngle) * communityRadius + Math.sin(angle) * 46
      : centerY + Math.sin(angle) * (algorithm === 'radial' ? radius : localRadius * 0.72)
    return {
      ...node,
      x,
      y,
      degree: degree.get(node.id) ?? 0,
      communityId: communityByNode.get(node.id),
    }
  })

  return {
    nodes,
    edges: graph.edges,
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
  }
}
