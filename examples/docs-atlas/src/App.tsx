// EX-17 · docs-atlas
//
// A deployable, PGlite-free knowledge map. A build step (scripts/build-atlas.mjs)
// reads the markdown corpus, derives a tag-similarity CommunityGraph, and BAKES
// the layout with `bakeRenderGraph` into public/atlas-snapshot.json plus a
// public/atlas-docs.json reader payload. This page fetches both, renders the
// baked coordinates directly (no runtime layout), and opens a doc when you click
// a node — the docs.fortemi.com pattern, generalized to any static host.

import { useEffect, useMemo, useState } from 'react'
import { loadRenderSnapshot } from '@fortemi/graph'
import type { RenderGraph } from '@fortemi/graph'

interface Doc { id: string; title: string; tags: string[]; html: string }

const VIEW_W = 760
const VIEW_H = 520
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}atlas-snapshot.json`
const DOCS_URL = `${import.meta.env.BASE_URL}atlas-docs.json`

export function App() {
  const [graph, setGraph] = useState<RenderGraph | null>(null)
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let alive = true
    Promise.all([
      loadRenderSnapshot(SNAPSHOT_URL),
      fetch(DOCS_URL).then((r) => (r.ok ? (r.json() as Promise<Doc[]>) : null)).catch(() => null),
    ]).then(([rg, ds]) => {
      if (!alive) return
      if (rg && ds) {
        setGraph(rg)
        setDocs(ds)
        setSelected(ds[0]?.id ?? null)
        setStatus('ready')
      } else {
        setStatus('missing')
      }
    })
    return () => { alive = false }
  }, [])

  const nodeById = useMemo(
    () => (graph ? new Map(graph.nodes.map((n) => [n.id, n])) : new Map()),
    [graph],
  )
  const docById = useMemo(
    () => (docs ? new Map(docs.map((d) => [d.id, d])) : new Map<string, Doc>()),
    [docs],
  )
  const doc = selected ? docById.get(selected) : null

  // Legend: each community's first-tag mapped to the baked node color.
  const legend = useMemo(() => {
    if (!graph || !docs) return [] as { tag: string; color: string }[]
    const colorByNode = new Map(graph.nodes.map((n) => [n.id, n.color]))
    const seen = new Map<string, string>()
    for (const d of docs) {
      const tag = d.tags[0] ?? 'untagged'
      if (!seen.has(tag)) seen.set(tag, colorByNode.get(d.id) ?? '#888')
    }
    return [...seen.entries()].map(([tag, color]) => ({ tag, color }))
  }, [graph, docs])

  // Clicking an internal [link](doc-id) in the reader navigates instead of scrolling.
  const onReaderClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-doc]')
    if (!a) return
    const id = a.getAttribute('data-doc')
    if (id && docById.has(id)) { e.preventDefault(); setSelected(id) }
  }

  return (
    <main className="page wide">
      <header>
        <h1>EX-17 · docs-atlas</h1>
        <p className="lede">
          A markdown corpus, baked at <strong>build time</strong> into a graph snapshot with{' '}
          <code>bakeRenderGraph</code>. This page loads it with <code>loadRenderSnapshot</code> and
          renders the baked coordinates directly — no runtime layout, no database, no downloads.
          Deployable to any static host.
        </p>
      </header>

      {status === 'missing' && (
        <p className="selected">
          No atlas found. Run <code>pnpm atlas</code> (or <code>pnpm dev</code>, which bakes first).
        </p>
      )}

      {graph && docs && (
        <section className="atlas">
          <aside className="rail">
            <h2>Docs</h2>
            <ul className="doc-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    className={`doc-pick${selected === d.id ? ' active' : ''}`}
                    onClick={() => setSelected(d.id)}
                  >
                    {d.title}
                  </button>
                </li>
              ))}
            </ul>
            <div className="legend">
              {legend.map(({ tag, color }) => (
                <span key={tag} className="legend-item">
                  <span className="dot" style={{ background: color }} /> {tag}
                </span>
              ))}
            </div>
          </aside>

          <div className="canvas">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              width="100%"
              role="img"
              aria-label="Documentation atlas graph"
              style={{ display: 'block' }}
            >
              {graph.links.map((link, i) => {
                const s = nodeById.get(link.source)
                const t = nodeById.get(link.target)
                if (!s || s.x == null || !t || t.x == null) return null
                return (
                  <line
                    key={i}
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    stroke="#5b6472"
                    strokeOpacity={0.35 + Math.min(link.weight, 3) * 0.15}
                    strokeWidth={0.6 + Math.min(link.weight, 3) * 0.35}
                  />
                )
              })}
              {graph.nodes.map((n) =>
                n.x == null || n.y == null ? null : (
                  <g key={n.id} className="node" onClick={() => setSelected(n.id)}>
                    <circle
                      cx={n.x} cy={n.y}
                      r={n.size + (selected === n.id ? 3 : 0)}
                      fill={n.color}
                      stroke={selected === n.id ? '#e6e9ef' : 'transparent'}
                      strokeWidth={selected === n.id ? 2 : 0}
                    />
                    <text x={n.x} y={n.y - n.size - 4} textAnchor="middle" className="node-label">
                      {n.label}
                    </text>
                    <title>{n.label}</title>
                  </g>
                ),
              )}
            </svg>
          </div>

          <article className="reader" onClick={onReaderClick}>
            {doc ? (
              <>
                <div className="chips">
                  {doc.tags.map((t) => (
                    <span key={t} className="chip small">{t}</span>
                  ))}
                </div>
                <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
              </>
            ) : (
              <p className="selected">Select a doc from the list or a node in the graph.</p>
            )}
          </article>
        </section>
      )}

      <footer className="foot">
        {graph
          ? `${graph.nodes.length} docs · ${graph.links.length} tag links · ${graph.clusters} clusters — baked, rendered without layout.`
          : status === 'loading' ? 'Loading atlas…' : ''}
      </footer>
    </main>
  )
}
