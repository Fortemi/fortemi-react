/**
 * DB-free conformance — canonical repositories over RecordStore + BlobStore
 * with no PGlite anywhere (#323 acceptance: CRUD, tags/links/collections,
 * attachments, reload, reconciliation).
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect } from 'vitest'
import { createRecordStore } from '../../records/idb-record-store.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../../records/canonical-notes-repository.js'
import { CanonicalAttachmentsRepository } from '../../records/canonical-attachments-repository.js'
import { MemoryBlobStore, createBlobStore } from '../../blob-store.js'
import { computeBlobHash } from '../../hash.js'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('CanonicalNotesRepository (DB-free)', () => {
  const makeRepo = () => new CanonicalNotesRepository(new MemoryRecordStore())

  it('creates, reads, updates, soft-deletes, and restores a note', async () => {
    const repo = makeRepo()
    const created = await repo.create({ title: 'First', content: 'hello world' })
    expect(created.note.title).toBe('First')
    expect(created.original_content).toBe('hello world')
    expect(created.revised_content).toBe('hello world')

    const updated = await repo.update(created.note.id, { title: 'Renamed', content: 'edited' })
    expect(updated.note.title).toBe('Renamed')
    expect(updated.revised_content).toBe('edited')
    // note_original is immutable — the original text is preserved.
    expect(updated.original_content).toBe('hello world')

    await repo.softDelete(created.note.id)
    expect((await repo.get(created.note.id))?.note.deleted_at).not.toBeNull()
    expect(await repo.listRecent()).toHaveLength(0)

    await repo.restore(created.note.id)
    expect((await repo.get(created.note.id))?.note.deleted_at).toBeNull()
    expect(await repo.listRecent()).toHaveLength(1)
  })

  it('supports tag add/remove/query with UNIQUE(note_id, tag) semantics', async () => {
    const repo = makeRepo()
    const a = await repo.create({ content: 'a' })
    const b = await repo.create({ content: 'b' })

    await repo.addTag(a.note.id, 'shared')
    await repo.addTag(a.note.id, 'shared') // duplicate no-ops
    await repo.addTag(b.note.id, 'shared')
    await repo.addTag(b.note.id, 'only-b')

    expect((await repo.get(a.note.id))?.tags).toEqual(['shared'])
    expect(await repo.notesByTag('shared')).toHaveLength(2)

    await repo.removeTag(b.note.id, 'shared')
    expect(await repo.notesByTag('shared')).toHaveLength(1)
  })

  it('creates and soft-deletes links; linksOf sees both directions', async () => {
    const repo = makeRepo()
    const a = await repo.create({ content: 'a' })
    const b = await repo.create({ content: 'b' })

    const link = await repo.createLink(a.note.id, b.note.id, 'reference')
    expect(await repo.linksOf(a.note.id)).toHaveLength(1)
    expect(await repo.linksOf(b.note.id)).toHaveLength(1)

    await repo.softDeleteLink(link.id)
    expect(await repo.linksOf(a.note.id)).toHaveLength(0)
  })

  it('collections group notes', async () => {
    const repo = makeRepo()
    const a = await repo.create({ content: 'a' })
    const b = await repo.create({ content: 'b' })
    const col = await repo.createCollection('Reading list', 'queue')

    await repo.addNoteToCollection(col.id, a.note.id)
    await repo.addNoteToCollection(col.id, a.note.id) // duplicate no-ops
    await repo.addNoteToCollection(col.id, b.note.id)
    expect(await repo.notesInCollection(col.id)).toHaveLength(2)
  })

  it('bounded text scan matches titles and revised content, skipping deleted notes', async () => {
    const repo = makeRepo()
    const hit = await repo.create({ title: 'Kepler notes', content: 'orbital mechanics' })
    await repo.create({ title: 'Grocery', content: 'milk, eggs' })
    const deleted = await repo.create({ title: 'Kepler junk', content: 'old' })
    await repo.softDelete(deleted.note.id)

    const byTitle = await repo.searchText('kepler')
    expect(byTitle.map((n) => n.id)).toEqual([hit.note.id])
    const byContent = await repo.searchText('orbital')
    expect(byContent.map((n) => n.id)).toEqual([hit.note.id])
  })
})

describe('CanonicalAttachmentsRepository (DB-free, Bytecask bytes)', () => {
  it('attach/read/dedupe/soft-delete/reconcile/gc without PGlite', async () => {
    const store = new MemoryRecordStore()
    const blobStore = new MemoryBlobStore()
    const notes = new CanonicalNotesRepository(store)
    const attachments = new CanonicalAttachmentsRepository(store, blobStore)

    const note = await notes.create({ content: 'host note' })
    const a = await attachments.attach({
      noteId: note.note.id,
      data: bytes('same payload'),
      filename: 'a.bin',
    })
    const b = await attachments.attach({
      noteId: note.note.id,
      data: bytes('same payload'),
      filename: 'b.bin',
    })

    // Dedup: one blob record, two manifests.
    expect(b.blob_id).toBe(a.blob_id)
    expect(await attachments.list(note.note.id)).toHaveLength(2)
    expect(await attachments.getBlob(a.id)).toEqual(bytes('same payload'))

    // Soft-delete both manifests → bytes become unreferenced, then gc-able.
    await attachments.delete(a.id)
    await attachments.delete(b.id)
    const reconciled = await attachments.reconcileBlobs()
    expect(reconciled.unreferenced).toHaveLength(1)
    const gc = await attachments.gcBlobs({ minAgeMs: 0 })
    expect(gc.collected).toBe(1)
    expect(await attachments.getBlob(a.id)).toBeNull() // reference-only now
  })

  it('full DB-free flow survives close/reload with durable stores', async () => {
    const factory = new IDBFactory()

    // Session 1: create → tag → attach.
    {
      const store = await createRecordStore('dbfree', { indexedDB: factory })
      const blobStore = await createBlobStore('dbfree', { indexedDB: factory })
      const notes = new CanonicalNotesRepository(store)
      const attachments = new CanonicalAttachmentsRepository(store, blobStore)

      const note = await notes.create({ title: 'Persistent', content: 'body text' })
      await notes.addTag(note.note.id, 'keep')
      await attachments.attach({
        noteId: note.note.id,
        data: bytes('attached bytes'),
        filename: 'file.bin',
      })
      await store.close()
      await blobStore.close()
    }

    // Session 2: everything is still there; reconcile reports no gaps.
    {
      const store = await createRecordStore('dbfree', { indexedDB: factory })
      const blobStore = await createBlobStore('dbfree', { indexedDB: factory })
      const notes = new CanonicalNotesRepository(store)
      const attachments = new CanonicalAttachmentsRepository(store, blobStore)

      const recent = await notes.listRecent()
      expect(recent).toHaveLength(1)
      const view = await notes.get(recent[0].id)
      expect(view?.revised_content).toBe('body text')
      expect(view?.tags).toEqual(['keep'])

      const list = await attachments.list(recent[0].id)
      expect(list).toHaveLength(1)
      expect(await attachments.getBlob(list[0].id)).toEqual(bytes('attached bytes'))

      const reconciled = await attachments.reconcileBlobs()
      expect(reconciled.missing).toEqual([])
      expect(reconciled.referenced).toBe(1)
      await store.close()
      await blobStore.close()
    }
  })

  it('startup reconciliation flags interrupted writes and missing bytes', async () => {
    const store = new MemoryRecordStore()
    const blobStore = new MemoryBlobStore()
    const notes = new CanonicalNotesRepository(store)
    const attachments = new CanonicalAttachmentsRepository(store, blobStore)

    const note = await notes.create({ content: 'n' })
    const kept = await attachments.attach({
      noteId: note.note.id,
      data: bytes('kept'),
      filename: 'kept.bin',
    })
    const evicted = await attachments.attach({
      noteId: note.note.id,
      data: bytes('evicted'),
      filename: 'evicted.bin',
    })
    // Interrupted attach: bytes landed (bytes-first ordering) but the
    // manifest never committed → orphan.
    await blobStore.put(bytes('orphan'))

    const before = await attachments.reconcileBlobs()
    expect(before.referenced).toBe(2)
    expect(before.missing).toEqual([])
    expect(before.unreferenced).toEqual([computeBlobHash(bytes('orphan'))])

    // Simulate storage eviction of one live payload (and sweep the orphan).
    await blobStore.reconcile([computeBlobHash(bytes('kept'))], { removeUnreferenced: true })

    const after = await attachments.reconcileBlobs()
    expect(after.referenced).toBe(1)
    expect(after.missing).toEqual([computeBlobHash(bytes('evicted'))]) // reference-only
    expect(after.unreferenced).toEqual([])
    expect(await attachments.hasBlob(evicted.id)).toBe(false)
    expect(await attachments.hasBlob(kept.id)).toBe(true)
  })
})
