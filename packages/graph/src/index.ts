// @fortemi/graph — framework-agnostic graph presentation/projection helpers.
//
// This is a standalone add-on with zero runtime dependencies. It layers on top
// of any host that produces `CommunityGraph`-shaped data (e.g. @fortemi/core's
// GraphRepository / AIWG index export) and gives React and JS-only hosts the
// shared projection, layout, filtering, coloring, sizing, bounds, neighborhood,
// and snapshot logic needed to render their own SVG/canvas views.
//
// Community *detection* intentionally lives in @fortemi/core (the base layer);
// this package only renders/projects graphs it is given.

export const VERSION = '2026.6.2'

export type {
  GraphNode,
  GraphEdge,
  GraphCommunity,
  CommunityGraph,
  GraphLayoutAlgorithm,
  PositionedGraphNode,
  PositionedGraph,
  GraphBounds,
  ViewportTransform,
} from './types.js'

export { computeDegrees, nodeRadius } from './degree.js'
export type { NodeRadiusOptions } from './degree.js'

export { COMMUNITY_COLORS, UNASSIGNED_COMMUNITY_COLOR, colorForCommunity } from './color.js'

export { filterCommunityGraph } from './filter.js'
export type { GraphFilter } from './filter.js'

export { layoutCommunityGraph } from './layout.js'
export type { LayoutOptions } from './layout.js'

export { computeGraphBounds, fitGraphToViewport } from './bounds.js'
export type { FitOptions } from './bounds.js'

export {
  buildAdjacency,
  neighborsOf,
  expandNeighborhood,
  subgraphForNodes,
  neighborhoodSubgraph,
} from './neighborhood.js'
export type { ExpandOptions } from './neighborhood.js'

export {
  GRAPH_SNAPSHOT_VERSION,
  serializeGraphSnapshot,
  stringifyGraphSnapshot,
  deserializeGraphSnapshot,
} from './serialize.js'
export type { GraphSnapshot, SerializeSnapshotOptions } from './serialize.js'
