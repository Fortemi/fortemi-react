import type { GraphBounds, PositionedGraphNode, ViewportTransform } from './types.js'

const EMPTY_BOUNDS: GraphBounds = {
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  width: 0,
  height: 0,
  centerX: 0,
  centerY: 0,
}

/**
 * Compute the axis-aligned bounding box around a set of positioned nodes.
 * Returns an all-zero box for an empty input.
 */
export function computeGraphBounds(
  nodes: ReadonlyArray<Pick<PositionedGraphNode, 'x' | 'y'>>,
): GraphBounds {
  if (nodes.length === 0) return { ...EMPTY_BOUNDS }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.y < minY) minY = node.y
    if (node.x > maxX) maxX = node.x
    if (node.y > maxY) maxY = node.y
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  }
}

export interface FitOptions {
  /** Uniform padding (in viewport units) to leave around the graph. */
  padding?: number
  /** Clamp the computed scale to this minimum. */
  minScale?: number
  /** Clamp the computed scale to this maximum. */
  maxScale?: number
}

/**
 * Compute a {@link ViewportTransform} (uniform scale + translation) that fits
 * `bounds` centered within a `viewport` of the given width/height. Apply the
 * result as `translate(offsetX, offsetY) scale(scale)` in SVG/canvas space.
 */
export function fitGraphToViewport(
  bounds: GraphBounds,
  viewport: { width: number; height: number },
  options: FitOptions = {},
): ViewportTransform {
  const padding = options.padding ?? 0
  const minScale = options.minScale ?? 0
  const maxScale = options.maxScale ?? Infinity

  const availableWidth = Math.max(0, viewport.width - padding * 2)
  const availableHeight = Math.max(0, viewport.height - padding * 2)

  let scale = 1
  if (bounds.width > 0 || bounds.height > 0) {
    const scaleX = bounds.width > 0 ? availableWidth / bounds.width : Infinity
    const scaleY = bounds.height > 0 ? availableHeight / bounds.height : Infinity
    scale = Math.min(scaleX, scaleY)
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  scale = Math.max(minScale, Math.min(maxScale, scale))

  const offsetX = viewport.width / 2 - bounds.centerX * scale
  const offsetY = viewport.height / 2 - bounds.centerY * scale
  return { scale, offsetX, offsetY }
}
