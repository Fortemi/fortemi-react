// EX-05 · snapshot-baking
//
// Build-time layout vs runtime layout. A Node script (scripts/bake.mjs) lays the
// graph out once with `bakeRenderGraph` and writes a snapshot with baked x/y.
// Here we `loadRenderSnapshot` that file and render the coordinates directly —
// there is NO layout pass at runtime, so the graph appears instantly regardless
// of size. `loadRenderSnapshot` returns `null` (never throws) if the snapshot is
// missing or lacks positions, so a real app can fall back to a live build.

import { useEffect, useState } from 'react'
import { ThemeToggle } from '@fortemi/examples-shared/ui'
import { loadRenderSnapshot } from '@fortemi/graph'
import type { RenderGraph } from '@fortemi/graph'

const VIEW_W = 720
const VIEW_H = 460
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}graph-snapshot.json`

export function App() {
  const [graph, setGraph] = useState<RenderGraph | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let alive = true
    loadRenderSnapshot(SNAPSHOT_URL).then((rg) => {
      if (!alive) return
      if (rg) {
        setGraph(rg)
        setStatus('ready')
      } else {
        setStatus('missing')
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const index = graph ? new Map(graph.nodes.map((n) => [n.id, n])) : new Map()

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-05 · snapshot-baking</h1>
        <p className="lede">
          The layout was computed at <strong>build time</strong> by <code>bakeRenderGraph</code> and
          written to <code>public/graph-snapshot.json</code>. This page loads it with{' '}
          <code>loadRenderSnapshot</code> and draws the baked coordinates directly — no runtime
          layout, instant render.
        </p>
      </header>

      {status === 'missing' && (
        <p className="selected">
          No snapshot found. Run <code>pnpm bake</code> (or <code>pnpm dev</code>, which bakes first).
        </p>
      )}

      {graph && (
        <div className="canvas">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            width="100%"
            role="img"
            aria-label="Baked community graph"
            style={{ display: 'block' }}
          >
            {graph.links.map((link, i) => {
              const s = index.get(link.source)
              const t = index.get(link.target)
              if (!s || s.x == null || !t || t.x == null) return null
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="#b8ad9a"
                  strokeOpacity={0.4 + Math.min(link.weight, 4) * 0.12}
                  strokeWidth={0.6 + Math.min(link.weight, 4) * 0.3}
                />
              )
            })}
            {graph.nodes.map((n) =>
              n.x == null ? null : (
                <circle key={n.id} cx={n.x} cy={n.y} r={n.size} fill={n.color}>
                  <title>{n.label}</title>
                </circle>
              ),
            )}
          </svg>
        </div>
      )}

      <footer style={{ marginTop: '1rem', color: '#968c7c', fontSize: '.8rem' }}>
        {graph
          ? `${graph.nodes.length} nodes · ${graph.links.length} links · ${graph.clusters} clusters — rendered from baked positions.`
          : status === 'loading'
            ? 'Loading snapshot…'
            : ''}
      </footer>
    </main>
  )
}
