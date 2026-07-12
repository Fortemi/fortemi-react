// Pure geometry for GraphView pointer interaction (issue #245). Kept separate
// from the component so the coordinate inversion — the one piece with real logic
// in the drag path — is unit-testable in the package's node test environment.

export interface GraphViewTransform {
  /** viewBox width / height (SVG user units). */
  width: number
  height: number
  /** Inner-group zoom scale. */
  scale: number
  /** Inner-group pan offset in viewBox units. */
  offset: { x: number; y: number }
}

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Convert a client (screen) point to graph-space coordinates, undoing both the
 * client→viewBox scaling and the inner `translate(offset) scale(scale)`
 * transform. The SVG uses `viewBox="0 0 width height"` with a matching
 * aspect-ratio container, so the client→viewBox scale is uniform per axis.
 * Returns `{ x: 0, y: 0 }` for a zero-sized rect (not yet laid out).
 */
export function clientToGraphPoint(
  rect: ClientRectLike,
  transform: GraphViewTransform,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  const vbX = ((clientX - rect.left) / rect.width) * transform.width
  const vbY = ((clientY - rect.top) / rect.height) * transform.height
  return {
    x: (vbX - transform.offset.x) / transform.scale,
    y: (vbY - transform.offset.y) / transform.scale,
  }
}
