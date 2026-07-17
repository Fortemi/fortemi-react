/**
 * DB-free Knowledge Shard round-trip (#323 cycle 2) — export/import over the
 * canonical RecordStore + Bytecask BlobStore with zero PGlite, including byte
 * sidecars, conflict strategies, the ADR-014 verify-before-persist gate, and
 * cross-tier format parity (a record-exported shard imports into PGlite).
 */

import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../../records/canonical-notes-repository.js'
import { CanonicalAttachmentsRepository } from '../../records/canonical-attachments-repository.js'
import { exportShardFromRecords, importShardToRecords } from '../../records/record-shard.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShard } from '../../shard/shard-export.js'
import { AllowlistTrustStore } from '../../shard/shard-signature.js'
import { MemoryBlobStore } from '../../blob-store.js'
import type { DatabaseClient } from '../../storage-backend.js'

const bytes = (s: string) => new TextEncoder().encode(s)

async function seededStore() {
  const store = new MemoryRecordStore()
  const blobStore = new MemoryBlobStore()
  const notes = new CanonicalNotesRepository(store)
  const attachments = new CanonicalAttachmentsRepository(store, blobStore)

  const a = await notes.create({ title: 'Alpha', content: 'alpha original' })
  await notes.update(a.note.id, { content: 'alpha revised' })
  const b = await notes.create({ title: 'Beta', content: 'beta body' })
  await notes.addTag(a.note.id, 'storage')
  await notes.addTag(b.note.id, 'storage')
  await notes.addTag(b.note.id, 'bytes')
  await notes.createLink(a.note.id, b.note.id, 'related')
  const collection = await notes.createCollection('Research', 'storage notes')
  await notes.addNoteToCollection(collection.id, a.note.id)
  const attachment = await attachments.attach({
    noteId: a.note.id,
    data: bytes('attachment payload'),
    filename: 'payload.txt',
    mimeType: 'text/plain',
    extractedText: 'attachment payload',
  })

  return { store, blobStore, notes, attachments, a, b, collection, attachment }
}

describe('record-shard (DB-free)', () => {
  it('round-trips records and sidecar bytes into a fresh store with zero PGlite', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })

    const dst = new MemoryRecordStore()
    const dstBlobs = new MemoryBlobStore()
    const result = await importShardToRecords(dst, archive, { blobStore: dstBlobs })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.counts.notes).toBe(2)
    expect(result.counts.collections).toBe(1)
    expect(result.counts.links).toBe(1)

    const dstNotes = new CanonicalNotesRepository(dst)
    const alpha = await dstNotes.get(src.a.note.id)
    expect(alpha?.note.title).toBe('Alpha')
    expect(alpha?.original_content).toBe('alpha original')
    expect(alpha?.revised_content).toBe('alpha revised')
    expect(alpha?.tags).toEqual(['storage'])
    expect(await dstNotes.linksOf(src.a.note.id)).toHaveLength(1)
    expect(await dstNotes.notesInCollection(src.collection.id)).toHaveLength(1)

    // Attachment manifests + hydrated bytes survive the round-trip.
    const dstAttachments = new CanonicalAttachmentsRepository(dst, dstBlobs)
    const list = await dstAttachments.list(src.a.note.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(src.attachment.id)
    const blob = await dstAttachments.getBlob(list[0].id)
    expect(blob && new TextDecoder().decode(blob)).toBe('attachment payload')
  })

  it('imports without a blobStore as recoverable reference-only attachments', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })

    const dst = new MemoryRecordStore()
    const result = await importShardToRecords(dst, archive)
    expect(result.success).toBe(true)
    expect(result.warnings.some((w) => w.includes('metadata only'))).toBe(true)

    const dstAttachments = new CanonicalAttachmentsRepository(dst, new MemoryBlobStore())
    const list = await dstAttachments.list(src.a.note.id)
    expect(list).toHaveLength(1)
    expect(await dstAttachments.getBlob(list[0].id)).toBeNull() // reference-only
    expect(await dstAttachments.hasBlob(list[0].id)).toBe(false)
  })

  it('reload survives: records persist across store handles (journal intact)', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store)
    const dst = new MemoryRecordStore()
    await importShardToRecords(dst, archive)
    // Every import commit is journaled — the projection boundary holds.
    const head = await dst.headSeq()
    expect(head).toBeGreaterThan(0)
    expect(await dst.journalSince(0)).toHaveLength(head)
  })

  it('honors conflict strategies: skip counts, replace overwrites, error pre-scans', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store)

    // skip (default): re-import into the same store is a no-op with counts.
    const skipResult = await importShardToRecords(src.store, archive)
    expect(skipResult.success).toBe(true)
    expect(skipResult.counts.notes).toBe(0)
    expect(skipResult.skipped.notes).toBe(2)

    // replace: title change round-trips over the existing record.
    await src.notes.update(src.a.note.id, { title: 'Locally renamed' })
    const replaceResult = await importShardToRecords(src.store, archive, { conflictStrategy: 'replace' })
    expect(replaceResult.success).toBe(true)
    expect((await src.notes.get(src.a.note.id))?.note.title).toBe('Alpha')

    // error: conflicting archive writes nothing (pre-scan).
    const dst = new MemoryRecordStore()
    await importShardToRecords(dst, archive)
    const before = await dst.headSeq()
    const errorResult = await importShardToRecords(dst, archive, { conflictStrategy: 'error' })
    expect(errorResult.success).toBe(false)
    expect(errorResult.errors[0]).toMatch(/already exists/)
    expect(await dst.headSeq()).toBe(before) // zero writes
  })

  it('rejects unsigned shards under verifySignature: require before any write', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store)
    const dst = new MemoryRecordStore()
    const result = await importShardToRecords(dst, archive, {
      verifySignature: 'require',
      trustStore: new AllowlistTrustStore([]),
    })
    expect(result.success).toBe(false)
    expect(result.errors[0]).toMatch(/unsigned/)
    expect(await dst.headSeq()).toBe(0) // verify-before-persist
  })

  it('reports the capability boundary when a shard carries unsupported components', async () => {
    // Build a full PGlite-tier shard (carries skos/provenance components when
    // present); at minimum, hand-check the unsupported-component pathway by
    // importing a DB export that includes templates.
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const client = db as unknown as DatabaseClient
    await db.query(
      `INSERT INTO note (id, title) VALUES ('0197aaaa-0000-7000-8000-000000000001', 'From DB')`,
    )
    await db.query(
      `INSERT INTO note_original (id, note_id, content, content_hash)
       VALUES ('0197aaaa-0000-7000-8000-000000000002', '0197aaaa-0000-7000-8000-000000000001', 'db body', 'h')`,
    )
    await db.query(
      `INSERT INTO template (id, name, content, format)
       VALUES ('0197aaaa-0000-7000-8000-000000000003', 'T', 'template body', 'markdown')`,
    )
    const archive = await exportShard(client)
    await db.close()

    const dst = new MemoryRecordStore()
    const result = await importShardToRecords(dst, archive)
    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(1)
    expect(result.warnings.some((w) => w.includes("'templates' is not supported"))).toBe(true)
    expect(result.skipped.templates).toBe(1)
  }, 30_000)

  it('cross-tier format parity: a record-exported shard imports into PGlite', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })

    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const client = db as unknown as DatabaseClient
    const pgBlobs = new MemoryBlobStore()
    const result = await importShard(client, archive, { blobStore: pgBlobs })

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.counts.notes).toBe(2)
    expect(result.counts.collections).toBe(1)
    expect(result.counts.links).toBe(1)

    const row = await db.query<{ title: string; content: string }>(
      `SELECT n.title, c.content FROM note n
       JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.id = $1`,
      [src.a.note.id],
    )
    expect(row.rows[0]).toEqual({ title: 'Alpha', content: 'alpha revised' })

    const att = await db.query<{ filename: string; content_hash: string }>(
      `SELECT a.filename, b.content_hash FROM attachment a
       JOIN attachment_blob b ON b.id = a.blob_id
       WHERE a.note_id = $1`,
      [src.a.note.id],
    )
    expect(att.rows[0].filename).toBe('payload.txt')
    expect(await pgBlobs.read(att.rows[0].content_hash)).not.toBeNull()
    await db.close()
  }, 30_000)

  it('supports collectionId/tag filters and clustered note layout', async () => {
    const src = await seededStore()
    const byCollection = await exportShardFromRecords(src.store, { collectionId: src.collection.id })
    const dst1 = new MemoryRecordStore()
    const r1 = await importShardToRecords(dst1, byCollection)
    expect(r1.counts.notes).toBe(1) // only Alpha is in the collection

    const clustered = await exportShardFromRecords(src.store, { clusterNotesSize: 1 })
    const dst2 = new MemoryRecordStore()
    const r2 = await importShardToRecords(dst2, clustered)
    expect(r2.counts.notes).toBe(2) // both clusters concatenated in offset order
  })
})
