// Shared UI for the graph examples: a 2D/3D renderer toggle, a lazily-loaded 3D
// view, and a node-summary card. Kept out of the data-only `.` entry (imported
// via `@fortemi/examples-shared/ui`) so non-React example consumers stay lean.
//
// The shapes mirror the production references:
//   • the segmented 2D/3D toggle follows magly.net's GraphView wrapper, which
//     lazy-loads the Three.js renderer only when 3D is selected;
//   • the node card follows pagenary's docs-map `__detail` aside — a bordered
//     card with the node title and a row of pill chips.

import { Suspense, lazy, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { colorForCommunity, computeDegrees, type CommunityGraph } from '@fortemi/graph'
import type { SigmaTheme } from '@fortemi/react/graph-2d'
import type { ForceGraph3DViewProps, ForceGraph3DTheme } from '@fortemi/react/graph-3d'

export type GraphMode = '2d' | '3d'

/**
 * Map every node id to the id of the community that lists it. Community
 * membership lives in `CommunityGraph.communities[].nodes`, not on the node
 * itself, so a per-node summary has to invert that.
 */
export function nodeCommunityIndex(graph: CommunityGraph | null): Map<string, string> {
  const map = new Map<string, string>()
  for (const community of graph?.communities ?? []) {
    for (const nodeId of community.nodes) map.set(nodeId, community.id)
  }
  return map
}

// Three.js ships only when 3D is first mounted (the wrapper module itself is
// deferred here; ForceGraph3DView then lazy-imports react-force-graph-3d).
const ForceGraph3DViewLazy = lazy(() =>
  import('@fortemi/react/graph-3d').then((m) => ({ default: m.ForceGraph3DView })),
)

/** ForceGraph3DView behind a Suspense boundary — render only in 3D mode. */
export function Graph3DLazy(props: ForceGraph3DViewProps) {
  return (
    <Suspense fallback={<div style={lazyFallback}>Loading the 3D renderer…</div>}>
      <ForceGraph3DViewLazy {...props} />
    </Suspense>
  )
}

/** Controlled segmented `[2D | 3D]` toggle. */
export function GraphModeToggle({
  mode,
  onModeChange,
  style,
}: {
  mode: GraphMode
  onModeChange: (mode: GraphMode) => void
  style?: CSSProperties
}) {
  return (
    <div role="group" aria-label="Renderer dimension" style={{ ...seg, ...style }}>
      {(['2d', '3d'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onModeChange(m)}
          style={segBtn(mode === m)}
        >
          {m === '2d' ? '2D' : '3D'}
        </button>
      ))}
    </div>
  )
}

/**
 * Node-summary card shown on node click. Presentational only — the caller
 * supplies the resolved fields (label / community / degree / tags), matching how
 * pagenary's docs-map builds its detail aside over GraphView's onSelectNode.
 */
export function NodeSummaryCard({
  label,
  communityId,
  communityColor,
  degree,
  tags,
  onOpen,
  onClose,
  openLabel = 'Open →',
  style,
}: {
  label: string
  communityId?: string | null
  communityColor?: string
  degree?: number
  tags?: string[]
  onOpen?: () => void
  onClose?: () => void
  openLabel?: string
  style?: CSSProperties
}) {
  const chips: ReactNode[] = []
  if (communityId) {
    chips.push(
      <span key="community" style={chip}>
        <span style={{ ...swatch, background: communityColor ?? '#8a8172' }} />
        {communityId}
      </span>,
    )
  }
  if (typeof degree === 'number') {
    chips.push(
      <span key="degree" style={chip}>
        {degree} link{degree === 1 ? '' : 's'}
      </span>,
    )
  }
  for (const tag of tags ?? []) {
    chips.push(
      <span key={`tag-${tag}`} style={chip}>
        {tag}
      </span>,
    )
  }

  return (
    <aside style={{ ...detail, ...style }} data-node-summary>
      <div style={detailHead}>
        <h2 style={detailTitle}>{label}</h2>
        {onClose && (
          <button type="button" aria-label="Dismiss" onClick={onClose} style={closeBtn}>
            ×
          </button>
        )}
      </div>
      {chips.length > 0 && <div style={chipRow}>{chips}</div>}
      {onOpen && (
        <button type="button" onClick={onOpen} style={openBtn}>
          {openLabel}
        </button>
      )}
    </aside>
  )
}

/**
 * Smart wrapper: resolve a node's label, community, degree, and community color
 * straight from the graph and render {@link NodeSummaryCard}. This is the common
 * case every graph example needs, so the per-example wiring stays a single line.
 * Renders nothing when `nodeId` is null.
 */
export function GraphNodeSummary({
  graph,
  nodeId,
  labelFor,
  onOpen,
  onClose,
  openLabel,
  style,
}: {
  graph: CommunityGraph | null
  nodeId: string | null
  labelFor?: (id: string) => string
  onOpen?: () => void
  onClose?: () => void
  openLabel?: string
  style?: CSSProperties
}) {
  const degrees = useMemo(() => (graph ? computeDegrees(graph) : new Map<string, number>()), [graph])
  const communities = useMemo(() => nodeCommunityIndex(graph), [graph])

  if (!nodeId) return null
  const communityId = communities.get(nodeId) ?? null

  return (
    <NodeSummaryCard
      label={labelFor ? labelFor(nodeId) : nodeId}
      communityId={communityId}
      communityColor={colorForCommunity(communityId ?? undefined)}
      degree={degrees.get(nodeId) ?? 0}
      onOpen={onOpen}
      onClose={onClose}
      openLabel={openLabel}
      style={style}
    />
  )
}

// ── styles — driven by the shared theme variables (see theme.css) with light
//    fallbacks, so these controls follow the page's light/dark mode. ──
const seg: CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--rule, #d9e2f4)',
  borderRadius: 6,
  overflow: 'hidden',
}
function segBtn(active: boolean): CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--accent, #2563eb)' : 'transparent',
    color: active ? '#ffffff' : 'var(--muted, #41527a)',
  }
}
const detail: CSSProperties = {
  border: '1px solid var(--rule, #d9e2f4)',
  borderRadius: 6,
  padding: 12,
  background: 'var(--surface, #ffffff)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const detailHead: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
}
const detailTitle: CSSProperties = { margin: 0, fontSize: 15, color: 'var(--ink, #0e1726)' }
const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 }
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--rule, #d9e2f4)',
  borderRadius: 999,
  padding: '2px 8px',
  fontSize: 11,
  color: 'var(--muted, #41527a)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}
const swatch: CSSProperties = { width: 9, height: 9, borderRadius: 999, display: 'inline-block' }
const openBtn: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--rule, #d9e2f4)',
  background: 'var(--surface-2, #fff)',
  cursor: 'pointer',
  color: 'var(--ink, #0e1726)',
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  color: 'var(--muted, #41527a)',
  padding: 0,
}
const lazyFallback: CSSProperties = {
  padding: 24,
  color: 'var(--muted, #41527a)',
  fontSize: 13,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  textAlign: 'center',
}

// ── Theme controller ─────────────────────────────────────────────────────────
// Light/dark theme with an OS-following "system" default, persisted to
// localStorage and applied by flipping `data-theme` on <html> (see theme.css).

export type ThemePreference = 'light' | 'dark' | 'system'
export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'fortemi-theme'

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

function applyPreference(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (pref === 'system') delete root.dataset.theme
  else root.dataset.theme = pref
}

/** Apply the persisted theme preference. Call once at app startup. */
export function initTheme(): void {
  applyPreference(readStoredPreference())
}

const listeners = new Set<() => void>()
function emitThemeChange(): void {
  for (const listener of listeners) listener()
}

export function getThemePreference(): ThemePreference {
  return readStoredPreference()
}

export function setThemePreference(pref: ThemePreference): void {
  if (typeof localStorage !== 'undefined') {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  }
  applyPreference(pref)
  emitThemeChange()
}

/** The resolved mode actually in effect (the preference, or the OS for 'system'). */
export function resolveThemeMode(): ThemeMode {
  const pref = readStoredPreference()
  if (pref !== 'system') return pref
  if (typeof matchMedia === 'undefined') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function subscribeTheme(callback: () => void): () => void {
  listeners.add(callback)
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null
  const onSystemChange = () => callback()
  mq?.addEventListener('change', onSystemChange)
  return () => {
    listeners.delete(callback)
    mq?.removeEventListener('change', onSystemChange)
  }
}

/** Subscribe to the resolved light/dark mode (re-renders on toggle or OS change). */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, resolveThemeMode, () => 'light')
}

/** Subscribe to the raw preference (light/dark/system) — for the toggle's state. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference, () => 'system')
}

/**
 * Explicit light/dark theme objects for the canvas / WebGL renderers (Sigma and
 * 3D), which can't read CSS variables. The SVG GraphView themes itself via the
 * ambient `--fortemi-graph-*` variables, so it needs nothing here.
 */
export function graphThemeFor(mode: ThemeMode): {
  sigma: Partial<SigmaTheme>
  force3d: ForceGraph3DTheme
} {
  if (mode === 'dark') {
    return {
      sigma: {
        node: '#5b8cff',
        ink: '#ffffff',
        edge: '#314264',
        dimNode: '#182541',
        dimEdge: '#111c32',
        label: '#e8eef9',
      },
      force3d: { background: '#070b14', link: '#314264' },
    }
  }
  return {
    sigma: {
      node: '#2563eb',
      ink: '#0e1726',
      edge: '#9aaccc',
      dimNode: '#d9e2f4',
      dimEdge: '#e8eef9',
      label: '#0e1726',
    },
    force3d: { background: '#ffffff', link: '#9aaccc' },
  }
}

/**
 * Classy segmented light / system / dark control. Pass `floating` to pin it to
 * the top-right of the page (uniform placement across examples without touching
 * each header's markup).
 */
export function ThemeToggle({ style, floating }: { style?: CSSProperties; floating?: boolean }) {
  const pref = useThemePreference()
  const options: Array<{ id: ThemePreference; glyph: string; label: string }> = [
    { id: 'light', glyph: '☀', label: 'Light' },
    { id: 'system', glyph: '◐', label: 'System' },
    { id: 'dark', glyph: '☾', label: 'Dark' },
  ]
  return (
    <div
      role="group"
      aria-label="Color theme"
      style={{ ...seg, background: 'var(--surface-2, #fff)', ...(floating ? floatToggle : null), ...style }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={pref === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => setThemePreference(option.id)}
          style={{ ...segBtn(pref === option.id), padding: '4px 10px', fontSize: 14 }}
        >
          <span aria-hidden="true">{option.glyph}</span>
        </button>
      ))}
    </div>
  )
}

const floatToggle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 50,
  boxShadow: '0 1px 6px rgba(0, 0, 0, 0.15)',
}
