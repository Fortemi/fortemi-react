// Interactive 2D graph explorer backed by Sigma + graphology ForceAtlas2
// (issue #263). A heavier renderer tier alongside the static SVG `GraphView`.
//
// graphology / sigma / graphology-layout-forceatlas2 are OPTIONAL peer deps,
// loaded LAZILY via dynamic import() inside the mount effect — the type-only
// imports below are erased, so this module carries no static runtime coupling
// and the heavy renderer only ships when a consumer actually mounts it (reach
// it via the `@fortemi/react/graph-2d` subpath). Data is a `RenderGraph` from
// `@fortemi/graph` (#264) — pass one directly, or a `CommunityGraph` we map for
// you, optionally warm-started from a baked-position snapshot.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CommunityGraph } from '@fortemi/core'
import {
  applyControlFilters,
  mapCommunityGraph,
  loadRenderSnapshot,
  type RenderGraph,
  type GraphControlFilters,
  type CommunityPalette,
} from '@fortemi/graph'
import type GraphologyGraph from 'graphology'
import type SigmaRenderer from 'sigma'
import type FA2LayoutType from 'graphology-layout-forceatlas2/worker'

/** Colors for the Sigma view. Sigma needs concrete colors, not CSS vars. */
export interface SigmaTheme {
  /** Default (unfocused) node ink. */
  node: string
  /** Focused/anchor node ink. */
  ink: string
  /** Default edge. */
  edge: string
  /** Dimmed (non-neighbor) node. */
  dimNode: string
  /** Dimmed (non-incident) edge. */
  dimEdge: string
  /** Label color. */
  label: string
  /** Label font. */
  labelFont: string
}

const DEFAULT_THEME: SigmaTheme = {
  node: '#5C5852',
  ink: '#1A1816',
  edge: '#E4E0D6',
  dimNode: '#E2DDD3',
  dimEdge: '#EFECE4',
  label: '#1A1816',
  labelFont: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
}

export interface SigmaGraphViewProps {
  /** A ready `RenderGraph`, or a `CommunityGraph` mapped via `mapCommunityGraph`. */
  graph: CommunityGraph | RenderGraph | null
  /** Warm-start from a baked-position snapshot (URL or object) before falling back to a live settle. */
  snapshot?: string | RenderGraph
  /** Shared control-contract filters (#260); applied when `graph` is a `CommunityGraph`. */
  filters?: GraphControlFilters
  /** Label resolver / palette used when mapping a `CommunityGraph`. */
  labelFor?: (id: string) => string
  palette?: CommunityPalette
  /** Node click (select). Ctrl/⌘-click re-anchors instead. */
  onSelectNode?: (nodeId: string) => void
  /** Node double-click (open). */
  onOpenNode?: (nodeId: string) => void
  /** ForceAtlas2 settle duration in ms (cold start). Warm start uses ~half. Default derived from size. */
  settleMs?: number
  theme?: Partial<SigmaTheme>
  height?: number | string
  style?: CSSProperties
}

type Phase = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

function toRenderGraph(
  graph: CommunityGraph | RenderGraph | null,
  props: Pick<SigmaGraphViewProps, 'filters' | 'labelFor' | 'palette'>,
): RenderGraph | null {
  if (!graph) return null
  if ('links' in graph && 'clusters' in graph) return graph // already a RenderGraph
  const filtered = applyControlFilters(graph, props.filters)
  if (filtered.nodes.length === 0) return null
  const options: Parameters<typeof mapCommunityGraph>[1] = {}
  if (props.labelFor) options.labelFor = props.labelFor
  if (props.palette) options.palette = props.palette
  return mapCommunityGraph(filtered, options)
}

export function SigmaGraphView({
  graph,
  snapshot,
  filters,
  labelFor,
  palette,
  onSelectNode,
  onOpenNode,
  settleMs,
  theme: themeOverride,
  height = '70vh',
  style,
}: SigmaGraphViewProps) {
  const theme = { ...DEFAULT_THEME, ...themeOverride }
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<SigmaRenderer | null>(null)
  const layoutRef = useRef<FA2LayoutType | null>(null)
  const graphRef = useRef<GraphologyGraph | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const anchorRef = useRef<string | null>(null)
  const neighborsRef = useRef<Set<string>>(new Set())

  const [phase, setPhase] = useState<Phase>('idle')
  const [settling, setSettling] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [stats, setStats] = useState({ nodes: 0, edges: 0, clusters: 0 })

  // Callbacks/derived data are read through refs so the heavy renderer is built
  // once per graph identity, not re-created on every prop change.
  const onSelectRef = useRef(onSelectNode)
  const onOpenRef = useRef(onOpenNode)
  onSelectRef.current = onSelectNode
  onOpenRef.current = onOpenNode

  // Memoise the mapped RenderGraph on a *stable* signature of the inputs — not
  // the (commonly inline) `filters` object identity. Without this, `rendered` is
  // a fresh object every render, the rebuild effect below re-runs on every render,
  // and its own setState calls (loading → ready) re-trigger it: an infinite
  // re-init loop that reads on screen as flicker.
  const filtersKey = JSON.stringify(filters ?? null)
  const rendered = useMemo(
    () => toRenderGraph(graph, { filters, labelFor, palette }),
    [graph, filtersKey, palette, labelFor],
  )

  useEffect(() => {
    if (!rendered) {
      setPhase('empty')
      return
    }
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    void (async () => {
      try {
        setPhase('loading')
        // Warm-start data: a baked snapshot wins; else the mapped graph.
        const data =
          (snapshot ? await loadRenderSnapshot(snapshot) : null) ?? rendered
        if (cancelled) return

        const [{ default: GraphCtor }, { default: SigmaCtor }, fa2, { default: FA2Ctor }] =
          await Promise.all([
            import('graphology'),
            import('sigma'),
            import('graphology-layout-forceatlas2'),
            import('graphology-layout-forceatlas2/worker'),
          ])
        if (cancelled || !containerRef.current) return
        const forceAtlas2 = fa2.default

        const positioned = data.nodes.some((n) => typeof n.x === 'number' && typeof n.y === 'number')
        const g: GraphologyGraph = new GraphCtor({ multi: false, type: 'undirected' })
        for (const n of data.nodes) {
          g.addNode(n.id, {
            label: n.label,
            size: n.size,
            color: n.color,
            baseColor: n.color,
            x: n.x ?? Math.random() * 2 - 1,
            y: n.y ?? Math.random() * 2 - 1,
          })
        }
        for (const l of data.links) {
          if (g.hasNode(l.source) && g.hasNode(l.target) && !g.hasEdge(l.source, l.target)) {
            g.addEdge(l.source, l.target, { size: 0.6, color: theme.edge })
          }
        }
        setStats({ nodes: g.order, edges: g.size, clusters: data.clusters })
        graphRef.current = g

        sigmaRef.current?.kill()
        const renderer: SigmaRenderer = new SigmaCtor(g, containerRef.current, {
          renderLabels: true,
          labelColor: { color: theme.label },
          labelSize: 11,
          labelFont: theme.labelFont,
          labelDensity: 0.7,
          labelGridCellSize: 70,
          // Labels suppressed by default; the reducer force-labels only the
          // anchor + hovered/focused node and its neighbors (LOD decluttering).
          labelRenderedSizeThreshold: 10000,
          defaultNodeColor: theme.node,
          defaultEdgeColor: theme.edge,
          minCameraRatio: 0.05,
          maxCameraRatio: 2.5,
          nodeReducer: (node: string, attrs: Record<string, unknown>) => {
            const base = (attrs.baseColor as string) ?? (attrs.color as string)
            const focus = hoveredRef.current ?? selectedRef.current
            if (focus) {
              if (node === focus) return { ...attrs, color: theme.ink, zIndex: 2, forceLabel: true }
              if (neighborsRef.current.has(node)) return { ...attrs, color: theme.node, zIndex: 1, forceLabel: true }
              return { ...attrs, color: theme.dimNode, label: '', zIndex: 0 }
            }
            if (node === anchorRef.current) return { ...attrs, color: theme.ink, zIndex: 1, forceLabel: true }
            return { ...attrs, color: base }
          },
          edgeReducer: (edge: string, attrs: Record<string, unknown>) => {
            const focus = hoveredRef.current ?? selectedRef.current
            const gg = graphRef.current
            if (!focus || !gg) return attrs
            const [s, t] = gg.extremities(edge)
            if (s === focus || t === focus) return { ...attrs, color: theme.node, size: 1.1, zIndex: 1 }
            return { ...attrs, color: theme.dimEdge, zIndex: 0 }
          },
        })

        const recomputeNeighbors = (node: string) => {
          const ns = new Set<string>()
          g.forEachNeighbor(node, (nb: string) => ns.add(nb))
          neighborsRef.current = ns
        }
        const focusCamera = (node: string) => {
          const pos = renderer.getNodeDisplayData(node)
          if (!pos) return
          renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.45 }, { duration: 600 })
        }
        const layoutSettings = () => ({
          ...forceAtlas2.inferSettings(g),
          linLogMode: true,
          outboundAttractionDistribution: true,
          adjustSizes: false,
          gravity: 1,
        })

        // Ctrl/⌘-click: pin the node at the layout centre and re-run the force
        // layout so the graph re-settles around it, then re-fit.
        const reanchor = (node: string) => {
          const prev = anchorRef.current
          if (prev && prev !== node && g.hasNode(prev)) g.removeNodeAttribute(prev, 'fixed')
          g.setNodeAttribute(node, 'x', 0)
          g.setNodeAttribute(node, 'y', 0)
          g.setNodeAttribute(node, 'fixed', true)
          anchorRef.current = node
          selectedRef.current = null
          hoveredRef.current = null
          neighborsRef.current = new Set()
          layoutRef.current?.kill()
          const re = new FA2Ctor(g, { settings: layoutSettings() })
          layoutRef.current = re
          setSettling(true)
          re.start()
          timers.push(
            setTimeout(() => {
              if (cancelled) return
              re.stop()
              layoutRef.current = null
              setSettling(false)
              renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 600 })
              renderer.refresh()
            }, 4500),
          )
        }

        renderer.on('enterNode', ({ node }) => {
          hoveredRef.current = node
          recomputeNeighbors(node)
          renderer.refresh()
          if (containerRef.current) containerRef.current.style.cursor = 'pointer'
        })
        renderer.on('leaveNode', () => {
          hoveredRef.current = null
          if (selectedRef.current) recomputeNeighbors(selectedRef.current)
          else neighborsRef.current = new Set()
          renderer.refresh()
          if (containerRef.current) containerRef.current.style.cursor = 'default'
        })
        renderer.on('clickNode', ({ node, event }) => {
          const native = (event as { original?: MouseEvent }).original
          if (native && (native.ctrlKey || native.metaKey)) {
            reanchor(node)
            return
          }
          selectedRef.current = node
          recomputeNeighbors(node)
          focusCamera(node)
          renderer.refresh()
          onSelectRef.current?.(node)
        })
        renderer.on('doubleClickNode', ({ node, event }) => {
          event.preventSigmaDefault()
          onOpenRef.current?.(node)
        })
        renderer.on('clickStage', () => {
          selectedRef.current = null
          neighborsRef.current = new Set()
          renderer.refresh()
        })

        sigmaRef.current = renderer
        setPhase('ready')

        // Soft-anchor the highest-degree hub as a default focal point.
        const setAnchor = () => {
          let anchor: string | null = null
          let best = -1
          g.forEachNode((n: string) => {
            const d = g.degree(n)
            if (d > best) {
              best = d
              anchor = n
            }
          })
          anchorRef.current = anchor
        }

        // Always settle on open — a static snapshot reads as a locked hairball.
        // Warm (baked) positions converge fast; a cold graph is seeded random.
        const layout = new FA2Ctor(g, { settings: layoutSettings() })
        layoutRef.current = layout
        setSettling(true)
        layout.start()
        const runMs = settleMs ?? (positioned ? 4000 : Math.min(9000, 3500 + g.order * 9))
        timers.push(
          setTimeout(() => {
            if (cancelled) return
            layout.stop()
            layoutRef.current = null
            setSettling(false)
            setAnchor()
            renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 500 })
            renderer.refresh()
          }, runMs),
        )
      } catch (e) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e))
          setPhase('error')
        }
      }
    })()

    return () => {
      cancelled = true
      for (const t of timers) clearTimeout(t)
      layoutRef.current?.kill()
      layoutRef.current = null
      sigmaRef.current?.kill()
      sigmaRef.current = null
      graphRef.current = null
    }
    // Rebuild only when the graph identity or key inputs change; callbacks are
    // read through refs so they don't force a costly renderer rebuild.
  }, [rendered, snapshot, settleMs])

  const box: CSSProperties = {
    position: 'relative',
    width: '100%',
    height,
    minHeight: 480,
    border: '1px solid #d8d3c8',
    background: '#fbfaf7',
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
    background: '#fbfaf7',
    color: theme.node,
    fontFamily: theme.labelFont,
    fontSize: 13,
    padding: 24,
    textAlign: 'center',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: theme.labelFont, fontSize: 12, color: theme.node }}>
        {phase === 'ready'
          ? `${stats.nodes} nodes · ${stats.edges} edges · ${stats.clusters} clusters` +
            (settling ? ' — settling…' : ' — click to focus · ⌘/ctrl-click to re-anchor · double-click to open')
          : phase === 'empty'
            ? 'No links to show'
            : 'Graph'}
      </div>
      <div style={box}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {(phase === 'idle' || phase === 'loading') && <div style={overlay}>Loading the graph…</div>}
        {phase === 'error' && <div style={{ ...overlay, color: theme.ink }}>Could not build the graph: {errMsg}</div>}
        {phase === 'empty' && <div style={overlay}>No links to show.</div>}
      </div>
    </div>
  )
}
