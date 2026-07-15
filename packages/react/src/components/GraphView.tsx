import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { CommunityGraph } from '@fortemi/core'
import {
  applyControlFilters,
  colorForCommunity,
  layoutCommunityGraph,
} from '@fortemi/graph'
import type { GraphControlFilters, GraphLayoutState, LayoutOptions } from '@fortemi/graph'
import { clientToGraphPoint } from './graph-view-geometry.js'

/**
 * Filter shape for `GraphView`. Alias of the shared `GraphControlFilters`
 * contract (#260) so the React tier and the JS-only renderer filter identically
 * (community / edge-kind / node allow-list / min-degree).
 */
export type GraphViewFilters = GraphControlFilters

export interface GraphViewProps {
  graph: CommunityGraph | null
  layout?: Partial<GraphLayoutState>
  filters?: GraphViewFilters
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
  /** Navigation callback (double-click / Enter on a selected node). */
  onNavigate?: (nodeId: string) => void
  /** Human label for a node (title / a11y). Default: the node id. */
  labelFor?: (nodeId: string) => string
  /**
   * Opt-in node dragging (issue #245). When true, a node can be dragged to a new
   * position; on release it is *pinned* and the rest of the graph re-settles
   * around it (an incremental re-layout). Pins persist across layout updates.
   * Shift-click a pinned node to release its pin. Default `false` — existing
   * click-to-select behavior is unchanged.
   */
  draggableNodes?: boolean
  width?: number
  height?: number
  style?: CSSProperties
}

export function GraphView({
  graph,
  layout,
  filters,
  selectedNodeId,
  onSelectNode,
  onNavigate,
  labelFor,
  draggableNodes = false,
  width = 760,
  height = 460,
  style,
}: GraphViewProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // Committed drag pins (issue #245) and the in-flight drag position.
  const [pins, setPins] = useState<Map<string, { x: number; y: number }>>(() => new Map())
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const algorithm = layout?.algorithm ?? 'force'
  const label = labelFor ?? ((id: string) => id)
  // Key on a stable signature of `filters`, not its object identity — callers
  // commonly pass an inline `filters={{…}}`, which is a fresh object every render
  // and would otherwise re-run the force layout (and re-seed positions) on every
  // render, jittering the graph.
  const filtersKey = JSON.stringify(filters ?? null)
  const visible = useMemo(() => applyControlFilters(graph, filters), [graph, filtersKey])
  const positioned = useMemo(() => {
    const opts: LayoutOptions = { algorithm, width, height }
    // Only feed pins/warm-start once something is pinned, so the default path is
    // bit-identical to the pre-#245 layout.
    if (pins.size > 0) {
      opts.pinned = pins
      opts.initialPositions = positionsRef.current
    }
    return layoutCommunityGraph(visible, opts)
  }, [visible, algorithm, width, height, pins])

  // Remember the latest positions so the next re-layout (after a new pin) can
  // warm-start from them rather than re-seeding.
  positionsRef.current = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const node of positioned.nodes) map.set(node.id, { x: node.x, y: node.y })
    return map
  }, [positioned])

  function clientToGraph(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    return clientToGraphPoint(svg.getBoundingClientRect(), { width, height, scale, offset }, clientX, clientY)
  }

  function handleNodePointerDown(event: ReactPointerEvent, nodeId: string) {
    if (!draggableNodes) return
    // Shift-click releases an existing pin instead of starting a drag.
    if (event.shiftKey && pins.has(nodeId)) {
      event.preventDefault()
      event.stopPropagation()
      setPins((prev) => {
        const next = new Map(prev)
        next.delete(nodeId)
        return next
      })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    setDrag({ id: nodeId, ...clientToGraph(event.clientX, event.clientY) })
  }

  function handlePointerMove(event: ReactPointerEvent) {
    if (!drag) return
    setDrag({ id: drag.id, ...clientToGraph(event.clientX, event.clientY) })
  }

  function endDrag() {
    if (!drag) return
    const { id, x, y } = drag
    setPins((prev) => new Map(prev).set(id, { x, y }))
    setDrag(null)
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--fortemi-graph-rule, #ddd)',
          borderRadius: 6,
          padding: 16,
          color: 'var(--fortemi-graph-muted, #666)',
          ...style,
        }}
      >
        No graph data
      </div>
    )
  }

  const zoom = (delta: number) => setScale((current) => Math.min(2.5, Math.max(0.5, current + delta)))
  const pan = (dx: number, dy: number) => setOffset((current) => ({ x: current.x + dx, y: current.y + dy }))

  // Effective position for a node, honoring an in-flight drag.
  const posFor = (nodeId: string, fallback: { x: number; y: number }) =>
    drag && drag.id === nodeId ? { x: drag.x, y: drag.y } : fallback

  return (
    <div
      style={{
        border: '1px solid var(--fortemi-graph-rule, #ddd)',
        borderRadius: 6,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          padding: 8,
          borderBottom: '1px solid var(--fortemi-graph-rule-soft, #eee)',
        }}
      >
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-0.15)}>-</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(0.15)}>+</button>
        <button type="button" aria-label="Pan left" onClick={() => pan(-24, 0)}>←</button>
        <button type="button" aria-label="Pan right" onClick={() => pan(24, 0)}>→</button>
        <button type="button" aria-label="Pan up" onClick={() => pan(0, -24)}>↑</button>
        <button type="button" aria-label="Pan down" onClick={() => pan(0, 24)}>↓</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fortemi-graph-muted, #666)' }}>
          {positioned.nodes.length} nodes · {positioned.edges.length} edges
        </span>
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Community graph"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{
          display: 'block',
          aspectRatio: `${width} / ${height}`,
          background: 'var(--fortemi-graph-bg, #fafafa)',
        }}
        onPointerMove={draggableNodes ? handlePointerMove : undefined}
        onPointerUp={draggableNodes ? endDrag : undefined}
        onPointerLeave={draggableNodes ? endDrag : undefined}
      >
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {positioned.edges.map((edge) => {
            const source = positioned.nodeIndex.get(edge.source)
            const target = positioned.nodeIndex.get(edge.target)
            if (!source || !target) return null
            const sp = posFor(edge.source, source)
            const tp = posFor(edge.target, target)
            return (
              <line
                key={`${edge.source}:${edge.target}:${edge.kind ?? 'edge'}`}
                x1={sp.x}
                y1={sp.y}
                x2={tp.x}
                y2={tp.y}
                strokeWidth={Math.max(1, Math.min(5, edge.weight))}
                opacity={0.55}
                // Presentation attributes don't accept var(); set color via style.
                style={{ stroke: 'var(--fortemi-graph-edge, #9aa0a6)' }}
              />
            )
          })}
          {positioned.nodes.map((node) => {
            const selected = node.id === selectedNodeId
            const pinned = pins.has(node.id)
            const dragging = drag?.id === node.id
            const color = colorForCommunity(node.communityId)
            const radius = node.r
            const p = posFor(node.id, node)
            return (
              <g key={node.id} transform={`translate(${p.x} ${p.y})`}>
                <circle
                  r={selected ? radius + 3 : radius}
                  fill={color}
                  strokeWidth={selected ? 3 : pinned ? 2.5 : 1.5}
                  strokeDasharray={pinned && !selected ? '3 2' : undefined}
                  tabIndex={0}
                  role="button"
                  data-node-id={node.id}
                  data-pinned={pinned ? 'true' : undefined}
                  aria-label={`Graph node ${label(node.id)}${pinned ? ' (pinned)' : ''}`}
                  onPointerDown={draggableNodes ? (event) => handleNodePointerDown(event, node.id) : undefined}
                  onClick={() => { if (!dragging) onSelectNode?.(node.id) }}
                  onDoubleClick={() => onNavigate?.(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (selected) onNavigate?.(node.id)
                      else onSelectNode?.(node.id)
                    }
                  }}
                  style={{
                    cursor: draggableNodes ? (dragging ? 'grabbing' : 'grab') : onSelectNode || onNavigate ? 'pointer' : 'default',
                    outline: 'none',
                    // Presentation attributes don't accept var(); set stroke via style so
                    // the ring themes with the ambient --fortemi-graph-* variables.
                    stroke:
                      pinned || selected
                        ? 'var(--fortemi-graph-node-strong, #111)'
                        : 'var(--fortemi-graph-node-stroke, #fff)',
                  }}
                />
                <title>{label(node.id)}</title>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
