/** Default qualitative palette for community coloring (8 hues). */
export const COMMUNITY_COLORS = [
  '#2f6fbb',
  '#d97706',
  '#218838',
  '#7c3aed',
  '#c2410c',
  '#0f766e',
  '#be185d',
  '#4b5563',
] as const

/** Color used for nodes that are not assigned to any community. */
export const UNASSIGNED_COMMUNITY_COLOR = '#64748b'

/**
 * Deterministically assign a color to a community id by hashing the id into the
 * palette. The same id always maps to the same color across runs and hosts.
 * Pass a custom `palette` to theme the output. Matches the historical
 * `GraphView` color assignment.
 */
export function colorForCommunity(
  communityId: string | undefined,
  palette: readonly string[] = COMMUNITY_COLORS,
  unassignedColor: string = UNASSIGNED_COMMUNITY_COLOR,
): string {
  if (!communityId) return unassignedColor
  if (palette.length === 0) return unassignedColor
  let hash = 0
  for (const char of communityId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return palette[Math.abs(hash) % palette.length]
}
