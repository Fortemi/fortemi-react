// 3D force-directed graph view backed by react-force-graph-3d (Three.js),
// issue #262. A third renderer tier alongside the static SVG `GraphView` and
// the interactive 2D Sigma explorer.
//
// react-force-graph-3d (and its Three.js dependency) are OPTIONAL peer deps,
// loaded LAZILY through React.lazy → dynamic import() so Three only ships when
// this view is actually mounted (reach it via `@fortemi/react/graph-3d`). The
// type-only imports below are erased. Data is a `@fortemi/graph` `RenderGraph`
// (#264); the 3D engine computes its own positions, so baked 2D x/y are ignored.

import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { CommunityGraph } from '@fortemi/core'
import {
  applyControlFilters,
  mapCommunityGraph,
  loadRenderSnapshot,
  type RenderGraph,
  type GraphControlFilters,
  type CommunityPalette,
} from '@fortemi/graph'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-3d'

const ForceGraph3D = lazy(() => import('react-force-graph-3d'))

export interface ForceGraph3DTheme {
  background: string
  link: string
}

const DEFAULT_THEME: ForceGraph3DTheme = { background: '#fbfaf7', link: '#aba391' }
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'

type FG3DNode = NodeObject & { id: string; label: string; size: number; color: string }
type PinnedNode = FG3DNode & { fx?: number; fy?: number; fz?: number }
interface FG3DData {
  nodes: Array<{ id: string; label: string; size: number; color: string }>
  links: Array<{ source: string; target: string }>
}

// Module-level, referentially-stable accessors — a memoised Scene must not see
// new function identities, or the renderer re-inits and loses the user's orbit.
const nodeColorAcc = (n: NodeObject) => (n as FG3DNode).color
const nodeValAcc = (n: NodeObject) => (n as FG3DNode).size
const nodeLabelAcc = (n: NodeObject) => (n as FG3DNode).label

export interface ForceGraph3DViewProps {
  graph: CommunityGraph | RenderGraph | null
  /** Warm-start data from a baked snapshot (URL or object); 3D recomputes positions. */
  snapshot?: string | RenderGraph
  filters?: GraphControlFilters
  labelFor?: (id: string) => string
  palette?: CommunityPalette
  /** Node click (select). Ctrl/⌘-click re-anchors instead. */
  onSelectNode?: (nodeId: string) => void
  /** Node click also opens (reader/modal). */
  onOpenNode?: (nodeId: string) => void
  theme?: Partial<ForceGraph3DTheme>
  height?: number | string
  style?: CSSProperties
}

function toRenderGraph(
  graph: CommunityGraph | RenderGraph | null,
  props: Pick<ForceGraph3DViewProps, 'filters' | 'labelFor' | 'palette'>,
): RenderGraph | null {
  if (!graph) return null
  if ('links' in graph && 'clusters' in graph) return graph
  const filtered = applyControlFilters(graph, props.filters)
  if (filtered.nodes.length === 0) return null
  const options: Parameters<typeof mapCommunityGraph>[1] = {}
  if (props.labelFor) options.labelFor = props.labelFor
  if (props.palette) options.palette = props.palette
  return mapCommunityGraph(filtered, options)
}

const Scene = memo(function Scene({
  graphData,
  width,
  height,
  theme,
  onSelect,
  onOpen,
}: {
  graphData: FG3DData
  width: number
  height: number
  theme: ForceGraph3DTheme
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const anchorRef = useRef<PinnedNode | null>(null)
  const linkColorAcc = useCallback(() => theme.link, [theme.link])

  // Ctrl/⌘-click: pin the node at the centre and reheat the force simulation so
  // the graph re-settles around it live; zoomToFit recentres on engine stop.
  // A plain click selects + opens (no reheat → the camera is retained).
  const handleNodeClick = useCallback(
    (n: NodeObject, event?: MouseEvent) => {
      if (event && (event.ctrlKey || event.metaKey)) {
        const node = n as PinnedNode
        const prev = anchorRef.current
        if (prev && prev !== node) {
          prev.fx = undefined
          prev.fy = undefined
          prev.fz = undefined
        }
        node.fx = 0
        node.fy = 0
        node.fz = 0
        anchorRef.current = node
        fgRef.current?.d3ReheatSimulation()
        return
      }
      const id = (n as FG3DNode).id
      onSelect(id)
      onOpen(id)
    },
    [onSelect, onOpen],
  )

  return (
    <Suspense fallback={null}>
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor={theme.background}
        showNavInfo={false}
        enableNodeDrag={false}
        nodeColor={nodeColorAcc}
        nodeVal={nodeValAcc}
        nodeLabel={nodeLabelAcc}
        nodeRelSize={5}
        nodeResolution={12}
        nodeOpacity={0.95}
        linkColor={linkColorAcc}
        linkOpacity={0.6}
        linkWidth={0.7}
        warmupTicks={60}
        cooldownTicks={140}
        onEngineStop={() => fgRef.current?.zoomToFit(600, 60)}
        onNodeClick={handleNodeClick}
      />
    </Suspense>
  )
})

type Phase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export function ForceGraph3DView({
  graph,
  snapshot,
  filters,
  labelFor,
  palette,
  onSelectNode,
  onOpenNode,
  theme: themeOverride,
  height = '70vh',
  style,
}: ForceGraph3DViewProps) {
  const theme = { ...DEFAULT_THEME, ...themeOverride }
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [phase, setPhase] = useState<Phase>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [data, setData] = useState<RenderGraph | null>(null)

  const onSelectRef = useRef(onSelectNode)
  const onOpenRef = useRef(onOpenNode)
  onSelectRef.current = onSelectNode
  onOpenRef.current = onOpenNode

  // Memoise the mapped RenderGraph on a *stable* signature of the inputs — not
  // the (commonly inline) `filters` object identity. Without this, `rendered` is
  // a fresh object every render, the load effect below re-runs every render and
  // re-inits the 3D scene, so the force simulation restarts from origin and never
  // settles (nodes pile on the root; a drag just paints one unsettled frame) —
  // and the loading→ready setState churn reads as flicker.
  const filtersKey = JSON.stringify(filters ?? null)
  const rendered = useMemo(
    () => toRenderGraph(graph, { filters, labelFor, palette }),
    [graph, filtersKey, palette, labelFor],
  )

  // Size the renderer to its container (react-force-graph defaults to window).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!rendered) {
      setPhase('empty')
      setData(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        setPhase('loading')
        const resolved = (snapshot ? await loadRenderSnapshot(snapshot, { requirePositions: false }) : null) ?? rendered
        if (cancelled) return
        setData(resolved)
        setPhase('ready')
      } catch (e) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e))
          setPhase('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rendered, snapshot])

  // react-force-graph mutates node/link objects (adds x/y/z) — hand it fresh
  // copies once per data load; stable across reader open/close via the memo.
  const graphData = useMemo<FG3DData>(
    () =>
      data
        ? {
            nodes: data.nodes.map((n) => ({ id: n.id, label: n.label, size: n.size, color: n.color })),
            links: data.links.map((l) => ({ source: l.source, target: l.target })),
          }
        : { nodes: [], links: [] },
    [data],
  )

  const handleSelect = useCallback((id: string) => onSelectRef.current?.(id), [])
  const handleOpen = useCallback((id: string) => onOpenRef.current?.(id), [])

  const box: CSSProperties = {
    position: 'relative',
    width: '100%',
    height,
    minHeight: 480,
    border: '1px solid #d8d3c8',
    background: theme.background,
    borderRadius: 2,
    overflow: 'hidden',
    ...style,
  }
  const overlay: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.background,
    color: '#5c5852',
    fontFamily: MONO,
    fontSize: 13,
    padding: 24,
    textAlign: 'center',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: MONO, fontSize: 12, color: '#5c5852' }}>
        {phase === 'ready' && data
          ? `${data.nodes.length} nodes · ${data.links.length} edges · ${data.clusters} clusters — drag to orbit · scroll to zoom · click to open · ⌘/ctrl-click to re-anchor`
          : phase === 'empty'
            ? 'No links to show'
            : 'Graph (3D)'}
      </div>
      <div ref={boxRef} style={box}>
        {phase === 'ready' && size.w > 0 && data && (
          <Scene
            graphData={graphData}
            width={size.w}
            height={size.h}
            theme={theme}
            onSelect={handleSelect}
            onOpen={handleOpen}
          />
        )}
        {(phase === 'idle' || phase === 'loading') && <div style={overlay}>Loading the 3D renderer…</div>}
        {phase === 'error' && <div style={{ ...overlay, color: '#1a1816' }}>Could not build the graph: {errMsg}</div>}
        {phase === 'empty' && <div style={overlay}>No links to show.</div>}
      </div>
    </div>
  )
}
