import { useMemo, useState, type CSSProperties } from 'react'
import type { CommunityGraph, GraphNode } from '@fortemi/core'
import type { GraphLayoutState } from '../hooks/useGraphController.js'

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

interface PositionedNode extends GraphNode {
  x: number
  y: number
  degree: number
  communityId?: string
}

const COMMUNITY_COLORS = [
  '#2f6fbb',
  '#d97706',
  '#218838',
  '#7c3aed',
  '#c2410c',
  '#0f766e',
  '#be185d',
  '#4b5563',
]

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
  const visible = useMemo(() => filterGraph(graph, filters), [graph, filters])
  const positioned = useMemo(() => layoutGraph(visible, algorithm, width, height), [visible, algorithm, width, height])

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
            const source = positioned.nodeMap.get(edge.source)
            const target = positioned.nodeMap.get(edge.target)
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
            const radius = Math.max(5, Math.min(16, 5 + node.degree * 1.5))
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

function filterGraph(graph: CommunityGraph | null, filters?: GraphViewFilters): CommunityGraph {
  if (!graph) return { nodes: [], edges: [], communities: [] }
  const nodeIds = new Set(filters?.nodeIds ?? graph.nodes.map((node) => node.id))
  if (filters?.communityIds?.length) {
    const allowedCommunities = new Set(filters.communityIds)
    nodeIds.clear()
    for (const community of graph.communities) {
      if (allowedCommunities.has(community.id)) {
        for (const nodeId of community.nodes) nodeIds.add(nodeId)
      }
    }
  }
  const edgeKinds = filters?.edgeKinds ? new Set(filters.edgeKinds) : null
  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id))
  const edges = graph.edges.filter((edge) => (
    nodeIds.has(edge.source)
    && nodeIds.has(edge.target)
    && (!edgeKinds || edgeKinds.has(edge.kind ?? ''))
  ))
  const communities = graph.communities
    .map((community) => ({ ...community, nodes: community.nodes.filter((nodeId) => nodeIds.has(nodeId)) }))
    .filter((community) => community.nodes.length > 0)
  return { nodes, edges, communities }
}

function layoutGraph(graph: CommunityGraph, algorithm: GraphLayoutState['algorithm'], width: number, height: number) {
  const degree = new Map<string, number>()
  for (const node of graph.nodes) degree.set(node.id, 0)
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  const communityByNode = new Map<string, string>()
  for (const community of graph.communities) {
    for (const nodeId of community.nodes) {
      if (!communityByNode.has(nodeId)) communityByNode.set(nodeId, community.id)
    }
  }

  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.max(40, Math.min(width, height) * 0.38)
  const nodes = graph.nodes.map((node, index): PositionedNode => {
    const angle = (Math.PI * 2 * index) / Math.max(1, graph.nodes.length)
    const communityIndex = graph.communities.findIndex((community) => community.id === communityByNode.get(node.id))
    const communityAngle = (Math.PI * 2 * Math.max(0, communityIndex)) / Math.max(1, graph.communities.length)
    const communityRadius = algorithm === 'community' ? radius * 0.55 : radius
    const localRadius = algorithm === 'force' ? radius * (0.7 + ((degree.get(node.id) ?? 0) % 4) * 0.08) : radius
    const x = algorithm === 'community'
      ? centerX + Math.cos(communityAngle) * communityRadius + Math.cos(angle) * 46
      : centerX + Math.cos(angle) * localRadius
    const y = algorithm === 'community'
      ? centerY + Math.sin(communityAngle) * communityRadius + Math.sin(angle) * 46
      : centerY + Math.sin(angle) * (algorithm === 'radial' ? radius : localRadius * 0.72)
    return {
      ...node,
      x,
      y,
      degree: degree.get(node.id) ?? 0,
      communityId: communityByNode.get(node.id),
    }
  })

  return {
    nodes,
    edges: graph.edges,
    nodeMap: new Map(nodes.map((node) => [node.id, node])),
  }
}

function colorForCommunity(communityId: string | undefined): string {
  if (!communityId) return '#64748b'
  let hash = 0
  for (const char of communityId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COMMUNITY_COLORS[Math.abs(hash) % COMMUNITY_COLORS.length]
}
