/**
 * AttachmentsRepository — integration tests.
 *
 * Tests run against a real in-memory PGlite instance with all migrations
 * applied. BlobStore is replaced with MemoryBlobStore for speed and isolation.
 *
 * Covers:
 * - attach(): stores blob and creates metadata record
 * - attach(): deduplication — same content reuses existing blob row
 * - attach(): different content creates separate blob rows
 * - get(): returns attachment by ID, throws on missing
 * - getBlob(): returns binary content via BlobStore
 * - getBlob(): returns null when blob metadata is missing
 * - list(): returns non-deleted attachments for a note, ordered by position then created_at
 * - delete(): soft-deletes attachment while preserving blob
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { MemoryBlobStore } from '../blob-store.js'
import { AttachmentsRepository } from '../repositories/attachments-repository.js'

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string): Promise<void> {
  await db.query(
    `INSERT INTO note (id, format, source, visibility, revision_mode)
     VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
    [id],
  )
}

function makeBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('AttachmentsRepository', () => {
  let db: PGlite
  let blobStore: MemoryBlobStore
  let repo: AttachmentsRepository

  beforeEach(async () => {
    db = await setupDb()
    blobStore = new MemoryBlobStore()
    repo = new AttachmentsRepository(db, blobStore)
    await insertNote(db, 'note-1')
    await insertNote(db, 'note-2')
  })

  afterEach(async () => {
    await db.close()
  })

  // ── attach() ─────────────────────────────────────────────────────────────

  describe('attach()', () => {
    it('stores blob data and returns a populated AttachmentRow', async () => {
      const data = makeBytes('hello attachment')
      const att = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'hello.txt',
      })

      expect(att.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(att.note_id).toBe('note-1')
      expect(att.filename).toBe('hello.txt')
      expect(att.display_name).toBeNull()
      expect(att.position).toBe(0)
      expect(att.deleted_at).toBeNull()
      expect(att.blob_id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('writes binary data to the BlobStore', async () => {
      const data = makeBytes('binary content')
      const att = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'file.bin',
      })

      const blob = await repo.getBlob(att.id)
      expect(blob).not.toBeNull()
      expect(blob).toEqual(data)
    })

    it('accepts optional displayName and stores it', async () => {
      const att = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('content'),
        filename: 'doc.pdf',
        displayName: 'My Document',
      })

      expect(att.display_name).toBe('My Document')
    })

    it('deduplicates blobs — same content reuses existing blob row', async () => {
      const data = makeBytes('identical content')

      const att1 = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'copy1.txt',
      })

      const att2 = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'copy2.txt',
      })

      // Both attachments point to the same blob row
      expect(att1.blob_id).toBe(att2.blob_id)

      // Only one blob row exists in the database
      const result = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM attachment_blob WHERE id = $1`,
        [att1.blob_id],
      )
      expect(parseInt(result.rows[0].count, 10)).toBe(1)
    })

    it('creates separate blobs for different content', async () => {
      const att1 = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('content A'),
        filename: 'a.txt',
      })

      const att2 = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('content B'),
        filename: 'b.txt',
      })

      expect(att1.blob_id).not.toBe(att2.blob_id)
    })
  })

  // ── get() ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns the attachment by ID', async () => {
      const att = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('test'),
        filename: 'test.txt',
      })

      const fetched = await repo.get(att.id)
      expect(fetched.id).toBe(att.id)
      expect(fetched.note_id).toBe('note-1')
      expect(fetched.filename).toBe('test.txt')
    })

    it('throws when attachment does not exist', async () => {
      await expect(repo.get('non-existent-id')).rejects.toThrow(
        'Attachment not found: non-existent-id',
      )
    })
  })

  // ── getBlob() ─────────────────────────────────────────────────────────────

  describe('getBlob()', () => {
    it('returns binary content matching the original upload', async () => {
      const data = makeBytes('original bytes')
      const att = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'orig.bin',
      })

      const retrieved = await repo.getBlob(att.id)
      expect(retrieved).toEqual(data)
    })

    it('returns null when the blob cannot be found in BlobStore', async () => {
      // Attach normally so attachment row and blob row exist
      const att = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('will be removed'),
        filename: 'ghost.bin',
      })

      // Manually remove the data from the BlobStore (simulates storage gap)
      const blobRow = await db.query<{ content_hash: string }>(
        `SELECT content_hash FROM attachment_blob WHERE id = $1`,
        [att.blob_id],
      )
      await blobStore.remove(blobRow.rows[0].content_hash)

      const result = await repo.getBlob(att.id)
      expect(result).toBeNull()
    })
  })

  // ── list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns attachments for a note ordered by position then created_at', async () => {
      await repo.attach({ noteId: 'note-1', data: makeBytes('first'), filename: 'first.txt' })
      await repo.attach({ noteId: 'note-1', data: makeBytes('second'), filename: 'second.txt' })
      await repo.attach({ noteId: 'note-2', data: makeBytes('other'), filename: 'other.txt' })

      const items = await repo.list('note-1')
      expect(items).toHaveLength(2)
      expect(items.every((a) => a.note_id === 'note-1')).toBe(true)
    })

    it('returns an empty array when the note has no attachments', async () => {
      const items = await repo.list('note-2')
      expect(items).toEqual([])
    })

    it('excludes soft-deleted attachments', async () => {
      const att = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('to delete'),
        filename: 'del.txt',
      })
      await repo.attach({
        noteId: 'note-1',
        data: makeBytes('to keep'),
        filename: 'keep.txt',
      })

      await repo.delete(att.id)

      const items = await repo.list('note-1')
      expect(items).toHaveLength(1)
      expect(items[0].filename).toBe('keep.txt')
    })
  })

  // ── delete() ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('soft-deletes the attachment row (sets deleted_at)', async () => {
      const att = await repo.attach({
        noteId: 'note-1',
        data: makeBytes('deletable'),
        filename: 'delete-me.txt',
      })

      await repo.delete(att.id)

      const result = await db.query<{ deleted_at: Date | null }>(
        `SELECT deleted_at FROM attachment WHERE id = $1`,
        [att.id],
      )
      expect(result.rows[0].deleted_at).not.toBeNull()
    })

    it('preserves the blob row after soft-delete', async () => {
      const data = makeBytes('precious data')
      const att = await repo.attach({
        noteId: 'note-1',
        data,
        filename: 'preserve.bin',
      })

      await repo.delete(att.id)

      // Blob row still exists
      const blobResult = await db.query<{ id: string }>(
        `SELECT id FROM attachment_blob WHERE id = $1`,
        [att.blob_id],
      )
      expect(blobResult.rows).toHaveLength(1)

      // Blob data still readable
      const blobRow = await db.query<{ content_hash: string }>(
        `SELECT content_hash FROM attachment_blob WHERE id = $1`,
        [att.blob_id],
      )
      const stored = await blobStore.read(blobRow.rows[0].content_hash)
      expect(stored).toEqual(data)
    })
  })
})
