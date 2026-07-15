// EX-16 · knowledge-garden
//
// A composed app: everything the starters teach, wired into one workspace over a
// single in-browser PGlite database. Search filters the list *and* spotlights
// matches in a tag-derived graph; selecting a note anywhere (list, graph, or a
// search hit) drives one shared detail pane; create and delete mutate the same
// database the graph is built from. No server, no downloads.

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
import { type CommunityGraph, type GraphEdge } from '@fortemi/graph'
import {
  useNotes,
  useCreateNote,
  useDeleteNote,
  useNote,
  useSearch,
} from '@fortemi/react'
import { CORPUS } from './corpus.js'

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
    communityMap.set(key, [...(communityMap.get(key) ?? []), n.id])
  }
  const communities = [...communityMap.entries()].map(([tag, ids]) => ({ id: `tag-${tag}`, nodes: ids }))
  return { nodes, edges, communities }
}

export function App() {
  const { data: notes, loading, refresh } = useNotes({ limit: 200, sort: 'created_at', order: 'asc' })
  const { createNote } = useCreateNote()
  const { deleteNote } = useDeleteNote()
  const { data: search, search: runSearch, clear } = useSearch()

  const [seeded, setSeeded] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('2d')
  const themeMode = useThemeMode()
  const graphTheme = graphThemeFor(themeMode)
  const [draft, setDraft] = useState('')

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

  const graph = useMemo(
    () => (notes && notes.items.length ? buildTagGraph(notes.items.map((n) => ({ id: n.id, tags: n.tags }))) : null),
    [notes],
  )
  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    notes?.items.forEach((n) => m.set(n.id, n.title ?? 'Untitled'))
    return m
  }, [notes])

  // Matched ids from the last search — used to filter the list and spotlight the graph.
  const matchedIds = useMemo(
    () => (search && query.trim() ? search.results.map((r) => r.id) : null),
    [search, query],
  )
  const matchedSet = useMemo(() => (matchedIds ? new Set(matchedIds) : null), [matchedIds])

  const listItems = useMemo(() => {
    if (!notes) return []
    if (!matchedSet) return notes.items
    return notes.items.filter((n) => matchedSet.has(n.id))
  }, [notes, matchedSet])

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) await runSearch(query, { mode: 'text' })
    else clear()
  }

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    const [title, ...rest] = text.split('\n')
    await createNote({ title, content: rest.join('\n') || title, tags: ['notes'] })
    setDraft('')
    await refresh()
  }

  const remove = async (id: string) => {
    await deleteNote(id)
    if (selected === id) setSelected(null)
    await refresh()
  }

  return (
    <main className="page wide">
      <ThemeToggle floating />
      <header>
        <h1>EX-16 · knowledge-garden</h1>
        <p className="lede">
          The starters, composed. One <code>PGlite</code> database feeds a searchable note list, a
          tag-derived graph, and a detail pane — all sharing a single selection. Search filters the
          list and spotlights the graph; create and delete mutate the same store. No server, no
          downloads.
        </p>
      </header>

      <form className="search-bar" onSubmit={onSearch}>
        <input
          placeholder={seeded ? 'Search the garden… (try "shard" or "layout")' : 'Booting the database…'}
          value={query}
          disabled={!seeded}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={!seeded}>Search</button>
        {matchedIds && (
          <button type="button" className="ghost" onClick={() => { setQuery(''); clear() }}>
            Clear ({matchedIds.length})
          </button>
        )}
      </form>

      <section className="garden">
        <aside className="col">
          <form className="note-form" onSubmit={addNote}>
            <textarea
              rows={2}
              placeholder="New note — first line is the title"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" disabled={!seeded}>Add note</button>
          </form>

          <ul className="note-list">
            {listItems.map((n) => (
              <li key={n.id} className={`note${selected === n.id ? ' active' : ''}`}>
                <button className="note-pick" onClick={() => setSelected(n.id)}>
                  <strong>{n.title ?? 'Untitled'}</strong>
                  <span className="chips">
                    {n.tags.slice(0, 3).map((t) => (
                      <span key={t} className="chip small">{t}</span>
                    ))}
                  </span>
                </button>
                <button className="ghost danger x" onClick={() => remove(n.id)} title="Delete">×</button>
              </li>
            ))}
            {matchedIds && listItems.length === 0 && <li className="muted">No matches.</li>}
          </ul>
        </aside>

        <div className="col grow">
          <div className="canvas" style={{ position: 'relative' }}>
            {graph ? (
              <>
                <GraphModeToggle
                  mode={mode}
                  onModeChange={setMode}
                  style={{ margin: 8 }}
                />
                {mode === '2d' ? (
                  <GraphView
                    graph={graph}
                    layout={{ algorithm: 'force' }}
                    filters={{ nodeIds: matchedIds ?? undefined }}
                    selectedNodeId={selected}
                    onSelectNode={setSelected}
                    labelFor={(id) => titleById.get(id) ?? id}
                    width={620}
                    height={420}
                  />
                ) : (
                  <Graph3DLazy
                    graph={graph}
                    filters={{ nodeIds: matchedIds ?? undefined }}
                    labelFor={(id) => titleById.get(id) ?? id}
                    onSelectNode={setSelected}
                    theme={graphTheme.force3d}
                    height={420}
                  />
                )}
              </>
            ) : (
              <p className="selected">Growing the graph…</p>
            )}
          </div>

          <div className="detail">
            {selectedNote ? (
              <>
                <strong>{selectedNote.title ?? 'Untitled'}</strong>
                <p className="body">{selectedNote.current.content}</p>
                <div className="chips">
                  {selectedNote.tags.map((t) => (
                    <span key={t} className="chip small">{t}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="selected">Select a note from the list or the graph.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
