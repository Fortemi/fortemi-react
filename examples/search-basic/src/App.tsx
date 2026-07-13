// EX-07 · search-basic
//
// Full-text search running entirely in the browser: Postgres FTS over PGlite,
// with prefix suggestions drawn from the corpus vocabulary. No embeddings, no
// model download — this is the lexical tier. `mode: 'text'` guarantees search
// never reaches for a semantic model; flip on the `semantic` capability (see the
// capabilities examples) and switch to `mode: 'auto'` to blend in vector recall.

import { useEffect, useMemo, useState } from 'react'
import { useSearch, useSearchSuggestions, useCreateNote, useNotes } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'

export function App() {
  const { data: notes, loading: notesLoading, refresh } = useNotes({ limit: 1 })
  const { createNote } = useCreateNote()
  const { data, loading, search, clear } = useSearch()
  const [history, setHistory] = useState<string[]>([])
  const { suggestions, getSuggestions, clearSuggestions } = useSearchSuggestions(history)

  const [query, setQuery] = useState('')
  const [ready, setReady] = useState(false)

  // Seed a searchable corpus once, on first empty load.
  useEffect(() => {
    if (notesLoading || ready || !notes) return
    if (notes.total === 0) {
      ;(async () => {
        for (const n of seedNotes) {
          await createNote({ title: n.title, content: n.body, tags: n.tags })
        }
        await refresh()
        setReady(true)
      })()
    } else {
      setReady(true)
    }
  }, [notesLoading, ready, notes, createNote, refresh])

  const runSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      clear()
      return
    }
    clearSuggestions()
    await search(trimmed, { mode: 'text', include_facets: true })
    setHistory((h) => (h.includes(trimmed) ? h : [trimmed, ...h].slice(0, 10)))
  }

  const onChange = (v: string) => {
    setQuery(v)
    getSuggestions(v)
  }

  const facetTags = useMemo(() => data?.facets?.tags ?? [], [data])

  return (
    <main className="page">
      <header>
        <h1>EX-07 · search-basic</h1>
        <p className="lede">
          Postgres full-text search over <code>PGlite</code>, in this tab — ranked hits, highlighted
          snippets, and prefix suggestions from the corpus vocabulary. Lexical only: no model is
          downloaded.
        </p>
      </header>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch(query)
        }}
      >
        <input
          placeholder={ready ? 'Search notes… (try "wasm" or "shard")' : 'Booting the database…'}
          value={query}
          disabled={!ready}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="submit" disabled={!ready}>Search</button>
        {suggestions.length > 0 && (
          <ul className="suggest">
            {suggestions.map((s) => (
              <li key={`${s.source}-${s.text}`}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(s.text)
                    void runSearch(s.text)
                  }}
                >
                  {s.text} <span className="muted">· {s.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {data && (
        <div className="result-meta muted">
          {data.total} result{data.total === 1 ? '' : 's'} for “{data.query}” · mode: {data.mode}
          {' · '}
          semantic {data.semantic_available ? 'available' : 'off (lexical only)'}
        </div>
      )}

      {loading && <p className="selected">Searching…</p>}

      <ul className="result-list">
        {data?.results.map((r) => (
          <li key={r.id} className="result">
            <div className="note-head">
              <strong>{r.title ?? 'Untitled'}</strong>
              <span className="muted">rank {r.rank.toFixed(3)}</span>
            </div>
            {/* snippet contains <b>…</b> highlight markup from Postgres ts_headline */}
            <p className="snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            {r.tags.length > 0 && (
              <div className="chips">
                {r.tags.map((t) => (
                  <span key={t} className="chip small">{t}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {facetTags.length > 0 && (
        <footer className="facets">
          <span className="muted">Tags in results:</span>{' '}
          {facetTags.map((f) => (
            <span key={f.tag} className="chip small">
              {f.tag} ({f.count})
            </span>
          ))}
        </footer>
      )}
    </main>
  )
}
