// One synced instance. It seeds a divergent slice of the corpus, then exposes an
// imperative sync handle (export its shard / import someone else's) to the
// parent so a single Sync button can drive a bidirectional exchange.

import { useEffect, useRef, useState } from 'react'
import { exportShard } from '@fortemi/core'
import { useFortemiContext, useNotes, useCreateNote, useImportShard } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'

export interface SyncHandle {
  exportBytes: () => Promise<Uint8Array>
  importBytes: (bytes: Uint8Array) => Promise<void>
  refresh: () => Promise<void>
}

export function Instance({
  label,
  slice,
  onReady,
  onCount,
}: {
  label: string
  // Indices into seedNotes this instance starts with (divergent per side).
  slice: number[]
  onReady: (handle: SyncHandle) => void
  onCount: (total: number, titles: string[]) => void
}) {
  const { db } = useFortemiContext()
  const { data, refresh } = useNotes({ limit: 200, sort: 'created_at', order: 'asc' })
  const { createNote } = useCreateNote()
  const { importShard } = useImportShard()
  const [seeded, setSeeded] = useState(false)
  const dbRef = useRef(db)
  dbRef.current = db

  useEffect(() => {
    if (seeded || !data) return
    if (data.total === 0) {
      ;(async () => {
        for (const i of slice) {
          const n = seedNotes[i]
          await createNote({ title: n.title, content: n.body, tags: n.tags })
        }
        await refresh()
        setSeeded(true)
      })()
    } else {
      setSeeded(true)
    }
  }, [seeded, data, slice, createNote, refresh])

  // Report the current note set upward whenever it changes.
  useEffect(() => {
    if (data) onCount(data.total, data.items.map((n) => n.title ?? 'Untitled'))
  }, [data, onCount])

  // Register the imperative sync handle once seeded.
  useEffect(() => {
    if (!seeded) return
    onReady({
      exportBytes: () => exportShard(dbRef.current),
      importBytes: async (bytes) => {
        const ab = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(ab).set(bytes)
        const file = new File([ab], 'sync.shard', { type: 'application/gzip' })
        await importShard(file, 'skip')
      },
      refresh,
    })
  }, [seeded, onReady, importShard, refresh])

  return (
    <div className="instance">
      <h2>Instance {label}</h2>
      <p className="muted">{data ? `${data.total} notes` : 'Booting…'}</p>
      <ul className="note-list">
        {data?.items.map((n) => (
          <li key={n.id} className="note">{n.title ?? 'Untitled'}</li>
        ))}
      </ul>
    </div>
  )
}
