/**
 * PGlite record-projection rebuild parity (#323 cycle 2 / #322 acceptance) —
 * canonical records are the source of truth; the full PGlite projection
 * (notes + attachments) is derived, idempotent, and can be dropped and
 * rebuilt with row-for-row parity without touching canonical records or
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
  projectNotes,
  projectRecords,
  dropNoteProjection,
} from '../../records/record-projection.js'
import { dropAttachmentProjection } from '../../records/attachment-projection.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { MemoryBlobStore } from '../../blob-store.js'
import type { DatabaseClient } from '../../storage-backend.js'

const bytes = (s: string) => new TextEncoder().encode(s)

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

interface ProjectedState {
  notes: Array<Record<string, unknown>>
  originals: Array<Record<string, unknown>>
  revised: Array<Record<string, unknown>>
  tags: Array<Record<string, unknown>>
  links: Array<Record<string, unknown>>
  collections: Array<Record<string, unknown>>
  memberships: Array<Record<string, unknown>>
}

async function readProjection(db: PGlite): Promise<ProjectedState> {
  const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows
  return {
    notes: await q(`SELECT id, title, format, source, visibility, is_starred, is_pinned,
                           is_archived, deleted_at IS NULL AS active FROM note ORDER BY id`),
    originals: await q(`SELECT id, note_id, content, content_hash FROM note_original ORDER BY id`),
    revised: await q(`SELECT note_id, content, generation_count, is_user_edited
                      FROM note_revised_current ORDER BY note_id`),
    tags: await q(`SELECT note_id, tag FROM note_tag ORDER BY note_id, tag`),
    links: await q(`SELECT id, source_note_id, target_note_id, link_type,
                           deleted_at IS NULL AS active FROM link ORDER BY id`),
    collections: await q(`SELECT id, name, description, parent_id FROM collection ORDER BY id`),
    memberships: await q(`SELECT collection_id, note_id FROM collection_note
                          ORDER BY collection_id, note_id`),
  }
}

async function seededCanon() {
  const store = new MemoryRecordStore()
  const blobStore = new MemoryBlobStore()
  const notes = new CanonicalNotesRepository(store)
  const attachments = new CanonicalAttachmentsRepository(store, blobStore)

  const a = await notes.create({ title: 'Alpha', content: 'alpha body' })
  await notes.update(a.note.id, { content: 'alpha revised', is_starred: true })
  const b = await notes.create({ title: 'Beta', content: 'beta body' })
  await notes.softDelete(b.note.id) // soft-delete travels through projection
  await notes.addTag(a.note.id, 'storage')
  await notes.addTag(a.note.id, 'projection')
  await notes.createLink(a.note.id, b.note.id, 'related')
  const parentCollection = await notes.createCollection('Research')
  const collection = await notes.createCollection('Active research', undefined, parentCollection.id)
  await notes.addNoteToCollection(collection.id, a.note.id)
  await attachments.attach({
    noteId: a.note.id,
    data: bytes('payload'),
    filename: 'payload.txt',
    mimeType: 'text/plain',
  })

  return { store, blobStore, notes, attachments, a, b, parentCollection, collection }
}

describe('record projection — rebuild parity (#323/#322)', () => {
  it('projects canonical records into PGlite with queryable parity', async () => {
    const canon = await seededCanon()
    const db = await setupDb()
    const client = db as unknown as DatabaseClient

    const result = await projectRecords(client, canon.store)
    expect(result.notes).toBe(2)
    expect(result.tags).toBe(2)
    expect(result.links).toBe(1)
    expect(result.collections).toBe(2)
    expect(result.memberships).toBe(1)
    expect(result.attachments.attachments).toBe(1)

    // The projected rows answer through the standard SQL repository — the
    // same query tier the PGlite backend serves.
    const sqlNotes = new NotesRepository(client)
    const alpha = await sqlNotes.get(canon.a.note.id)
    expect(alpha.title).toBe('Alpha')
    expect(alpha.current.content).toBe('alpha revised')
    expect(alpha.is_starred).toBe(true)
    expect(alpha.tags.sort()).toEqual(['projection', 'storage'])
    expect(
      (await db.query<{ parent_id: string | null }>(
        `SELECT parent_id FROM collection WHERE id = $1`,
        [canon.collection.id],
      )).rows[0]?.parent_id,
    ).toBe(canon.parentCollection.id)

    // Soft-deleted note projects its deleted_at (excluded from list).
    const listed = await sqlNotes.list({})
    expect(listed.items.map((n) => n.id)).toEqual([canon.a.note.id])

    await db.close()
  }, 30_000)

  it('is idempotent and reconciles canonical mutations including hard removals', async () => {
    const canon = await seededCanon()
    const db = await setupDb()
    const client = db as unknown as DatabaseClient

    await projectRecords(client, canon.store)
    const first = await readProjection(db)

    // Re-projecting identical canonical state changes nothing.
    await projectRecords(client, canon.store)
    expect(await readProjection(db)).toEqual(first)

    // Mutate canon: rename, remove a tag (hard removal), unlink membership path.
    await canon.notes.update(canon.a.note.id, { title: 'Alpha 2' })
    await canon.notes.removeTag(canon.a.note.id, 'projection')
    await projectRecords(client, canon.store)

    const after = await readProjection(db)
    expect(after.notes.find((n) => n.id === canon.a.note.id)?.title).toBe('Alpha 2')
    expect(after.tags).toEqual([{ note_id: canon.a.note.id, tag: 'storage' }])

    await db.close()
  }, 30_000)

  it('drop + rebuild yields parity without touching canonical records or bytes', async () => {
    const canon = await seededCanon()
    const db = await setupDb()
    const client = db as unknown as DatabaseClient

    await projectRecords(client, canon.store)
    const before = await readProjection(db)
    const canonHeadBefore = await canon.store.headSeq()
    const [blobRecord] = await canon.store.list('attachment_blob')

    // Drop the entire projection (children first), then rebuild from canon.
    await dropAttachmentProjection(client)
    await dropNoteProjection(client)
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM note`)).rows[0]).toEqual({ n: 0 })

    await projectRecords(client, canon.store)
    expect(await readProjection(db)).toEqual(before)

    // Canonical substrate untouched by projection lifecycle (#322 invariant).
    expect(await canon.store.headSeq()).toBe(canonHeadBefore)
    expect(await canon.blobStore.has(blobRecord.content_hash)).toBe(true)

    await db.close()
  }, 30_000)

  it('projectNotes alone lands parents so the attachment projection can follow', async () => {
    const canon = await seededCanon()
    const db = await setupDb()
    const client = db as unknown as DatabaseClient

    const result = await projectNotes(client, canon.store)
    expect(result.notes).toBe(2)
    // FK parents exist; attachment pass succeeds afterwards.
    const { projectAttachments } = await import('../../records/attachment-projection.js')
    const attachmentResult = await projectAttachments(client, canon.store)
    expect(attachmentResult.attachments).toBe(1)

    await db.close()
  }, 30_000)
})
