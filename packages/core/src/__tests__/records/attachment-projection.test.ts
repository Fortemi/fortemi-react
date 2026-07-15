/**
 * PGlite attachment projection — idempotency + rebuild parity (#320).
 *
 * Canonical records (RecordStore) are the source of truth; the PGlite
 * attachment tables are a derived projection that can be dropped and rebuilt
 * with equivalent query results and without touching canonical records or
 * Bytecask bytes.
 */

import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../../records/canonical-notes-repository.js'
import { CanonicalAttachmentsRepository } from '../../records/canonical-attachments-repository.js'
import {
  projectAttachments,
  dropAttachmentProjection,
} from '../../records/attachment-projection.js'
import { MemoryBlobStore } from '../../blob-store.js'

const bytes = (s: string) => new TextEncoder().encode(s)

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

interface ProjectedState {
  blobs: Array<Record<string, unknown>>
  attachments: Array<Record<string, unknown>>
}

async function readProjection(db: PGlite): Promise<ProjectedState> {
  const blobs = await db.query<Record<string, unknown>>(
    `SELECT id, content_hash, size_bytes, reference_count, content_type, storage_type
     FROM attachment_blob ORDER BY id`,
  )
  const attachments = await db.query<Record<string, unknown>>(
    `SELECT id, note_id, blob_id, filename, mime_type, extracted_text, status,
            position, deleted_at IS NULL AS active
     FROM attachment ORDER BY id`,
  )
  return { blobs: blobs.rows, attachments: attachments.rows }
}

describe('attachment projection (PGlite as derived state)', { timeout: 30_000 }, () => {
  it('projects, is idempotent, and rebuilds to equivalent query results', async () => {
    // Canonical side — no PGlite involved in any write.
    const store = new MemoryRecordStore()
    const blobStore = new MemoryBlobStore()
    const notes = new CanonicalNotesRepository(store)
    const attachments = new CanonicalAttachmentsRepository(store, blobStore)

    const note = await notes.create({ title: 'host', content: 'note body' })
    const a = await attachments.attach({
      noteId: note.note.id,
      data: bytes('shared payload'),
      filename: 'a.bin',
      mimeType: 'application/octet-stream',
      extractedText: 'searchable text',
    })
    // Dedup pair: same bytes, second manifest.
    await attachments.attach({
      noteId: note.note.id,
      data: bytes('shared payload'),
      filename: 'b.bin',
    })
    const dropped = await attachments.attach({
      noteId: note.note.id,
      data: bytes('other payload'),
      filename: 'c.bin',
    })
    await attachments.delete(dropped.id)

    const db = await setupDb()
    try {
      // The note projection is #323 cycle-2 scope; seed the FK parent directly.
      await db.query(
        `INSERT INTO note (id, title, format, source, visibility, revision_mode)
         VALUES ($1, $2, 'markdown', 'user', 'private', 'standard')`,
        [note.note.id, 'host'],
      )

      const first = await projectAttachments(db, store)
      expect(first).toEqual({ blobs: 2, attachments: 3 })
      const initial = await readProjection(db)

      // Derived refcounts: shared blob has 2 live manifests; the soft-deleted
      // attachment's blob has 0.
      const shared = initial.blobs.find((b) => b.id === a.blob_id)
      const orphan = initial.blobs.find((b) => b.id === dropped.blob_id)
      expect(shared?.reference_count).toBe(2)
      expect(orphan?.reference_count).toBe(0)
      // Attach-time extraction maps to status parity.
      const withText = initial.attachments.find((r) => r.id === a.id)
      expect(withText?.status).toBe('completed')
      const withoutText = initial.attachments.find((r) => r.id === dropped.id)
      expect(withoutText?.status).toBe('uploaded')

      // Idempotent: a second pass changes nothing.
      await projectAttachments(db, store)
      expect(await readProjection(db)).toEqual(initial)

      // Rebuild: drop the projection, re-project, equivalent results —
      // canonical records and blob bytes untouched throughout.
      await dropAttachmentProjection(db)
      expect((await readProjection(db)).blobs).toEqual([])
      await projectAttachments(db, store)
      expect(await readProjection(db)).toEqual(initial)
      expect(await attachments.getBlob(a.id)).toEqual(bytes('shared payload'))
    } finally {
      await db.close()
    }
  })
})
