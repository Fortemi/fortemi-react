// Render-prep + snapshot warm-start helpers (issue #264).
//
// Consumers (JS-only SVG #259, React GraphView, the interactive 2D/3D tiers)
// all need the same two things a live `GraphController` build does not give
// them directly:
//
//   1. a CommunityGraph → render-ready mapping (labels, degree-derived size,
//      per-community tone, and baked positions when available), and
//   2. an instant "snapshot-first" load of a precomputed graph with baked x/y,
//      falling back to a live build when no snapshot exists.
//
// Both are generic and framework-agnostic, so they live here in @fortemi/graph
// and every renderer shares them — the runtime loader and the build-time writer
// map through the same `mapCommunityGraph` so on-disk snapshots and live builds
// render identically.

import type { CommunityGraph } from './types.js'
import { computeDegrees, nodeRadius, type NodeRadiusOptions } from './degree.js'
import { colorForCommunity, UNASSIGNED_COMMUNITY_COLOR } from './color.js'
import { layoutCommunityGraph } from './layout.js'
import type { LayoutOptions } from './layout.js'

/**
 * Greyscale community ramp — warm-grey, darkest first, meant to sit on a light
 * ("cream") background. Index 0 (darkest) is the largest community. Strictly
 * greyscale so community tone reads as density, not category.
 */
export const GREYSCALE_COMMUNITY_RAMP = [
  '#2B2824',
  '#43403A',
  '#585149',
  '#6E665A',
  '#837A6B',
  '#968C7C',
] as const

/** A render-ready node: identity + label + degree-derived size + tone + optional baked position. */
export interface RenderNode {
  id: string
  label: string
  /** Degree-derived render size. */
  size: number
  /** Community tone (see {@link CommunityPalette}). */
  color: string
  /** Community rank: 0 = largest community, ascending; -1 when unassigned. */
  communityRank: number
  /** Baked layout coordinate (present only when positions were supplied). */
  x?: number
  y?: number
}

/** A render-ready link (edge) referencing nodes by id. */
export interface RenderLink {
  source: string
  target: string
  weight: number
  kind?: string
}

/** A render-ready graph: the shape every renderer tier consumes. */
export interface RenderGraph {
  nodes: RenderNode[]
  links: RenderLink[]
  /** Number of communities in the source graph. */
  clusters: number
}

/**
 * Community coloring strategy for {@link mapCommunityGraph}:
 * - `'community'` (default): hash the community id into the qualitative palette
 *   (matches the historical `GraphView` coloring).
 * - `'greyscale'`: {@link GREYSCALE_COMMUNITY_RAMP} indexed by community rank
 *   (largest cluster = darkest).
 * - a custom array: indexed by community rank.
 */
export type CommunityPalette = 'community' | 'greyscale' | readonly string[]

export interface MapCommunityGraphOptions {
  /** Resolve a human label for a node id. Defaults to the id itself. */
  labelFor?: (id: string) => string
  /** Baked layout positions to stamp onto nodes (warm start). */
  positions?: Map<string, { x: number; y: number }> | Record<string, { x: number; y: number }>
  /** Community coloring strategy. Default `'community'`. */
  palette?: CommunityPalette
  /** Node-radius tuning passed to {@link nodeRadius} (default sizer). */
  radius?: NodeRadiusOptions
  /** Override the degree → size mapping entirely. */
  sizeFor?: (degree: number, id: string) => number
}

function positionGetter(
  positions: MapCommunityGraphOptions['positions'],
): (id: string) => { x: number; y: number } | undefined {
  if (!positions) return () => undefined
  if (positions instanceof Map) return (id) => positions.get(id)
  return (id) => (Object.prototype.hasOwnProperty.call(positions, id) ? positions[id] : undefined)
}

/**
 * Rank communities by member count, largest first. Returns a map from community
 * id to its rank (0 = largest). Ties break on community id for determinism.
 */
export function communityRanks(graph: CommunityGraph): Map<string, number> {
  const rank = new Map<string, number>()
  ;[...graph.communities]
    .sort((a, b) => b.nodes.length - a.nodes.length || a.id.localeCompare(b.id))
    .forEach((community, index) => rank.set(community.id, index))
  return rank
}

function colorForRank(
  communityId: string | undefined,
  rank: number,
  palette: CommunityPalette,
): string {
  if (palette === 'community') return colorForCommunity(communityId)
  const ramp = palette === 'greyscale' ? GREYSCALE_COMMUNITY_RAMP : palette
  if (ramp.length === 0) return UNASSIGNED_COMMUNITY_COLOR
  if (rank < 0) return ramp[ramp.length - 1] // unassigned → lightest
  return ramp[rank % ramp.length]
}

/**
 * Map a {@link CommunityGraph} to a render-ready {@link RenderGraph}: labels,
 * degree-derived node size, per-community tone (largest cluster = darkest for
 * ramped palettes), and baked positions when supplied. Pure and deterministic —
 * shared by the runtime loader and the build-time snapshot writer so both render
 * identically.
 */
export function mapCommunityGraph(
  graph: CommunityGraph,
  options: MapCommunityGraphOptions = {},
): RenderGraph {
  const palette = options.palette ?? 'community'
  const labelFor = options.labelFor ?? ((id: string) => id)
  const getPos = positionGetter(options.positions)
  const sizeFor =
    options.sizeFor ?? ((degree: number) => nodeRadius(degree, options.radius))

  const degrees = computeDegrees(graph)
  const rankByComm = communityRanks(graph)
  const commOfNode = new Map<string, string>()
  for (const community of graph.communities) {
    for (const id of community.nodes) commOfNode.set(id, community.id)
  }

  const nodes: RenderNode[] = graph.nodes.map((node) => {
    const communityId = commOfNode.get(node.id)
    const rank = communityId != null ? rankByComm.get(communityId) ?? -1 : -1
    const degree = degrees.get(node.id) ?? 0
    const pos = getPos(node.id)
    const rendered: RenderNode = {
      id: node.id,
      label: labelFor(node.id),
      size: sizeFor(degree, node.id),
      color: colorForRank(communityId, rank, palette),
      communityRank: rank,
    }
    if (pos) {
      rendered.x = pos.x
      rendered.y = pos.y
    }
    return rendered
  })

  const links: RenderLink[] = graph.edges.map((edge) => {
    const link: RenderLink = { source: edge.source, target: edge.target, weight: edge.weight }
    if (edge.kind !== undefined) link.kind = edge.kind
    return link
  })

  return { nodes, links, clusters: graph.communities.length }
}

export interface BakeRenderGraphOptions extends MapCommunityGraphOptions {
  /** Layout options for the one-shot build-time layout pass. */
  layout?: LayoutOptions
}

/**
 * Build-time snapshot writer: run the layout once and emit a {@link RenderGraph}
 * with baked x/y so hosts can warm-start (skip the layout pass) at runtime.
 * Companion to `serializeGraphSnapshot` — this bakes render-ready positions
 * rather than storing the raw graph + layout intent. Any `positions` passed in
 * options are ignored in favor of the freshly computed layout.
 */
export function bakeRenderGraph(
  graph: CommunityGraph,
  options: BakeRenderGraphOptions = {},
): RenderGraph {
  const positioned = layoutCommunityGraph(graph, options.layout)
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of positioned.nodes) positions.set(node.id, { x: node.x, y: node.y })
  // Re-map with the freshly computed positions; any `positions` passed in are ignored.
  const mapOptions: MapCommunityGraphOptions = { positions }
  if (options.labelFor) mapOptions.labelFor = options.labelFor
  if (options.palette) mapOptions.palette = options.palette
  if (options.radius) mapOptions.radius = options.radius
  if (options.sizeFor) mapOptions.sizeFor = options.sizeFor
  return mapCommunityGraph(graph, mapOptions)
}

/** Deterministic JSON for a render graph (stable key order for cache-friendly diffs). */
export function stringifyRenderGraph(graph: RenderGraph): string {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))
  const links = [...graph.links].sort(
    (a, b) =>
      a.source.localeCompare(b.source)
      || a.target.localeCompare(b.target)
      || (a.kind ?? '').localeCompare(b.kind ?? ''),
  )
  return JSON.stringify({ nodes, links, clusters: graph.clusters })
}

/** Structural guard for a {@link RenderGraph} loaded from an untrusted source. */
export function isRenderGraph(value: unknown): value is RenderGraph {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RenderGraph>
  return (
    Array.isArray(candidate.nodes)
    && candidate.nodes.length > 0
    && Array.isArray(candidate.links)
    && candidate.nodes.every(
      (n) => n && typeof n.id === 'string' && typeof n.size === 'number' && typeof n.color === 'string',
    )
  )
}

/** Whether every node in a render graph carries a baked position. */
export function hasBakedPositions(graph: RenderGraph): boolean {
  return graph.nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number')
}

export interface LoadRenderSnapshotOptions {
  /** `fetch` implementation to use when `source` is a URL. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /** Require baked x/y on every node; a snapshot without positions resolves to `null`. Default `true`. */
  requirePositions?: boolean
}

/**
 * Snapshot-first loader (issue #264). Load a precomputed, render-ready graph
 * carrying baked positions — instant, no live `GraphController` build and no
 * layout pass. Accepts a URL to fetch, an already-parsed {@link RenderGraph}, or
 * a thunk. Returns `null` (never throws) when the snapshot is absent, malformed,
 * or lacks baked positions, so callers fall back to a live build + `mapCommunityGraph`.
 */
export async function loadRenderSnapshot(
  source: string | RenderGraph | (() => Promise<RenderGraph | null> | RenderGraph | null),
  options: LoadRenderSnapshotOptions = {},
): Promise<RenderGraph | null> {
  const requirePositions = options.requirePositions ?? true
  try {
    let data: unknown
    if (typeof source === 'string') {
      const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
      if (!fetchImpl) return null
      const res = await fetchImpl(source)
      if (!res.ok) return null
      data = await res.json()
    } else if (typeof source === 'function') {
      data = await source()
    } else {
      data = source
    }
    if (!isRenderGraph(data)) return null
    if (requirePositions && !hasBakedPositions(data)) return null
    return data
  } catch {
    return null
  }
}
