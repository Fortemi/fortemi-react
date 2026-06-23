// Core framework-agnostic graph model shared across fortemi packages and
// JS-only hosts. These shapes are intentionally minimal and serializable —
// a node is just an identity, edges and communities reference nodes by id.

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

/** Deterministic layout algorithms understood by {@link layoutCommunityGraph}. */
export type GraphLayoutAlgorithm = 'force' | 'radial' | 'community' | 'manual'

/** A node with computed 2D coordinates, render radius, degree, and community. */
export interface PositionedGraphNode extends GraphNode {
  x: number
  y: number
  /** Stable render radius, derived from degree/weight by default. */
  r: number
  degree: number
  communityId?: string
}

/** A community with a computed centroid over its positioned member nodes. */
export interface PositionedCommunity {
  id: string
  x: number
  y: number
  /** Number of member nodes that contributed to the centroid. */
  size: number
}

/** Result of laying out a {@link CommunityGraph} into 2D space. */
export interface PositionedGraph {
  nodes: PositionedGraphNode[]
  edges: GraphEdge[]
  /** Lookup from node id to its positioned node. */
  nodeIndex: Map<string, PositionedGraphNode>
  /** Community centroids over the final positions (empty when none). */
  communities: PositionedCommunity[]
}

/** Axis-aligned bounding box around a set of positioned nodes. */
export interface GraphBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

/** A viewport transform that fits a {@link GraphBounds} into a target rect. */
export interface ViewportTransform {
  scale: number
  offsetX: number
  offsetY: number
}
