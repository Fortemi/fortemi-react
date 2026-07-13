// EX-14 · remote-backend
//
// The local/remote seam. EX-06 and EX-07 build a note list and search over the
// in-browser PGlite database; this is the *same* UI shape, but every read goes
// to a Fortémi server through `useRemote`. Point it at a running server, and the
// list/search/detail flow is identical — the backend is the only thing that
// changed. With no server reachable, the calls surface a clean error (this demo
// compiles and renders regardless; it just needs a server to return data).

import { useMemo, useState } from 'react'
import { useRemote } from '@fortemi/react'
import type { BackendNote, BackendSearchHit, BackendNoteFull } from '@fortemi/core'

export function App() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000')
  const [authToken, setAuthToken] = useState('')

  const config = useMemo(
    () => ({ baseUrl, ...(authToken ? { authToken } : {}) }),
    [baseUrl, authToken],
  )
  const { listNotes, search, getNoteFull, loading, error } = useRemote(config)

  const [notes, setNotes] = useState<BackendNote[] | null>(null)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<BackendSearchHit[] | null>(null)
  const [selected, setSelected] = useState<BackendNoteFull | null>(null)

  const load = async () => {
    setHits(null)
    try {
      const res = await listNotes({ limit: 50 })
      setNotes(res.items)
      setTotal(res.total)
    } catch { /* error surfaced via `error` */ }
  }

  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) { setHits(null); return }
    try {
      const res = await search(query, { limit: 50 })
      setHits(res.hits)
    } catch { /* error surfaced via `error` */ }
  }

  const pick = async (id: string) => {
    try { setSelected(await getNoteFull(id)) } catch { /* surfaced */ }
  }

  const rows: BackendNote[] = hits ? hits.map((h) => h.note) : (notes ?? [])

  return (
    <main className="page wide">
      <header>
        <h1>EX-14 · remote-backend</h1>
        <p className="lede">
          The same note-list and search UI as the PGlite starters, sourced from a Fortémi
          <strong> server</strong> via <code>useRemote</code>. Swap the backend, keep the surface —
          the local/remote seam. Point it at a running server to see live data.
        </p>
      </header>

      <section className="conn">
        <label className="field">
          Server URL
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:3000" />
        </label>
        <label className="field">
          Bearer token <span className="muted">(optional)</span>
          <input value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="—" type="password" />
        </label>
        <button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Load notes'}</button>
      </section>

      {error && (
        <p className="banner err">
          Couldn’t reach <code>{baseUrl}</code>: {error.message}. Start a Fortémi server and try again —
          this demo compiles and renders without one; it just needs a server to return data.
        </p>
      )}

      <section className="split">
        <div className="col">
          <form className="search-bar" onSubmit={doSearch}>
            <input
              placeholder="Search the server… (full-text)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" disabled={loading}>Search</button>
            {hits && (
              <button type="button" className="ghost" onClick={() => setHits(null)}>Clear</button>
            )}
          </form>

          <p className="muted count">
            {hits ? `${hits.length} search hits` : notes ? `${notes.length} of ${total} notes` : 'Load notes or search to begin.'}
          </p>

          <ul className="note-list">
            {rows.map((n) => (
              <li key={n.id} className={`note${selected?.id === n.id ? ' active' : ''}`}>
                <button className="note-pick" onClick={() => pick(n.id)}>
                  <strong>{n.title ?? 'Untitled'}</strong>
                  <span className="chips">
                    {n.tags.slice(0, 3).map((t) => (
                      <span key={t} className="chip small">{t}</span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <aside className="detail">
          {selected ? (
            <>
              <strong>{selected.title ?? 'Untitled'}</strong>
              <p className="muted mono">
                {new Date(selected.updatedAt).toLocaleString()} · {selected.tags.length} tags
                {selected.concepts?.length ? ` · ${selected.concepts.length} concepts` : ''}
                {selected.provenance?.length ? ` · ${selected.provenance.length} revisions` : ''}
              </p>
              <p className="body">{selected.content}</p>
            </>
          ) : (
            <p className="selected">Select a note to fetch its full record from the server.</p>
          )}
        </aside>
      </section>
    </main>
  )
}
