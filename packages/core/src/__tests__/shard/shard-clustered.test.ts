import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { openShard } from '../../shard/shard-reader.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import type { ShardManifest } from '../../shard/types.js'

const decoder = new TextDecoder()

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string): Promise<void> {
  await db.query(
    `INSERT INTO note (id, title, format, source, visibility, revision_mode)
     VALUES ($1, $2, 'markdown', 'user', 'private', 'standard')`,
    [id, id],
  )
  await db.query(
    `INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)`,
    [`orig-${id}`, id, `${id} original content`, `hash-${id}`],
  )
}

function manifestOf(archive: Uint8Array): ShardManifest {
  const files = unpackTarGz(archive)
  return JSON.parse(decoder.decode(files.get('manifest.json')!)) as ShardManifest
}

describe('clustered shard export/import/read round-trip (#189)', () => {
  it('emits clustered notes, reads them in place, and re-imports them', async () => {
    const db = await setupDb()
    try {
      for (const id of ['na', 'nb', 'nc', 'nd', 'ne']) await insertNote(db, id)

      const archive = await exportShard(db, { clusterNotesSize: 2 })
      const files = unpackTarGz(archive)
      const manifest = manifestOf(archive)

      // Clustered layout emitted; no monolithic notes.jsonl.
      expect(files.has('notes.jsonl')).toBe(false)
      expect(manifest.layout?.clusters?.notes).toHaveLength(3) // 5 notes / 2
      expect(files.has('notes/000000.jsonl')).toBe(true)
      expect(manifest.counts.notes).toBe(5)

      // In-place reader consumes the clusters — no PGlite.
      const reader = await openShard(archive)
      const listed = await reader.listNotes()
      expect(listed.total).toBe(5)
      expect(listed.items.map((n) => n.id).sort()).toEqual(['na', 'nb', 'nc', 'nd', 'ne'])
      const search = await reader.search('original')
      expect(search.total).toBe(5)

      // importShard consumes the clustered layout transparently.
      const imported = await setupDb()
      try {
        const result = await importShard(imported, archive)
        expect(result.success).toBe(true)
        expect(result.counts.notes).toBe(5)
        const count = await imported.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM note')
        expect(Number(count.rows[0]?.count)).toBe(5)
      } finally {
        await imported.close()
      }
    } finally {
      await db.close()
    }
  }, 30_000)

  it('default export stays monolithic (no layout) — backward compatible', async () => {
    const db = await setupDb()
    try {
      await insertNote(db, 'solo')
      const archive = await exportShard(db)
      const files = unpackTarGz(archive)
      const manifest = manifestOf(archive)
      expect(files.has('notes.jsonl')).toBe(true)
      expect(manifest.layout).toBeUndefined()
    } finally {
      await db.close()
    }
  }, 30_000)
})
