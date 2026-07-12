// Shared renderer control contract (#260).
//
// Every community-graph renderer tier — the JS-only SVG renderer (#259), the
// React `GraphView`, and the heavier interactive tiers (Sigma 2D #263, 3D #262)
// — honors this control/options surface so consumers can swap tiers without
// rewiring. Renderer-specific option types extend `GraphControlContract`; the
// shared filter semantics (community / edge-kind / node allow-list / min-degree)
// live in `applyControlFilters` so every tier filters identically.

import { colorForCommunity } from './color.js'
import { computeDegrees } from './degree.js'
import { filterCommunityGraph } from './filter.js'
import type { CommunityGraph, GraphLayoutAlgorithm } from './types.js'

/** Node/edge visibility filter shared by every renderer tier. */
export interface GraphControlFilters {
  /** Keep only nodes in these communities. */
  communityIds?: string[]
  /** Keep only edges whose `kind` is in this set. */
  edgeKinds?: string[]
  /** Explicit node allow-list. */
  nodeIds?: string[]
  /** Hide nodes with fewer than this many connections (degree) in the visible set. */
  minDegree?: number
}

/**
 * The control surface common to all renderer tiers. A consumer coded against
 * this contract can move a graph between the JS-only renderer, React
 * `GraphView`, and future tiers by passing the same options object.
 */
export interface GraphControlContract {
  /** Layout algorithm. Default `force`. */
  algorithm?: GraphLayoutAlgorithm
  /** Visibility filter. */
  filters?: GraphControlFilters
  /** Selected node id (controlled). */
  selectedNodeId?: string | null
  /** Selection callback (click / keyboard). */
  onSelectNode?: (nodeId: string) => void
  /** Navigation callback (double-click / Enter on a selected node). */
  onNavigate?: (nodeId: string) => void
  /** Human label for a node (popup / a11y). Default: the node id. */
  labelFor?: (nodeId: string) => string
  /** Community palette override. */
  colors?: readonly string[]
  /** Logical viewport size. */
  width?: number
  height?: number
}

/** One community-legend row: community id, its color, and member count. */
export interface GraphLegendEntry {
  communityId: string
  color: string
  count: number
}

/**
 * Apply the shared {@link GraphControlFilters} to `graph`. Composes the engine's
 * community / edge-kind / node-allow-list filter with a `minDegree` pass
 * (degree computed over the already-filtered set). Pure — input is not mutated.
 */
export function applyControlFilters(
  graph: CommunityGraph | null | undefined,
  filters?: GraphControlFilters,
): CommunityGraph {
  const base = filterCommunityGraph(graph, filters)
  const minDegree = filters?.minDegree ?? 0
  if (minDegree <= 0) return base
  const degree = computeDegrees(base)
  const keep = base.nodes.filter((n) => (degree.get(n.id) ?? 0) >= minDegree).map((n) => n.id)
  if (keep.length === base.nodes.length) return base
  return filterCommunityGraph(base, { nodeIds: keep })
}

/**
 * Build community-legend rows for a graph — the shared data that any tier can
 * render as a legend and use to drive the `communityIds` show/hide filter.
 * Sorted by member count (largest first). Colors match `colorForCommunity`.
 */
export function communityLegend(
  graph: CommunityGraph | null | undefined,
  colors?: readonly string[],
): GraphLegendEntry[] {
  if (!graph) return []
  return graph.communities
    .map((c) => ({
      communityId: c.id,
      color: colorForCommunity(c.id, colors),
      count: c.nodes.length,
    }))
    .sort((a, b) => b.count - a.count || a.communityId.localeCompare(b.communityId))
}
