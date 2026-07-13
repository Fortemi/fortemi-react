// Instance A — seeds a small corpus and exports it as a shard.

import { useEffect, useState } from 'react'
import { exportShard } from '@fortemi/core'
import { useFortemiContext, useNotes, useCreateNote } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'

export function SourceInstance({
  onExport,
  exported,
}: {
  onExport: (bytes: Uint8Array) => void
  exported: boolean
}) {
  const { db } = useFortemiContext()
  const { data, loading, refresh } = useNotes({ limit: 100, sort: 'created_at', order: 'asc' })
  const { createNote } = useCreateNote()
  const [seeded, setSeeded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading || seeded || !data) return
    if (data.total === 0) {
      ;(async () => {
        for (const n of seedNotes) await createNote({ title: n.title, content: n.body, tags: n.tags })
        await refresh()
        setSeeded(true)
      })()
    } else {
      setSeeded(true)
    }
  }, [loading, seeded, data, createNote, refresh])

  const doExport = async () => {
    setBusy(true)
    try {
      onExport(await exportShard(db))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="instance">
      <h2>Instance A · source</h2>
      <p className="muted">Its own in-memory database ({data?.total ?? '…'} notes).</p>
      <div className="row">
        <button onClick={doExport} disabled={!seeded || busy}>
          {busy ? 'Exporting…' : exported ? 'Re-export shard →' : 'Export shard →'}
        </button>
      </div>
      <ul className="note-list">
        {data?.items.map((n) => (
          <li key={n.id} className="note">{n.title ?? 'Untitled'}</li>
        ))}
      </ul>
    </div>
  )
}
