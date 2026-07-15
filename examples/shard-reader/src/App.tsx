// EX-08 · shard-reader
//
// The Knowledge Shard portability loop, end to end:
//
//   1. A small database is seeded in this tab (PGlite).
//   2. `exportShard(db)` packs it into a single self-describing `.shard`
//      (tar.gz: a manifest + component tables + BLAKE3-hashed blob sidecars).
//   3. `useShard(bytes)` opens that archive **read-only, with NO PGlite** — the
//      reader is a pure archive query surface, so a viewer never ships the
//      8.7 MB Postgres engine.
//
// You can also drop a `.shard` exported from any other Fortémi instance — the
// reader half is entirely independent of where the shard came from.

import { useEffect, useMemo, useState } from 'react'
import { ThemeToggle } from '@fortemi/examples-shared/ui'
import { exportShard } from '@fortemi/core'
import { useFortemiContext, useCreateNote, useNotes } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'
import { ShardBrowser } from './ShardBrowser.js'

export function App() {
  const { db } = useFortemiContext()
  const { data: notes, loading: notesLoading, refresh } = useNotes({ limit: 1 })
  const { createNote } = useCreateNote()

  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [baking, setBaking] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [origin, setOrigin] = useState<'baked' | 'dropped' | null>(null)

  useEffect(() => {
    if (notesLoading || seeded || !notes) return
    if (notes.total === 0) {
      ;(async () => {
        for (const n of seedNotes) {
          await createNote({ title: n.title, content: n.body, tags: n.tags })
        }
        await refresh()
        setSeeded(true)
      })()
    } else {
      setSeeded(true)
    }
  }, [notesLoading, seeded, notes, createNote, refresh])

  const bake = async () => {
    setBaking(true)
    try {
      // exportShard returns the packed archive bytes (tar.gz). The context db
      // is accepted as a DatabaseClient.
      const archive = await exportShard(db)
      setBytes(archive)
      setOrigin('baked')
    } finally {
      setBaking(false)
    }
  }

  const openDropped = async (file: File) => {
    const buf = await file.arrayBuffer()
    setBytes(new Uint8Array(buf))
    setOrigin('dropped')
  }

  // Memoize the source so useShard doesn't re-open on every render.
  const source = useMemo(() => bytes, [bytes])

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-08 · shard-reader</h1>
        <p className="lede">
          Bake a portable <code>.shard</code> from an in-browser database, then browse it read-only
          with <code>useShard</code> — <strong>no PGlite on the reader side</strong>. A shard is a
          tar.gz of your notes plus BLAKE3-hashed blob sidecars: export from one browser, open in
          another.
        </p>
      </header>

      <div className="row">
        <button onClick={bake} disabled={!seeded || baking}>
          {baking ? 'Baking…' : origin === 'baked' ? 'Re-bake shard' : 'Bake shard from this database'}
        </button>
        <span className="muted">
          {notes ? `${notes.total} note${notes.total === 1 ? '' : 's'} in the source database` : 'Booting the database…'}
        </span>
      </div>

      <label
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) void openDropped(file)
        }}
      >
        …or drop a <code>.shard</code> exported from any Fortémi instance
        <input
          type="file"
          accept=".shard,.gz,application/gzip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void openDropped(file)
          }}
        />
      </label>

      {source && <ShardBrowser source={source} origin={origin} />}
    </main>
  )
}
