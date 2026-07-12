import { computeDegrees, nodeRadius as defaultNodeRadius, type NodeRadiusOptions } from './degree.js'
import { mulberry32 } from './rng.js'
import type {
  CommunityGraph,
  GraphLayoutAlgorithm,
  GraphNode,
  PositionedCommunity,
  PositionedGraph,
  PositionedGraphNode,
} from './types.js'

/**
 * How to derive each node's render radius. Either a fixed pixel value, a set of
 * {@link NodeRadiusOptions} fed to the default degree→radius mapping, or a full
 * resolver `(degree, node) => number`.
 */
export type NodeRadiusResolver =
  | number
  | NodeRadiusOptions
  | ((degree: number, node: GraphNode) => number)

export interface LayoutOptions {
  /** Layout algorithm. `force` runs deterministic settlement; the others are closed-form. */
  algorithm?: GraphLayoutAlgorithm
  width?: number
  height?: number
  /** Seed for the deterministic PRNG used by `force` initial jitter. Identical seed ⇒ identical output. */
  seed?: number
  /** Number of settlement iterations for the `force` algorithm. */
  ticks?: number
  /** Per-node render radius (default: degree-derived, clamped 5..16). */
  nodeRadius?: NodeRadiusResolver
  /** Target edge length in px for the spring force (`force` only). */
  linkDistance?: number
  /** Spring stiffness 0..1 (`force` only). */
  linkStrength?: number
  /** Repulsion magnitude; negative pushes nodes apart (`force` only). */
  chargeStrength?: number
  /** Extra spacing beyond `r_i + r_j` when resolving collisions (`force` only). */
  collisionPadding?: number
  /** Pull toward the node's community centroid, 0..1 (`force` only). */
  communityStrength?: number
  /** Keep every node center at least this many px from each canvas edge. */
  boundsPadding?: number
  /**
   * Positions to hold FIXED during settlement (drag pins, issue #245). Pinned
   * nodes stay put while the rest of the graph re-settles around them, giving an
   * incremental re-layout when a node is moved. Keyed by node id.
   */
  pinned?: PositionMap
  /**
   * Warm-start seed positions. Nodes present here begin the settlement from
   * these coordinates instead of the closed-form ring, so a re-layout resumes
   * from the current arrangement (smooth reshape) rather than re-seeding. Keyed
   * by node id. `pinned` overrides this for pinned nodes.
   */
  initialPositions?: PositionMap
}

/** A node-id → position lookup, accepted as either a Map or a plain record. */
export type PositionMap =
  | Map<string, { x: number; y: number }>
  | Record<string, { x: number; y: number }>

function readPosition(
  map: PositionMap | undefined,
  id: string,
): { x: number; y: number } | undefined {
  if (!map) return undefined
  if (map instanceof Map) return map.get(id)
  return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined
}

const DEFAULTS = {
  width: 760,
  height: 460,
  seed: 1,
  ticks: 300,
  linkDistance: 60,
  linkStrength: 0.08,
  chargeStrength: -240,
  collisionPadding: 2,
  communityStrength: 0.05,
  boundsPadding: 24,
} as const

/** Mild global pull toward the canvas center so disconnected nodes don't drift. */
const GRAVITY = 0.02

function resolveRadius(
  resolver: NodeRadiusResolver | undefined,
  degree: number,
  node: GraphNode,
): number {
  if (resolver === undefined) return defaultNodeRadius(degree)
  if (typeof resolver === 'number') return resolver
  if (typeof resolver === 'function') return resolver(degree, node)
  return defaultNodeRadius(degree, resolver)
}

/** Clamp `value` into `[lo, hi]`, collapsing to the midpoint if the range inverts. */
function clampToRange(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Deterministically position the nodes of a {@link CommunityGraph} in 2D space.
 *
 * For the default `force` algorithm this runs a fixed-iteration, seeded force
 * settlement (spring link attraction, charge repulsion, collision spacing,
 * community cohesion, centering, and bounds clamping). It is fully synchronous
 * and headless — no animation frames — so the same `(graph, options)` always
 * yields identical coordinates, safe for snapshot rendering and SSR. The
 * `radial`, `community`, and `manual` algorithms remain closed-form.
 *
 * Every node is annotated with its render radius `r`, degree, and resolved
 * community; the result also carries community centroids over the final layout.
 */
export function layoutCommunityGraph(
  graph: CommunityGraph,
  options: LayoutOptions = {},
): PositionedGraph {
  const algorithm = options.algorithm ?? 'force'
  const width = options.width ?? DEFAULTS.width
  const height = options.height ?? DEFAULTS.height
  const boundsPadding = options.boundsPadding ?? DEFAULTS.boundsPadding

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
  const n = graph.nodes.length

  // Per-node render radius (stable, used by force spacing and by consumers).
  const r = graph.nodes.map((node) =>
    resolveRadius(options.nodeRadius, degree.get(node.id) ?? 0, node),
  )

  // Index from node id → array position (edges reference nodes by id).
  const indexOf = new Map<string, number>()
  graph.nodes.forEach((node, i) => indexOf.set(node.id, i))

  // Community ring anchors — used both as closed-form positions and as the
  // initial seed for force settlement, keeping clusters legible.
  const communityIndexById = new Map<string, number>()
  graph.communities.forEach((community, i) => communityIndexById.set(community.id, i))

  const x = new Float64Array(n)
  const y = new Float64Array(n)

  // --- Initial / closed-form positions ---------------------------------------
  graph.nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, n)
    const communityId = communityByNode.get(node.id)
    const communityIndex = communityId !== undefined ? communityIndexById.get(communityId) ?? -1 : -1
    const communityAngle =
      (Math.PI * 2 * Math.max(0, communityIndex)) / Math.max(1, graph.communities.length)
    const useCommunityOrbit = algorithm === 'community' || algorithm === 'force'
    const communityRadius = algorithm === 'community' ? radius * 0.55 : radius
    const localRadius =
      algorithm === 'force'
        ? radius * (0.7 + ((degree.get(node.id) ?? 0) % 4) * 0.08)
        : radius

    if (useCommunityOrbit && communityIndex >= 0) {
      x[index] = centerX + Math.cos(communityAngle) * communityRadius + Math.cos(angle) * 46
      y[index] = centerY + Math.sin(communityAngle) * communityRadius + Math.sin(angle) * 46
    } else {
      x[index] = centerX + Math.cos(angle) * localRadius
      y[index] =
        centerY + Math.sin(angle) * (algorithm === 'radial' ? radius : localRadius * 0.72)
    }
  })

  // Warm-start seed then pin overrides (issue #245). Warm start lets a re-layout
  // resume from the current arrangement; pinned coordinates win outright.
  const pinnedIndex = new Map<number, { x: number; y: number }>()
  // Nodes with a real seed (warm start or pin) already have distinct positions,
  // so they are exempt from the separation jitter below.
  const seededIndex = new Set<number>()
  graph.nodes.forEach((node, index) => {
    const seed = readPosition(options.initialPositions, node.id)
    if (seed) {
      x[index] = seed.x
      y[index] = seed.y
      seededIndex.add(index)
    }
    const pin = readPosition(options.pinned, node.id)
    if (pin) {
      x[index] = pin.x
      y[index] = pin.y
      pinnedIndex.set(index, pin)
      seededIndex.add(index)
    }
  })
  const holdPinned = () => {
    for (const [index, pos] of pinnedIndex) {
      x[index] = pos.x
      y[index] = pos.y
    }
  }

  // --- Force settlement (force algorithm only) -------------------------------
  if (algorithm === 'force' && n > 1) {
    const ticks = Math.max(0, Math.floor(options.ticks ?? DEFAULTS.ticks))
    const seed = options.seed ?? DEFAULTS.seed
    const linkDistance = options.linkDistance ?? DEFAULTS.linkDistance
    const linkStrength = options.linkStrength ?? DEFAULTS.linkStrength
    const chargeStrength = options.chargeStrength ?? DEFAULTS.chargeStrength
    const collisionPadding = options.collisionPadding ?? DEFAULTS.collisionPadding
    const communityStrength = options.communityStrength ?? DEFAULTS.communityStrength

    const rng = mulberry32(seed)
    // Deterministic jitter so no two seeded nodes coincide (avoids div-by-zero).
    // Pinned nodes are left exactly where they were placed. When nothing is
    // pinned the branch never fires, so unpinned output is bit-for-bit identical.
    for (let i = 0; i < n; i++) {
      if (seededIndex.has(i)) continue
      x[i] += (rng() - 0.5) * 8
      y[i] += (rng() - 0.5) * 8
    }

    // Pre-resolve edge endpoints to array indices once.
    const links: Array<{ a: number; b: number; weight: number }> = []
    for (const edge of graph.edges) {
      const a = indexOf.get(edge.source)
      const b = indexOf.get(edge.target)
      if (a === undefined || b === undefined || a === b) continue
      links.push({ a, b, weight: edge.weight > 0 ? edge.weight : 1 })
    }

    // Community membership as array indices, for centroid cohesion.
    const communityOf = graph.nodes.map((node) => communityByNode.get(node.id))
    const communityIds = graph.communities.map((c) => c.id)

    const dispX = new Float64Array(n)
    const dispY = new Float64Array(n)
    const chargeCutoff = linkDistance * 6
    const cooling = ticks > 0 ? Math.pow(0.001, 1 / ticks) : 1
    let alpha = 1

    for (let t = 0; t < ticks; t++) {
      dispX.fill(0)
      dispY.fill(0)

      // Spring link attraction toward linkDistance.
      for (const link of links) {
        let dx = x[link.b] - x[link.a]
        let dy = y[link.b] - y[link.a]
        const dist = Math.max(0.01, Math.hypot(dx, dy))
        const force = ((dist - linkDistance) / dist) * linkStrength * link.weight
        dx *= force
        dy *= force
        dispX[link.a] += dx
        dispY[link.a] += dy
        dispX[link.b] -= dx
        dispY[link.b] -= dy
      }

      // Pairwise charge repulsion (with a distance cutoff for dense graphs).
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[i] - x[j]
          const dy = y[i] - y[j]
          const dist = Math.max(0.01, Math.hypot(dx, dy))
          if (dist > chargeCutoff) continue
          // chargeStrength is negative ⇒ repulsion magnitude is positive.
          const mag = -chargeStrength / dist
          const ux = (dx / dist) * mag
          const uy = (dy / dist) * mag
          dispX[i] += ux
          dispY[i] += uy
          dispX[j] -= ux
          dispY[j] -= uy
        }
      }

      // Community cohesion (toward centroid) + global centering gravity.
      if (communityStrength > 0 && communityIds.length > 0) {
        const cx = new Float64Array(communityIds.length)
        const cy = new Float64Array(communityIds.length)
        const cn = new Int32Array(communityIds.length)
        const idxById = new Map<string, number>()
        communityIds.forEach((id, i) => idxById.set(id, i))
        for (let i = 0; i < n; i++) {
          const cid = communityOf[i]
          if (cid === undefined) continue
          const ci = idxById.get(cid)
          if (ci === undefined) continue
          cx[ci] += x[i]
          cy[ci] += y[i]
          cn[ci] += 1
        }
        for (let i = 0; i < n; i++) {
          const cid = communityOf[i]
          if (cid === undefined) continue
          const ci = idxById.get(cid)
          if (ci === undefined || cn[ci] === 0) continue
          dispX[i] += (cx[ci] / cn[ci] - x[i]) * communityStrength
          dispY[i] += (cy[ci] / cn[ci] - y[i]) * communityStrength
        }
      }
      for (let i = 0; i < n; i++) {
        dispX[i] += (centerX - x[i]) * GRAVITY
        dispY[i] += (centerY - y[i]) * GRAVITY
      }

      // Apply soft forces, cooled by alpha.
      for (let i = 0; i < n; i++) {
        x[i] += dispX[i] * alpha
        y[i] += dispY[i] * alpha
      }

      // Hard collision resolution (full strength) so nodes don't overlap.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = x[i] - x[j]
          const dy = y[i] - y[j]
          const dist = Math.max(0.01, Math.hypot(dx, dy))
          const minDist = r[i] + r[j] + collisionPadding
          if (dist >= minDist) continue
          const push = (minDist - dist) / 2
          const ux = (dx / dist) * push
          const uy = (dy / dist) * push
          x[i] += ux
          y[i] += uy
          x[j] -= ux
          y[j] -= uy
        }
      }

      // Clamp inside the padded canvas every tick.
      for (let i = 0; i < n; i++) {
        x[i] = clampToRange(x[i], boundsPadding + r[i], width - boundsPadding - r[i])
        y[i] = clampToRange(y[i], boundsPadding + r[i], height - boundsPadding - r[i])
      }

      // Re-assert pinned positions last so pins hold exactly and neighbors
      // settle around them.
      holdPinned()

      alpha *= cooling
    }
  } else {
    // Closed-form algorithms: still honor the bounds clamp, then hold pins.
    for (let i = 0; i < n; i++) {
      x[i] = clampToRange(x[i], boundsPadding + r[i], width - boundsPadding - r[i])
      y[i] = clampToRange(y[i], boundsPadding + r[i], height - boundsPadding - r[i])
    }
    holdPinned()
  }

  // --- Build the result ------------------------------------------------------
  const nodes = graph.nodes.map((node, index): PositionedGraphNode => ({
    ...node,
    x: x[index],
    y: y[index],
    r: r[index],
    degree: degree.get(node.id) ?? 0,
    communityId: communityByNode.get(node.id),
  }))

  const nodeIndex = new Map(nodes.map((node) => [node.id, node]))

  const communities: PositionedCommunity[] = graph.communities.map((community) => {
    let sx = 0
    let sy = 0
    let size = 0
    for (const nodeId of community.nodes) {
      const positioned = nodeIndex.get(nodeId)
      if (!positioned) continue
      sx += positioned.x
      sy += positioned.y
      size += 1
    }
    return size > 0
      ? { id: community.id, x: sx / size, y: sy / size, size }
      : { id: community.id, x: centerX, y: centerY, size: 0 }
  })

  return { nodes, edges: graph.edges, nodeIndex, communities }
}
