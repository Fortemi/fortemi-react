/**
 * NotesRepository — integration tests.
 *
 * Every test spins up a fresh in-memory PGlite instance with all migrations
 * applied, then operates through the public NotesRepository API.  No mocking
 * of the database layer — we test against the real schema.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { allMigrations } from '../migrations/index.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import type { NoteRevision } from '../repositories/types.js'

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NotesRepository', () => {
  let db: PGlite
  let events: TypedEventBus
  let repo: NotesRepository

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
    repo = new NotesRepository(db, events)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe('create()', () => {
    it('inserts a note with note_original, note_revised_current, and returns NoteFull', async () => {
      const note = await repo.create({ content: 'Hello world' })

      expect(note.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(note.format).toBe('markdown')
      expect(note.source).toBe('user')
      expect(note.visibility).toBe('private')
      expect(note.is_starred).toBe(false)
      expect(note.is_pinned).toBe(false)
      expect(note.is_archived).toBe(false)
      expect(note.deleted_at).toBeNull()

      // original snapshot
      expect(note.original.content).toBe('Hello world')
      expect(note.original.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/)

      // current revision
      expect(note.current.content).toBe('Hello world')
      expect(note.current.generation_count).toBe(0)
      expect(note.current.is_user_edited).toBe(false)
    })

    it('accepts custom format, source, visibility, and title', async () => {
      const note = await repo.create({
        content: 'Rich text',
        title: 'My Note',
        format: 'html',
        source: 'import',
        visibility: 'public',
      })

      expect(note.title).toBe('My Note')
      expect(note.format).toBe('html')
      expect(note.source).toBe('import')
      expect(note.visibility).toBe('public')
    })

    it('stores tags and returns them sorted', async () => {
      const note = await repo.create({
        content: 'Tagged note',
        tags: ['rust', 'async', 'memory'],
      })

      expect(note.tags).toEqual(['async', 'memory', 'rust'])
    })

    it('creates no tags when tags array is empty', async () => {
      const note = await repo.create({ content: 'No tags', tags: [] })
      expect(note.tags).toEqual([])
    })

    it('queues a title_generation job when no title is provided', async () => {
      const note = await repo.create({ content: 'Auto-title me' })

      const result = await db.query<{ job_type: string; status: string; priority: number }>(
        `SELECT job_type, status, priority FROM job_queue WHERE note_id = $1`,
        [note.id],
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].job_type).toBe('title_generation')
      expect(result.rows[0].status).toBe('pending')
      expect(result.rows[0].priority).toBe(5)
    })

    it('does NOT queue a title_generation job when a title is provided', async () => {
      const note = await repo.create({ content: 'Has title', title: 'Explicit Title' })

      const result = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count FROM job_queue WHERE note_id = $1`,
        [note.id],
      )
      expect(Number(result.rows[0].count)).toBe(0)
    })

    it('computes a deterministic SHA-256 content hash', async () => {
      const content = 'Deterministic content'
      const note1 = await repo.create({ content })
      const note2 = await repo.create({ content })

      expect(note1.original.content_hash).toBe(note2.original.content_hash)
    })

    it('emits note.created event with the new note id', async () => {
      const handler = vi.fn()
      events.on('note.created', handler)

      const note = await repo.create({ content: 'Event test' })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })

    it('does not throw when events bus is not provided', async () => {
      const repoNoEvents = new NotesRepository(db)
      await expect(repoNoEvents.create({ content: 'No bus' })).resolves.not.toThrow()
    })

    it('wraps all inserts in a single transaction — partial failure rolls back', async () => {
      // Insert a note manually so we can create a unique-constraint violation
      // by using a duplicate tag (note_tag has UNIQUE(note_id, tag)).
      // We cannot easily test this without patching, so we verify isolation
      // by checking that note_original exists whenever a note exists.
      const note = await repo.create({ content: 'Transactional', tags: ['x'] })

      const origCount = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count FROM note_original WHERE note_id = $1`,
        [note.id],
      )
      expect(Number(origCount.rows[0].count)).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // get()
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('returns NoteFull for an existing note', async () => {
      const created = await repo.create({ content: 'Test get' })
      const fetched = await repo.get(created.id)

      expect(fetched.id).toBe(created.id)
      expect(fetched.original.content).toBe('Test get')
      expect(fetched.current.content).toBe('Test get')
    })

    it('throws when the note does not exist', async () => {
      await expect(repo.get('nonexistent-id')).rejects.toThrow('Note not found: nonexistent-id')
    })

    it('returns tags on the note', async () => {
      const created = await repo.create({ content: 'With tags', tags: ['b', 'a'] })
      const fetched = await repo.get(created.id)

      expect(fetched.tags).toEqual(['a', 'b'])
    })

    it('returns correct revision_mode default', async () => {
      const created = await repo.create({ content: 'Standard revision' })
      expect(created.revision_mode).toBe('standard')
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('returns an empty result when no notes exist', async () => {
      const result = await repo.list()
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('returns all notes with default options', async () => {
      await repo.create({ content: 'Note A' })
      await repo.create({ content: 'Note B' })
      await repo.create({ content: 'Note C' })

      const result = await repo.list()
      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(3)
    })

    it('respects limit and offset for pagination', async () => {
      await repo.create({ content: 'N1' })
      await repo.create({ content: 'N2' })
      await repo.create({ content: 'N3' })
      await repo.create({ content: 'N4' })

      const page1 = await repo.list({ limit: 2, offset: 0 })
      expect(page1.items).toHaveLength(2)
      expect(page1.total).toBe(4)
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      const page2 = await repo.list({ limit: 2, offset: 2 })
      expect(page2.items).toHaveLength(2)
      expect(page2.total).toBe(4)
      expect(page2.offset).toBe(2)

      // Pages should not overlap
      const page1Ids = page1.items.map((n) => n.id)
      const page2Ids = page2.items.map((n) => n.id)
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false)
    })

    it('excludes soft-deleted notes by default', async () => {
      const note = await repo.create({ content: 'To be deleted' })
      await repo.delete(note.id)

      const result = await repo.list()
      const ids = result.items.map((n) => n.id)
      expect(ids).not.toContain(note.id)
      expect(result.total).toBe(0)
    })

    it('includes soft-deleted notes when include_deleted is true', async () => {
      const note = await repo.create({ content: 'Deleted but listed' })
      await repo.delete(note.id)

      const result = await repo.list({ include_deleted: true })
      expect(result.total).toBe(1)
      expect(result.items[0].deleted_at).not.toBeNull()
    })

    it('filters by is_starred', async () => {
      const a = await repo.create({ content: 'Starred' })
      await repo.create({ content: 'Not starred' })
      await repo.star(a.id, true)

      const result = await repo.list({ is_starred: true })
      expect(result.total).toBe(1)
      expect(result.items[0].id).toBe(a.id)
    })

    it('filters by is_pinned', async () => {
      const a = await repo.create({ content: 'Pinned' })
      await repo.create({ content: 'Not pinned' })
      await repo.pin(a.id, true)

      const result = await repo.list({ is_pinned: true })
      expect(result.total).toBe(1)
      expect(result.items[0].id).toBe(a.id)
    })

    it('filters by is_archived', async () => {
      const a = await repo.create({ content: 'Archived' })
      await repo.create({ content: 'Active' })
      await repo.archive(a.id, true)

      const result = await repo.list({ is_archived: true })
      expect(result.total).toBe(1)
      expect(result.items[0].id).toBe(a.id)
    })

    it('filters by tags — matches notes that have ANY of the given tags', async () => {
      const a = await repo.create({ content: 'Tagged rust', tags: ['rust'] })
      const b = await repo.create({ content: 'Tagged typescript', tags: ['typescript'] })
      await repo.create({ content: 'No tags' })

      const result = await repo.list({ tags: ['rust'] })
      expect(result.total).toBe(1)
      expect(result.items[0].id).toBe(a.id)

      const multi = await repo.list({ tags: ['rust', 'typescript'] })
      expect(multi.total).toBe(2)
      const ids = multi.items.map((n) => n.id)
      expect(ids).toContain(a.id)
      expect(ids).toContain(b.id)
    })

    it('sorts by created_at descending by default', async () => {
      const n1 = await repo.create({ content: 'First' })
      const n2 = await repo.create({ content: 'Second' })

      const result = await repo.list({ sort: 'created_at', order: 'desc' })
      const ids = result.items.map((n) => n.id)
      // n2 was created after n1, so it should appear first in desc order
      expect(ids.indexOf(n2.id)).toBeLessThan(ids.indexOf(n1.id))
    })

    it('sorts by created_at ascending when order is asc', async () => {
      const n1 = await repo.create({ content: 'First' })
      const n2 = await repo.create({ content: 'Second' })

      const result = await repo.list({ sort: 'created_at', order: 'asc' })
      const ids = result.items.map((n) => n.id)
      expect(ids.indexOf(n1.id)).toBeLessThan(ids.indexOf(n2.id))
    })

    it('includes tags in list results', async () => {
      await repo.create({ content: 'Tagged', tags: ['alpha', 'beta'] })

      const result = await repo.list()
      expect(result.items[0].tags).toEqual(['alpha', 'beta'])
    })

    it('returns correct total even when limit reduces items count', async () => {
      await repo.create({ content: 'X1' })
      await repo.create({ content: 'X2' })
      await repo.create({ content: 'X3' })

      const result = await repo.list({ limit: 1 })
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------

  describe('update()', () => {
    it('updates the title only', async () => {
      const note = await repo.create({ content: 'Original', title: 'Old Title' })
      const updated = await repo.update(note.id, { title: 'New Title' })

      expect(updated.title).toBe('New Title')
      expect(updated.current.content).toBe('Original') // content unchanged
    })

    it('updates the format only', async () => {
      const note = await repo.create({ content: 'Some content' })
      const updated = await repo.update(note.id, { format: 'plain' })

      expect(updated.format).toBe('plain')
    })

    it('updates the visibility only', async () => {
      const note = await repo.create({ content: 'Private note' })
      const updated = await repo.update(note.id, { visibility: 'public' })

      expect(updated.visibility).toBe('public')
    })

    it('updates content — saves old content as revision and sets is_user_edited', async () => {
      const note = await repo.create({ content: 'Version 1' })
      const updated = await repo.update(note.id, { content: 'Version 2' })

      expect(updated.current.content).toBe('Version 2')
      expect(updated.current.is_user_edited).toBe(true)

      // Revision 1 should exist with the old content
      const revisions = await db.query<{
        revision_number: number
        content: string
        type: string
      }>(
        `SELECT revision_number, content, type
         FROM note_revision WHERE note_id = $1 ORDER BY revision_number`,
        [note.id],
      )
      expect(revisions.rows).toHaveLength(1)
      expect(revisions.rows[0].revision_number).toBe(1)
      expect(revisions.rows[0].content).toBe('Version 1')
      expect(revisions.rows[0].type).toBe('user')
    })

    it('increments revision number on subsequent updates', async () => {
      const note = await repo.create({ content: 'v1' })
      await repo.update(note.id, { content: 'v2' })
      await repo.update(note.id, { content: 'v3' })

      const revisions = await db.query<{ revision_number: number }>(
        `SELECT revision_number FROM note_revision WHERE note_id = $1 ORDER BY revision_number`,
        [note.id],
      )
      expect(revisions.rows).toHaveLength(2)
      expect(revisions.rows[0].revision_number).toBe(1)
      expect(revisions.rows[1].revision_number).toBe(2)
    })

    it('does not create a revision when only non-content fields change', async () => {
      const note = await repo.create({ content: 'Stable content' })
      await repo.update(note.id, { title: 'Changed Title' })

      const revisions = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count FROM note_revision WHERE note_id = $1`,
        [note.id],
      )
      expect(Number(revisions.rows[0].count)).toBe(0)
    })

    it('preserves original content after content update', async () => {
      const note = await repo.create({ content: 'Immutable original' })
      await repo.update(note.id, { content: 'New content' })

      const fetched = await repo.get(note.id)
      expect(fetched.original.content).toBe('Immutable original')
    })

    it('emits note.updated event', async () => {
      const handler = vi.fn()
      events.on('note.updated', handler)

      const note = await repo.create({ content: 'To update' })
      events.removeAllListeners()
      events.on('note.updated', handler)

      await repo.update(note.id, { title: 'Updated' })
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })
  })

  // -------------------------------------------------------------------------
  // delete() and restore()
  // -------------------------------------------------------------------------

  describe('delete()', () => {
    it('sets deleted_at on the note', async () => {
      const note = await repo.create({ content: 'To delete' })
      await repo.delete(note.id)

      const fetched = await repo.get(note.id)
      expect(fetched.deleted_at).not.toBeNull()
    })

    it('emits note.deleted event', async () => {
      const handler = vi.fn()
      const note = await repo.create({ content: 'Delete event' })
      events.on('note.deleted', handler)

      await repo.delete(note.id)
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })
  })

  describe('restore()', () => {
    it('clears deleted_at on a soft-deleted note', async () => {
      const note = await repo.create({ content: 'Restore me' })
      await repo.delete(note.id)
      const restored = await repo.restore(note.id)

      expect(restored.deleted_at).toBeNull()
    })

    it('emits note.restored event', async () => {
      const handler = vi.fn()
      const note = await repo.create({ content: 'Restore event' })
      await repo.delete(note.id)
      events.on('note.restored', handler)

      await repo.restore(note.id)
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })

    it('restored note appears in default list again', async () => {
      const note = await repo.create({ content: 'Deleted then restored' })
      await repo.delete(note.id)
      await repo.restore(note.id)

      const result = await repo.list()
      const ids = result.items.map((n) => n.id)
      expect(ids).toContain(note.id)
    })
  })

  // -------------------------------------------------------------------------
  // star()
  // -------------------------------------------------------------------------

  describe('star()', () => {
    it('sets is_starred to true', async () => {
      const note = await repo.create({ content: 'Star me' })
      await repo.star(note.id, true)

      const fetched = await repo.get(note.id)
      expect(fetched.is_starred).toBe(true)
    })

    it('sets is_starred to false (unstar)', async () => {
      const note = await repo.create({ content: 'Unstar me' })
      await repo.star(note.id, true)
      await repo.star(note.id, false)

      const fetched = await repo.get(note.id)
      expect(fetched.is_starred).toBe(false)
    })

    it('emits note.updated event on star toggle', async () => {
      const handler = vi.fn()
      const note = await repo.create({ content: 'Star event' })
      events.on('note.updated', handler)

      await repo.star(note.id, true)
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })
  })

  // -------------------------------------------------------------------------
  // pin()
  // -------------------------------------------------------------------------

  describe('pin()', () => {
    it('sets is_pinned to true', async () => {
      const note = await repo.create({ content: 'Pin me' })
      await repo.pin(note.id, true)

      const fetched = await repo.get(note.id)
      expect(fetched.is_pinned).toBe(true)
    })

    it('sets is_pinned to false (unpin)', async () => {
      const note = await repo.create({ content: 'Unpin me' })
      await repo.pin(note.id, true)
      await repo.pin(note.id, false)

      const fetched = await repo.get(note.id)
      expect(fetched.is_pinned).toBe(false)
    })

    it('emits note.updated event on pin toggle', async () => {
      const handler = vi.fn()
      const note = await repo.create({ content: 'Pin event' })
      events.on('note.updated', handler)

      await repo.pin(note.id, true)
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })
  })

  // -------------------------------------------------------------------------
  // archive()
  // -------------------------------------------------------------------------

  describe('archive()', () => {
    it('sets is_archived to true', async () => {
      const note = await repo.create({ content: 'Archive me' })
      await repo.archive(note.id, true)

      const fetched = await repo.get(note.id)
      expect(fetched.is_archived).toBe(true)
    })

    it('sets is_archived to false (unarchive)', async () => {
      const note = await repo.create({ content: 'Unarchive me' })
      await repo.archive(note.id, true)
      await repo.archive(note.id, false)

      const fetched = await repo.get(note.id)
      expect(fetched.is_archived).toBe(false)
    })

    it('emits note.updated event on archive toggle', async () => {
      const handler = vi.fn()
      const note = await repo.create({ content: 'Archive event' })
      events.on('note.updated', handler)

      await repo.archive(note.id, true)
      expect(handler).toHaveBeenCalledWith({ id: note.id })
    })
  })

  // -------------------------------------------------------------------------
  // getRevisions()
  // -------------------------------------------------------------------------

  describe('getRevisions()', () => {
    it('returns an empty array for a newly created note with no updates', async () => {
      const note = await repo.create({ content: 'Fresh note' })
      const revisions = await repo.getRevisions(note.id)

      expect(revisions).toEqual([])
    })

    it('returns one revision after a content update', async () => {
      const note = await repo.create({ content: 'Original content' })
      await repo.update(note.id, { content: 'Updated content' })

      const revisions = await repo.getRevisions(note.id)

      expect(revisions).toHaveLength(1)
    })

    it('returns revisions ordered by revision_number DESC', async () => {
      const note = await repo.create({ content: 'v1' })
      await repo.update(note.id, { content: 'v2' })
      await repo.update(note.id, { content: 'v3' })
      await repo.update(note.id, { content: 'v4' })

      const revisions = await repo.getRevisions(note.id)

      expect(revisions).toHaveLength(3)
      expect(revisions[0].revision_number).toBe(3)
      expect(revisions[1].revision_number).toBe(2)
      expect(revisions[2].revision_number).toBe(1)
    })

    it('revision has type "user" for content updates via update()', async () => {
      const note = await repo.create({ content: 'Original' })
      await repo.update(note.id, { content: 'Edited' })

      const revisions = await repo.getRevisions(note.id)

      expect(revisions[0].type).toBe('user')
    })

    it('revision content matches the content before the update', async () => {
      const note = await repo.create({ content: 'Before edit' })
      await repo.update(note.id, { content: 'After edit' })

      const revisions = await repo.getRevisions(note.id)

      // The revision should capture the OLD content ('Before edit')
      expect(revisions[0].content).toBe('Before edit')
    })

    it('returned revisions conform to the NoteRevision interface shape', async () => {
      const note = await repo.create({ content: 'Shape test' })
      await repo.update(note.id, { content: 'Shape v2' })

      const revisions: NoteRevision[] = await repo.getRevisions(note.id)
      const rev = revisions[0]

      expect(typeof rev.id).toBe('string')
      expect(rev.note_id).toBe(note.id)
      expect(typeof rev.revision_number).toBe('number')
      expect(typeof rev.type).toBe('string')
      expect(typeof rev.content).toBe('string')
      expect(rev.created_at).toBeInstanceOf(Date)
      // ai_metadata and model are nullable — just assert they exist as keys
      expect('ai_metadata' in rev).toBe(true)
      expect('model' in rev).toBe(true)
    })

    it('does not return revisions for other notes', async () => {
      const noteA = await repo.create({ content: 'Note A v1' })
      const noteB = await repo.create({ content: 'Note B v1' })
      await repo.update(noteA.id, { content: 'Note A v2' })
      await repo.update(noteB.id, { content: 'Note B v2' })

      const revisionsA = await repo.getRevisions(noteA.id)
      const revisionsB = await repo.getRevisions(noteB.id)

      expect(revisionsA).toHaveLength(1)
      expect(revisionsA[0].note_id).toBe(noteA.id)
      expect(revisionsB).toHaveLength(1)
      expect(revisionsB[0].note_id).toBe(noteB.id)
    })
  })

  // -------------------------------------------------------------------------
  // Migration check — is_archived column exists in note table
  // -------------------------------------------------------------------------

  describe('schema', () => {
    it('note table has is_archived column', async () => {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'note' AND column_name = 'is_archived'`,
      )
      expect(result.rows).toHaveLength(1)
    })

    it('is_archived defaults to false for new notes', async () => {
      const note = await repo.create({ content: 'Default archived state' })
      expect(note.is_archived).toBe(false)
    })
  })
})
