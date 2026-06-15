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

/** A node with computed 2D coordinates, degree, and resolved community. */
export interface PositionedGraphNode extends GraphNode {
  x: number
  y: number
  degree: number
  communityId?: string
}

/** Result of laying out a {@link CommunityGraph} into 2D space. */
export interface PositionedGraph {
  nodes: PositionedGraphNode[]
  edges: GraphEdge[]
  /** Lookup from node id to its positioned node. */
  nodeIndex: Map<string, PositionedGraphNode>
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
