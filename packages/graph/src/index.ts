// @fortemi/graph — framework-agnostic graph presentation/projection helpers
// plus the graph-source controller.
//
// Depends on @fortemi/core (the base data layer) and is consumed by
// @fortemi/react and JS-only hosts. Dependency direction is the linear chain:
// pglite ← @fortemi/core ← @fortemi/graph ← @fortemi/react. @fortemi/core never
// imports @fortemi/graph.
//
// Pure projection helpers (layout, filtering, coloring, sizing, bounds,
// neighborhood, snapshot) give React and JS-only hosts the shared logic to
// render their own SVG/canvas views. `GraphController` adds the framework-
// agnostic graph-source state machine (mode selection + load dispatch) on top
// of @fortemi/core's repositories.
//
// Community *detection* intentionally lives in @fortemi/core (the base layer);
// this package only renders/projects graphs it is given and orchestrates which
// source to load.

export const VERSION = '2026.7.3'

export type {
  GraphNode,
  GraphEdge,
  GraphCommunity,
  CommunityGraph,
  GraphLayoutAlgorithm,
  PositionedGraphNode,
  PositionedCommunity,
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
export type { LayoutOptions, NodeRadiusResolver } from './layout.js'

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

export { GraphController } from './controller.js'
export type {
  GraphControllerDb,
  GraphSourceMode,
  GraphLayoutState,
  GraphTransitionState,
  GraphControllerStatus,
  GraphSourceRef,
  GraphControllerState,
  GraphControllerOptions,
  GraphControllerListener,
} from './controller.js'
