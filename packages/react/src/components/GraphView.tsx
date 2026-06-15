import { useMemo, useState, type CSSProperties } from 'react'
import type { CommunityGraph } from '@fortemi/core'
import {
  colorForCommunity,
  filterCommunityGraph,
  layoutCommunityGraph,
  nodeRadius,
} from '@fortemi/graph'
import type { GraphLayoutState } from '@fortemi/graph'

export interface GraphViewFilters {
  communityIds?: string[]
  edgeKinds?: string[]
  nodeIds?: string[]
}

export interface GraphViewProps {
  graph: CommunityGraph | null
  layout?: Partial<GraphLayoutState>
  filters?: GraphViewFilters
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
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
  width = 760,
  height = 460,
  style,
}: GraphViewProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const algorithm = layout?.algorithm ?? 'force'
  const visible = useMemo(() => filterCommunityGraph(graph, filters), [graph, filters])
  const positioned = useMemo(
    () => layoutCommunityGraph(visible, { algorithm, width, height }),
    [visible, algorithm, width, height],
  )

  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, color: '#666', ...style }}>
        No graph data
      </div>
    )
  }

  const zoom = (delta: number) => setScale((current) => Math.min(2.5, Math.max(0.5, current + delta)))
  const pan = (dx: number, dy: number) => setOffset((current) => ({ x: current.x + dx, y: current.y + dy }))

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', ...style }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 8, borderBottom: '1px solid #eee' }}>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(-0.15)}>-</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(0.15)}>+</button>
        <button type="button" aria-label="Pan left" onClick={() => pan(-24, 0)}>←</button>
        <button type="button" aria-label="Pan right" onClick={() => pan(24, 0)}>→</button>
        <button type="button" aria-label="Pan up" onClick={() => pan(0, -24)}>↑</button>
        <button type="button" aria-label="Pan down" onClick={() => pan(0, 24)}>↓</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
          {positioned.nodes.length} nodes · {positioned.edges.length} edges
        </span>
      </div>
      <svg
        role="img"
        aria-label="Community graph"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: 'block', aspectRatio: `${width} / ${height}`, background: '#fafafa' }}
      >
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {positioned.edges.map((edge) => {
            const source = positioned.nodeIndex.get(edge.source)
            const target = positioned.nodeIndex.get(edge.target)
            if (!source || !target) return null
            return (
              <line
                key={`${edge.source}:${edge.target}:${edge.kind ?? 'edge'}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="#9aa0a6"
                strokeWidth={Math.max(1, Math.min(5, edge.weight))}
                opacity={0.55}
              />
            )
          })}
          {positioned.nodes.map((node) => {
            const selected = node.id === selectedNodeId
            const color = colorForCommunity(node.communityId)
            const radius = nodeRadius(node.degree)
            return (
              <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                <circle
                  r={selected ? radius + 3 : radius}
                  fill={color}
                  stroke={selected ? '#111' : '#fff'}
                  strokeWidth={selected ? 3 : 1.5}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select graph node ${node.id}`}
                  onClick={() => onSelectNode?.(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectNode?.(node.id)
                  }}
                  style={{ cursor: onSelectNode ? 'pointer' : 'default', outline: 'none' }}
                />
                <title>{node.id}</title>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
