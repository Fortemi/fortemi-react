// @fortemi/graph — framework-agnostic graph presentation/projection helpers
// without the database-backed graph-source controller.
//
// This root entry intentionally has no runtime dependency on @fortemi/core, so
// JS-only hosts can import graph helpers without pulling the PGlite module
// graph. Database-backed graph-source orchestration lives at
// @fortemi/graph/controller.
//
// Pure projection helpers (layout, filtering, coloring, sizing, bounds,
// neighborhood, snapshot) give React and JS-only hosts the shared logic to
// render their own SVG/canvas views.
//
// Community *detection* intentionally lives in @fortemi/core (the base layer);
// this package only renders/projects graphs it is given and orchestrates which
// source to load.

export const VERSION = '2026.7.15'

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
export type { LayoutOptions, NodeRadiusResolver, PositionMap } from './layout.js'

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

export {
  GREYSCALE_COMMUNITY_RAMP,
  communityRanks,
  mapCommunityGraph,
  bakeRenderGraph,
  stringifyRenderGraph,
  isRenderGraph,
  hasBakedPositions,
  loadRenderSnapshot,
} from './render-prep.js'
export type {
  RenderNode,
  RenderLink,
  RenderGraph,
  CommunityPalette,
  MapCommunityGraphOptions,
  BakeRenderGraphOptions,
  LoadRenderSnapshotOptions,
} from './render-prep.js'

export { applyControlFilters, communityLegend } from './contract.js'
export type {
  GraphControlContract,
  GraphControlFilters,
  GraphLegendEntry,
} from './contract.js'

export { renderCommunityGraph } from './render-dom.js'
export type {
  GraphRenderOptions,
  GraphRenderFilters,
  GraphRenderUpdate,
  GraphRenderHandle,
} from './render-dom.js'

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
