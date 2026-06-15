import type { CommunityGraph } from './types.js'

/** Count the (undirected) degree of every node, including isolated nodes (0). */
export function computeDegrees(graph: CommunityGraph): Map<string, number> {
  const degree = new Map<string, number>()
  for (const node of graph.nodes) degree.set(node.id, 0)
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  return degree
}

export interface NodeRadiusOptions {
  /** Radius of a degree-0 node. */
  base?: number
  /** Pixels added per unit of degree. */
  perDegree?: number
  /** Hard floor on the radius. */
  min?: number
  /** Hard ceiling on the radius. */
  max?: number
}

/**
 * Map a node degree to a render radius. Defaults match the values historically
 * used by the React `GraphView`: `clamp(5 + degree * 1.5, 5, 16)`.
 */
export function nodeRadius(degree: number, options: NodeRadiusOptions = {}): number {
  const base = options.base ?? 5
  const perDegree = options.perDegree ?? 1.5
  const min = options.min ?? 5
  const max = options.max ?? 16
  return Math.max(min, Math.min(max, base + degree * perDegree))
}
