// EX-15 · custom-canvas-renderer
//
// The graph views (`GraphView`, `SigmaGraphView`, `ForceGraph3DView`) are just
// *one* consumer of `@fortemi/graph`'s data-prep. This example proves you can
// target any surface: it takes a `CommunityGraph`, runs `bakeRenderGraph`
// (layout + community coloring + degree sizing) once, and draws the resulting
// `RenderGraph` to a hand-written `<canvas>` — no built-in view, no framework
// renderer, no database.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  bakeRenderGraph,
  type CommunityPalette,
  type GraphLayoutAlgorithm,
  type RenderGraph,
} from '@fortemi/graph'
import { labelFor, mediumGraph } from '@fortemi/examples-shared'

const WIDTH = 900
const HEIGHT = 560
const ALGORITHMS: GraphLayoutAlgorithm[] = ['force', 'radial', 'community']

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [algorithm, setAlgorithm] = useState<GraphLayoutAlgorithm>('force')
  const [palette, setPalette] = useState<CommunityPalette>('community')
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // Bake positions + colors + sizes once per algorithm/palette change. This is
  // the only @fortemi/graph call the renderer needs — everything below is plain
  // canvas 2D.
  const graph: RenderGraph = useMemo(
    () =>
      bakeRenderGraph(mediumGraph, {
        labelFor,
        palette,
        layout: { algorithm, width: WIDTH, height: HEIGHT, seed: 42, ticks: 320 },
      }),
    [algorithm, palette],
  )

  // Fast id → node lookup for hit-testing and link endpoints.
  const byId = useMemo(() => {
    const m = new Map<string, RenderGraph['nodes'][number]>()
    for (const n of graph.nodes) m.set(n.id, n)
    return m
  }, [graph])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // Links first, under the nodes.
    ctx.lineWidth = 1
    for (const link of graph.links) {
      const s = byId.get(link.source)
      const t = byId.get(link.target)
      if (!s?.x || !t?.x || s.y == null || t.y == null) continue
      const active = hover === s.id || hover === t.id || selected === s.id || selected === t.id
      ctx.strokeStyle = active ? 'rgba(120, 90, 50, .55)' : 'rgba(60, 55, 45, .12)'
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(t.x, t.y)
      ctx.stroke()
    }

    // Nodes.
    for (const node of graph.nodes) {
      if (node.x == null || node.y == null) continue
      const isHover = hover === node.id
      const isSel = selected === node.id
      const r = node.size + (isHover || isSel ? 2 : 0)
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      ctx.globalAlpha = hover && !isHover && !isSel ? 0.35 : 1
      ctx.fill()
      if (isSel) {
        ctx.globalAlpha = 1
        ctx.lineWidth = 2
        ctx.strokeStyle = '#2e2a22'
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // Label larger / focused nodes only, to keep it legible.
      if (node.size > 9 || isHover || isSel) {
        ctx.fillStyle = '#3f382d'
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
        ctx.fillText(node.label, node.x + r + 3, node.y + 4)
      }
    }
  }, [graph, byId, hover, selected])

  // Nearest-node hit test in canvas space.
  const pick = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * WIDTH
    const y = ((clientY - rect.top) / rect.height) * HEIGHT
    let best: string | null = null
    let bestDist = Infinity
    for (const node of graph.nodes) {
      if (node.x == null || node.y == null) continue
      const d = Math.hypot(node.x - x, node.y - y)
      if (d <= node.size + 4 && d < bestDist) {
        bestDist = d
        best = node.id
      }
    }
    return best
  }

  const selectedNode = selected ? byId.get(selected) : null

  return (
    <main className="page">
      <header>
        <h1>EX-15 · custom-canvas-renderer</h1>
        <p className="lede">
          A graph rendered to a hand-written <code>&lt;canvas&gt;</code> — no built-in view. One call
          to <code>bakeRenderGraph</code> produces layout + community colors + degree-based sizes; the
          rest is plain 2D drawing plus hover/click hit-testing. The data-prep layer feeds any
          surface. No database.
        </p>
      </header>

      <div className="controls">
        <div className="control">
          <span>Layout</span>
          <div className="row">
            {ALGORITHMS.map((a) => (
              <button
                key={a}
                className={a === algorithm ? '' : 'ghost'}
                onClick={() => setAlgorithm(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <span>Palette</span>
          <div className="row">
            {(['community', 'greyscale'] as const).map((p) => (
              <button key={p} className={p === palette ? '' : 'ghost'} onClick={() => setPalette(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas"
        style={{ width: WIDTH, height: HEIGHT, maxWidth: '100%' }}
        onMouseMove={(e) => setHover(pick(e.clientX, e.clientY))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setSelected(pick(e.clientX, e.clientY))}
      />

      <p className="selected">
        {selectedNode
          ? `Selected: ${selectedNode.label} · community rank ${selectedNode.communityRank}`
          : hover
            ? `Hover: ${byId.get(hover)?.label}`
            : 'Hover a node to highlight its edges; click to select.'}
      </p>
    </main>
  )
}
