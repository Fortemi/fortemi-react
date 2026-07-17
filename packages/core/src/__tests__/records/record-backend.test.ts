/**
 * Writable record-tier DataBackend conformance (#323 cycle 2) — the canonical
 * RecordStore served through the backend seam with zero PGlite: full CRUD via
 * manageNote, bounded reads, honest capability reporting, and seam selection.
 */

import { describe, it, expect } from 'vitest'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../../records/canonical-notes-repository.js'
import { createRecordBackend } from '../../records/record-backend.js'
import type { RecordBackendManageNoteResult } from '../../records/record-backend.js'
import { selectBackend } from '../../data-backend.js'

async function seededBackend() {
  const store = new MemoryRecordStore()
  const repo = new CanonicalNotesRepository(store)
  const a = await repo.create({ title: 'Alpha', content: 'alpha body about pglite' })
  // ISO timestamps have millisecond precision — ensure Beta is strictly newer
  // so the newest-first ordering assertion is deterministic.
  await new Promise((resolve) => setTimeout(resolve, 5))
  const b = await repo.create({ title: 'Beta', content: 'beta body about bytecask' })
  await repo.addTag(a.note.id, 'storage')
  await repo.addTag(b.note.id, 'storage')
  await repo.addTag(b.note.id, 'bytes')
  await repo.createLink(a.note.id, b.note.id, 'related')
  return { store, repo, backend: createRecordBackend(store), a, b }
}

describe('createRecordBackend (DB-free)', () => {
  it('advertises the record-tier capability set honestly', async () => {
    const { backend } = await seededBackend()
    expect(backend.capabilities).toEqual({
      read: true,
      write: true,
      merge: true,
      multiUser: false,
      semantic: 'none',
      startupCost: 'instant',
    })
    // SKOS / provenance are not canonical collections — the methods are
    // absent (feature-detectable), not silently empty.
    expect(backend.conceptsOf).toBeUndefined()
    expect(backend.provenanceOf).toBeUndefined()
    expect(backend.semantic).toBeUndefined()
  })

  it('lists notes newest-first with pagination and tags', async () => {
    const { backend, b } = await seededBackend()
    const all = await backend.listNotes()
    expect(all.total).toBe(2)
    expect(all.items[0].id).toBe(b.note.id) // most recently updated first
    expect(all.items[0].tags).toEqual(['bytes', 'storage'])

    const page = await backend.listNotes({ offset: 1, limit: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('serves getNote / getNoteFull / linksOf and hides soft-deleted notes', async () => {
    const { backend, repo, a, b } = await seededBackend()
    const note = await backend.getNote(a.note.id)
    expect(note?.title).toBe('Alpha')
    expect(note?.starred).toBe(false)

    const full = await backend.getNoteFull!(a.note.id)
    expect(full?.content).toBe('alpha body about pglite')
    expect(full?.links).toHaveLength(1)
    expect(full?.links?.[0].toNoteId).toBe(b.note.id)

    await repo.softDelete(a.note.id)
    expect(await backend.getNote(a.note.id)).toBeNull()
    expect(await backend.getNoteFull!(a.note.id)).toBeNull()
  })

  it('search is a bounded unranked scan with tag/source filters', async () => {
    const { backend } = await seededBackend()
    const hits = await backend.search('bytecask')
    expect(hits.total).toBe(1)
    expect(hits.hits[0].note.title).toBe('Beta')
    expect(hits.hits[0].rank).toBeUndefined() // unranked by contract

    const tagFiltered = await backend.search('body', { tags: ['bytes'] })
    expect(tagFiltered.hits.map((h) => h.note.title)).toEqual(['Beta'])

    const sourceFiltered = await backend.search('body', { source: ['nope'] })
    expect(sourceFiltered.total).toBe(0)
  })

  it('manageNote covers the full PGlite tool action surface', async () => {
    const { backend, a } = await seededBackend()
    const manage = (input: unknown) =>
      backend.manageNote!(input) as Promise<RecordBackendManageNoteResult>

    const updated = await manage({
      action: 'update', note_id: a.note.id, title: 'Alpha 2', content: 'new body', format: 'plain', visibility: 'public',
    })
    expect(updated.note?.note.title).toBe('Alpha 2')
    expect(updated.note?.revised_content).toBe('new body')
    expect(updated.note?.note.format).toBe('plain')
    expect(updated.note?.note.visibility).toBe('public')
    expect(updated.note?.original_content).toBe('alpha body about pglite') // immutable original

    expect((await manage({ action: 'star', note_id: a.note.id })).note?.note.is_starred).toBe(true)
    expect((await manage({ action: 'unstar', note_id: a.note.id })).note?.note.is_starred).toBe(false)
    expect((await manage({ action: 'archive', note_id: a.note.id })).note?.note.is_archived).toBe(true)
    expect((await manage({ action: 'unarchive', note_id: a.note.id })).note?.note.is_archived).toBe(false)

    await manage({ action: 'delete', note_id: a.note.id })
    expect(await backend.getNote(a.note.id)).toBeNull()
    await manage({ action: 'restore', note_id: a.note.id })
    expect((await backend.getNote(a.note.id))?.title).toBe('Alpha 2')

    await expect(manage({ action: 'explode', note_id: a.note.id })).rejects.toThrow()
  })

  it('is selectable through the seam as the lightest writable backend', async () => {
    const { backend } = await seededBackend()
    const selection = selectBackend({ read: true, write: true }, [backend])
    expect(selection.backend?.id).toBe('canonical-records')
    expect(selection.missing).toEqual([])
    // Semantic demands surface as missing — degrade with eyes open.
    const semantic = selectBackend({ read: true, semantic: 'ann-full' }, [backend])
    expect(semantic.missing).toEqual(['semantic:ann-full'])
  })
})
