// The read-only half of EX-08. `useShard` opens the archive with no database
// engine at all — it manages a `ShardReader` and exposes browse/get/search.
// This component never touches FortemiProvider or PGlite.

import { useEffect, useState } from 'react'
import { useShard } from '@fortemi/react'
import type { ShardReaderSource } from '@fortemi/core'

type Note = Awaited<ReturnType<ReturnType<typeof useShard>['getNote']>>

export function ShardBrowser({
  source,
  origin,
}: {
  source: ShardReaderSource
  origin: 'baked' | 'dropped' | null
}) {
  const { manifest, loading, error, listNotes, getNote } = useShard(source)
  const [notes, setNotes] = useState<{ id: string; title: string | null; tags: string[] }[]>([])
  const [open, setOpen] = useState<Note>(null)

  useEffect(() => {
    if (loading || error) return
    listNotes({ limit: 100 })
      .then((res) => setNotes(res.items.map((n) => ({ id: n.id, title: n.title, tags: n.tags }))))
      .catch(() => setNotes([]))
  }, [loading, error, listNotes])

  if (error) {
    return <p className="selected">Could not open shard: {error.message}</p>
  }
  if (loading) {
    return <p className="selected">Opening shard…</p>
  }

  return (
    <section>
      <div className="manifest">
        <strong>Shard manifest {origin === 'dropped' ? '(dropped file)' : '(baked here)'}</strong>
        <dl>
          <dt>format</dt>
          <dd>{manifest?.format}</dd>
          <dt>created</dt>
          <dd>{manifest ? new Date(manifest.created_at).toLocaleString() : '—'}</dd>
          <dt>components</dt>
          <dd>{manifest?.components.join(', ')}</dd>
          <dt>counts</dt>
          <dd>
            {manifest
              ? Object.entries(manifest.counts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')
              : '—'}
          </dd>
        </dl>
      </div>

      <ul className="note-list">
        {notes.map((n) => (
          <li key={n.id} className="note">
            <div className="note-head">
              <button
                onClick={async () => {
                  const full = await getNote(n.id)
                  setOpen(full)
                }}
              >
                <strong>{n.title ?? 'Untitled'}</strong>
              </button>
            </div>
            {n.tags.length > 0 && (
              <div className="chips">
                {n.tags.map((t) => (
                  <span key={t} className="chip small">{t}</span>
                ))}
              </div>
            )}
            {open?.id === n.id && (
              <p className="body">{open.revised_content ?? open.original_content}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
