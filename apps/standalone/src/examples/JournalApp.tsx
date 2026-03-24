/**
 * Example 3: Personal Journal with AI Revision
 *
 * Demonstrates: tag-scoped data (app:journal), job queue pipeline,
 * AI revision with before/after comparison, search suggestions,
 * vocabulary-based autocomplete, revision history.
 */
import { useState, useEffect, useCallback } from 'react'
import { NotesRepository, type NoteRevision } from '@fortemi/core'
import { useCreateNote, useNotes, useSearch, useSearchHistory, useSearchSuggestions, useJobQueue, useNote, useFortemiContext } from '@fortemi/react'

const APP_TAG = 'app:journal'

const SEED_ENTRIES = [
  'Today I learned about the observer pattern in software design. It reminds me of how event-driven architectures work — publishers don\'t need to know about subscribers. The decoupling is elegant but can make debugging harder when you can\'t trace the flow.',
  'Had a great conversation about the difference between mentoring and coaching. Mentoring shares experience and domain knowledge. Coaching asks questions to help the other person find their own answers. Both valuable, but knowing which one to apply when is the real skill.',
  'Reading about how PostgreSQL handles MVCC (Multi-Version Concurrency Control). Each transaction sees a snapshot of the data. Old versions are kept until no transaction needs them. Vacuum cleans up dead tuples. It\'s fascinating how much complexity hides behind a simple SELECT.',
  'Reflecting on why some teams ship fast and others don\'t. It\'s rarely about talent. It\'s about how quickly decisions get made, how much context switching happens, and whether people feel safe to make mistakes. Psychological safety isn\'t soft — it\'s infrastructure.',
]

export function JournalApp() {
  useJobQueue(2000)
  const { createNote } = useCreateNote()
  const { data: notes } = useNotes({ sort: 'created_at', order: 'desc', tags: [APP_TAG] })
  const { data: searchData, search, clear } = useSearch()
  const { history, addEntry } = useSearchHistory()
  const { suggestions, getSuggestions, clearSuggestions } = useSearchSuggestions(history)

  const [entry, setEntry] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const handleCreate = async () => {
    if (!entry.trim()) return
    await createNote({ content: entry, tags: [APP_TAG] })
    setEntry('')
  }

  const handleSeed = async () => {
    setSeeding(true)
    for (const text of SEED_ENTRIES) {
      await createNote({ content: text, tags: [APP_TAG] })
    }
    setSeeding(false)
  }

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q)
    getSuggestions(q)
    if (q.trim()) {
      addEntry(q)
      await search(q, { tags: [APP_TAG] })
    } else { clear(); clearSuggestions() }
  }, [search, clear, addEntry, getSuggestions, clearSuggestions])

  const entryCount = notes?.total ?? 0
  const displayNotes = query.trim() ? searchData?.results : notes?.items

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Personal Journal</h2>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
        Write entries. The job queue auto-generates titles and AI revisions. Compare original vs revised content.
        <span style={{ color: '#999', marginLeft: 8 }}>{entryCount} entries</span>
      </p>

      {entryCount === 0 && (
        <button onClick={handleSeed} disabled={seeding}
          style={{ padding: '6px 14px', background: '#f5a623', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>
          {seeding ? 'Loading...' : 'Load 4 Sample Entries'}
        </button>
      )}

      {/* Write entry */}
      <div style={{ marginBottom: 16 }}>
        <textarea value={entry} onChange={e => setEntry(e.target.value)} rows={4}
          placeholder="What's on your mind today..."
          style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, fontSize: 14, fontFamily: 'Georgia, serif', boxSizing: 'border-box', marginBottom: 6 }} />
        <button onClick={handleCreate}
          style={{ padding: '6px 14px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
          Save Entry
        </button>
      </div>

      {/* Search with suggestions */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input value={query} onChange={e => void handleSearch(e.target.value)}
          placeholder="Search journal..."
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
        {suggestions.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ddd', borderRadius: 4, zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            {suggestions.map(s => (
              <div key={s.text} onClick={() => { void handleSearch(s.text); clearSuggestions() }}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f0f7ff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white' }}>
                {s.text}
                <span style={{ fontSize: 10, color: '#999', marginLeft: 8 }}>{s.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Entries */}
      {displayNotes && (displayNotes as Array<{ id: string; title: string | null }>).map(note => (
        <div key={note.id} onClick={() => setSelectedId(selectedId === note.id ? null : note.id)}
          style={{ padding: 10, border: selectedId === note.id ? '1px solid #4a9eff' : '1px solid #eee', borderRadius: 6, marginBottom: 6, cursor: 'pointer' }}>
          <strong style={{ fontSize: 14 }}>{note.title ?? 'Untitled entry'}</strong>
        </div>
      ))}

      {selectedId && <RevisionDetail noteId={selectedId} />}
    </div>
  )
}

function RevisionDetail({ noteId }: { noteId: string }) {
  const { db, events } = useFortemiContext()
  const { data: note } = useNote(noteId)
  const [revisions, setRevisions] = useState<NoteRevision[]>([])

  useEffect(() => {
    const repo = new NotesRepository(db, events)
    void repo.getRevisions(noteId).then(setRevisions)
  }, [noteId, db, events])

  if (!note) return null

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginTop: 8, background: '#f8f9fa' }}>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
        Gen: {note.current.generation_count} | Model: {note.current.model ?? 'none'} | Edited: {note.current.is_user_edited ? 'yes' : 'no'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Original</div>
          <div style={{ background: '#fff8e1', padding: 8, borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', maxHeight: 200, overflow: 'auto' }}>
            {note.original.content}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Current (after AI revision)</div>
          <div style={{ background: '#e8f5e9', padding: 8, borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', maxHeight: 200, overflow: 'auto' }}>
            {note.current.content}
          </div>
        </div>
      </div>
      {revisions.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
          {revisions.length} revision{revisions.length !== 1 ? 's' : ''}: {revisions.map(r => `#${r.revision_number} (${r.type})`).join(', ')}
        </div>
      )}
    </div>
  )
}
