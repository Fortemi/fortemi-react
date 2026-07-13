// EX-06 · notes-crud-minimal
//
// The whole in-browser knowledge store in one screen: create, list, edit, and
// soft-delete notes. Everything runs against PGlite (Postgres in WASM) inside
// this tab — no server, no network. `FortemiProvider` (in main.tsx) owns the
// database; these hooks are the CRUD surface over it.

import { useEffect, useState } from 'react'
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'

export function App() {
  const { data, loading, refresh } = useNotes({ sort: 'created_at', order: 'desc' })
  const { createNote } = useCreateNote()
  const { updateNote } = useUpdateNote()
  const { deleteNote } = useDeleteNote()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [seeded, setSeeded] = useState(false)

  // Seed a few notes once, on first empty load, so the list isn't blank.
  useEffect(() => {
    if (loading || seeded || !data) return
    if (data.items.length === 0) {
      ;(async () => {
        for (const n of seedNotes) {
          await createNote({ title: n.title, content: n.body, tags: n.tags })
        }
        await refresh()
      })()
    }
    setSeeded(true)
  }, [loading, seeded, data, createNote, refresh])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    if (editing) {
      await updateNote(editing, { title: title.trim() || undefined, content })
      setEditing(null)
    } else {
      await createNote({ title: title.trim() || undefined, content })
    }
    setTitle('')
    setContent('')
    await refresh()
  }

  const startEdit = (id: string, t: string | null, body: string) => {
    setEditing(id)
    setTitle(t ?? '')
    setContent(body)
  }

  const remove = async (id: string) => {
    await deleteNote(id)
    if (editing === id) setEditing(null)
    await refresh()
  }

  return (
    <main className="page">
      <header>
        <h1>EX-06 · notes-crud-minimal</h1>
        <p className="lede">
          A complete knowledge store running on <code>PGlite</code> (Postgres-in-WASM) in this tab —
          no server, no network. Create, edit, and soft-delete notes; the data layer is the same one
          the Fortémi app ships.
        </p>
      </header>

      <form className="note-form" onSubmit={submit}>
        <input
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          placeholder="Write a note…"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="row">
          <button type="submit">{editing ? 'Save changes' : 'Add note'}</button>
          {editing && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setEditing(null)
                setTitle('')
                setContent('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading && <p className="selected">Booting the database…</p>}

      <ul className="note-list">
        {data?.items.map((note) => (
          <li key={note.id} className="note">
            <div className="note-head">
              <strong>{note.title ?? 'Untitled'}</strong>
              <span className="muted">{new Date(note.created_at).toLocaleString()}</span>
            </div>
            {note.tags.length > 0 && (
              <div className="chips">
                {note.tags.map((t) => (
                  <span key={t} className="chip small">{t}</span>
                ))}
              </div>
            )}
            <div className="row">
              <button className="ghost" onClick={() => startEdit(note.id, note.title, '')}>Edit title</button>
              <button className="ghost danger" onClick={() => remove(note.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="muted" style={{ marginTop: '1rem', fontSize: '.8rem' }}>
        {data ? `${data.total} note${data.total === 1 ? '' : 's'} · persistence: memory (resets on reload)` : ''}
      </footer>
    </main>
  )
}
