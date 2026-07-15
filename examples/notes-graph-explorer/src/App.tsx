// EX-10 · notes-graph-explorer
//
// Where the data layer meets the graph stack. Real notes live in PGlite; we
// derive a `CommunityGraph` from their *tags* (notes that share tags are
// linked; each note's first tag is its community) and explore it with the
// PGlite-free `GraphView`. Click a node to pull the full note from the database.
// No embeddings, no downloads — the structure comes straight from tag overlap.

import { useEffect, useMemo, useState } from 'react'
import {
  GraphModeToggle,
  Graph3DLazy,
  ThemeToggle,
  useThemeMode,
  graphThemeFor,
  type GraphMode,
} from '@fortemi/examples-shared/ui'
import { GraphView } from '@fortemi/react/graph'
import { communityLegend, type CommunityGraph, type GraphEdge } from '@fortemi/graph'
import { useNotes, useCreateNote, useNote } from '@fortemi/react'

// A small tagged corpus with deliberate tag overlap so the derived graph has
// real community structure. Seeded once into the in-browser database.
const CORPUS: { title: string; body: string; tags: string[] }[] = [
  { title: 'PGlite in the browser', body: 'Postgres compiled to WASM; no server.', tags: ['architecture', 'pglite', 'schema'] },
  { title: 'Single-writer worker', body: 'All writes serialize through one worker.', tags: ['architecture', 'pglite', 'worker'] },
  { title: 'Tiered persistence', body: 'OPFS on Chrome, IndexedDB on Firefox.', tags: ['architecture', 'schema', 'storage'] },
  { title: 'UUIDv7 keys', body: 'Time-sortable primary keys for clean sync.', tags: ['schema', 'sync'] },
  { title: 'Soft delete', body: 'deleted_at marks removal; nothing is dropped.', tags: ['schema', 'sync'] },
  { title: 'CommunityGraph shape', body: 'nodes + edges + communities, framework-agnostic.', tags: ['graph', 'architecture'] },
  { title: 'Force layout', body: 'Deterministic settlement seeds a stable layout.', tags: ['graph', 'layout'] },
  { title: 'Render snapshots', body: 'Bake x/y at build time for a warm start.', tags: ['graph', 'layout', 'build'] },
  { title: 'Three render tiers', body: 'SVG, Sigma 2D, and 3D over one contract.', tags: ['graph', 'ui'] },
  { title: 'Full-text search', body: 'Postgres FTS with ts_headline snippets.', tags: ['search', 'schema'] },
  { title: 'Search suggestions', body: 'Prefix completions from the vocabulary.', tags: ['search', 'ui'] },
  { title: 'Opt-in embeddings', body: 'transformers.js gated behind a capability.', tags: ['search', 'embeddings', 'capabilities'] },
  { title: 'Knowledge shards', body: 'tar.gz notes + BLAKE3 blob sidecars.', tags: ['shards', 'portability'] },
  { title: 'Shard round-trip', body: 'Export from one browser, import into another.', tags: ['shards', 'portability', 'sync'] },
]

/** Build a CommunityGraph from note tags: shared tags → edges; first tag → community. */
function buildTagGraph(notes: { id: string; tags: string[] }[]): CommunityGraph {
  const nodes = notes.map((n) => ({ id: n.id }))

  const edges: GraphEdge[] = []
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const shared = notes[i].tags.filter((t) => notes[j].tags.includes(t))
      if (shared.length > 0) {
        edges.push({ source: notes[i].id, target: notes[j].id, weight: shared.length, kind: shared[0] })
      }
    }
  }

  const communityMap = new Map<string, string[]>()
  for (const n of notes) {
    const key = n.tags[0] ?? 'untagged'
    const arr = communityMap.get(key) ?? []
    arr.push(n.id)
    communityMap.set(key, arr)
  }
  const communities = [...communityMap.entries()].map(([tag, ids]) => ({ id: `tag-${tag}`, nodes: ids }))

  return { nodes, edges, communities }
}

export function App() {
  const { data: notes, loading, refresh } = useNotes({ limit: 200, sort: 'created_at', order: 'asc' })
  const { createNote } = useCreateNote()
  const [seeded, setSeeded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('2d')
  const themeMode = useThemeMode()
  const graphTheme = graphThemeFor(themeMode)
  const [minDegree, setMinDegree] = useState(0)

  const { data: selectedNote } = useNote(selected)

  useEffect(() => {
    if (loading || seeded || !notes) return
    if (notes.total === 0) {
      ;(async () => {
        for (const n of CORPUS) await createNote({ title: n.title, content: n.body, tags: n.tags })
        await refresh()
        setSeeded(true)
      })()
    } else {
      setSeeded(true)
    }
  }, [loading, seeded, notes, createNote, refresh])

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    notes?.items.forEach((n) => m.set(n.id, n.title ?? 'Untitled'))
    return m
  }, [notes])

  const graph = useMemo(() => {
    if (!notes || notes.items.length === 0) return null
    return buildTagGraph(notes.items.map((n) => ({ id: n.id, tags: n.tags })))
  }, [notes])

  const legend = useMemo(() => (graph ? communityLegend(graph) : []), [graph])

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-10 · notes-graph-explorer</h1>
        <p className="lede">
          Real notes in <code>PGlite</code>, explored as a graph. The structure is derived from tag
          overlap — notes sharing tags are linked, each note's first tag is its community — then
          rendered with the PGlite-free <code>GraphView</code>. Click a node to load the full note
          from the database.
        </p>
      </header>

      {!graph ? (
        <p className="selected">Booting the database and seeding notes…</p>
      ) : (
        <section className="layout">
          <div className="canvas" style={{ position: 'relative' }}>
            <GraphModeToggle
              mode={mode}
              onModeChange={setMode}
              style={{ position: 'absolute', top: 8, left: 8, zIndex: 5 }}
            />
            {mode === '2d' ? (
              <GraphView
                graph={graph}
                layout={{ algorithm: 'force' }}
                filters={{ minDegree }}
                selectedNodeId={selected}
                onSelectNode={setSelected}
                labelFor={(id) => titleById.get(id) ?? id}
                width={720}
                height={470}
              />
            ) : (
              <Graph3DLazy
                graph={graph}
                filters={{ minDegree }}
                labelFor={(id) => titleById.get(id) ?? id}
                onSelectNode={setSelected}
                theme={graphTheme.force3d}
                height={470}
              />
            )}
          </div>

          <aside className="controls">
            <label className="control">
              <span>Minimum degree: {minDegree}</span>
              <input
                type="range"
                min={0}
                max={6}
                value={minDegree}
                onChange={(e) => setMinDegree(Number(e.target.value))}
              />
            </label>

            <div className="control">
              <span>Communities (by first tag)</span>
              <div className="chips">
                {legend.map((row) => (
                  <span key={row.communityId} className="chip">
                    <i className="swatch" style={{ background: row.color }} />
                    {row.communityId.replace(/^tag-/, '')} · {row.count}
                  </span>
                ))}
              </div>
            </div>

            <div className="control">
              <span>Selected note</span>
              {selectedNote ? (
                <div>
                  <strong>{selectedNote.title ?? 'Untitled'}</strong>
                  <p className="body">{selectedNote.current.content}</p>
                  <div className="chips">
                    {selectedNote.tags.map((t) => (
                      <span key={t} className="chip small">{t}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="selected">— click a node —</p>
              )}
            </div>
          </aside>
        </section>
      )}
    </main>
  )
}
