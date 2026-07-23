/**
 * DB-free Knowledge Shard round-trip (#323 cycle 2) — export/import over the
 * canonical RecordStore + Bytecask BlobStore with zero PGlite, including byte
 * sidecars, conflict strategies, the ADR-014 verify-before-persist gate, and
 * cross-tier format parity (a record-exported shard imports into PGlite).
 *
 * @source @packages/core/src/records/record-shard.ts
 * @requirement @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @created 2026-07-17
 * @agent Codex
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { CanonicalNotesRepository } from '../../records/canonical-notes-repository.js'
import { CanonicalAttachmentsRepository } from '../../records/canonical-attachments-repository.js'
import {
  exportShardFromRecords,
  exportShardFromRecordsWithReport,
  importShardToRecords,
} from '../../records/record-shard.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShard } from '../../shard/shard-export.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { AllowlistTrustStore } from '../../shard/shard-signature.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { validateRecordV1ShardArchive } from '../../shard/schema-validator.js'
import { sha256Hex } from '../../shard/checksum.js'
import type { DatabaseClient } from '../../storage-backend.js'
import type { JournalEntry } from '../../records/types.js'

const bytes = (s: string) => new TextEncoder().encode(s)
const testDir = fileURLToPath(new URL('../shard/', import.meta.url))
const canonicalFixtureRoot = resolve(testDir, 'fixtures/canonical-core-v1')

function canonicalCoreV1Files(): Map<string, Uint8Array> {
  return new Map(
    [
      'manifest.json',
      'notes.jsonl',
      'collections.json',
      'tags.json',
      'templates.json',
      'links.jsonl',
    ].map((name) => [name, readFileSync(resolve(canonicalFixtureRoot, name))]),
  )
}

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
  const link = await notes.createLink(a.note.id, b.note.id, 'related')
  const collection = await notes.createCollection('Research', 'storage notes')
  await notes.addNoteToCollection(collection.id, a.note.id)
  const attachment = await attachments.attach({
    noteId: a.note.id,
    data: bytes('attachment payload'),
    filename: 'payload.txt',
    mimeType: 'text/plain',
    extractedText: 'attachment payload',
  })

  return { store, blobStore, notes, attachments, a, b, link, collection, attachment }
}

async function markAttachmentsAsSchema2(
  store: MemoryRecordStore,
): Promise<void> {
  for (const attachment of await store.list('attachment')) {
    await store.put('attachment', {
      ...attachment,
      __fortemi_extraction_status: 'extracted',
      __fortemi_extraction_reason: null,
      __fortemi_projection_presence: {
        '/extracted_text': attachment.extracted_text === null ? 'null' : 'value',
        '/reason': 'null',
      },
    })
  }
}

async function markNotesAsSchema2(store: MemoryRecordStore): Promise<void> {
  for (const note of await store.list('note')) {
    await store.put('note', {
      ...note,
      __fortemi_presence: {
        '/deleted_at': note.deleted_at === null ? 'null' : 'value',
      },
    })
  }
}

describe('record-shard (DB-free)', () => {
  it('exports, imports, and converges supported record-v1 bytes', async () => {
    const src = await seededStore()
    await src.store.put('note_revised_current', {
      ...(await src.store.get('note_revised_current', src.b.note.id))!,
      content: null,
    })
    await src.notes.softDelete(src.b.note.id)

    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
    })
    expect(exported).toMatchObject({
      success: true,
      errors: [],
      capability_report: {
        requested_profile: 'record-v1',
        authority_status: 'supported',
        backend_supported: true,
        portable: true,
        advertised_profiles: ['record-v1'],
        declared_components: ['notes', 'collections', 'tags', 'links'],
      },
    })
    expect(exported.capability_report.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'null-revised-content-normalized', count: 1 }),
      expect.objectContaining({ code: 'attachment-lifecycle-outside-profile', count: 1 }),
      expect.objectContaining({ code: 'link-confidence-defaulted', count: 1 }),
    ]))
    await expect(validateRecordV1ShardArchive(exported.archive!)).resolves.toEqual({
      valid: true,
      errors: [],
    })

    const files = unpackTarGz(exported.archive!)
    expect([...files.keys()].sort()).toEqual([
      'collections.json',
      'links.jsonl',
      'manifest.json',
      'notes.jsonl',
      'tags.json',
    ])
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as {
      version: string
      profile: string
      producer: { name: string }
      components: string[]
      counts: Record<string, number>
      min_reader_version: string
    }
    expect(manifest).toMatchObject({
      version: '1.2.0',
      profile: 'record-v1',
      producer: { name: 'fortemi-react-record-store' },
      components: ['notes', 'collections', 'tags', 'links'],
      counts: {
        notes: 2,
        collections: 1,
        tags: 2,
        templates: 0,
        links: 1,
        embedding_sets: 0,
        embedding_set_members: 0,
        embeddings: 0,
        embedding_configs: 0,
      },
      min_reader_version: '1.2.0',
    })

    const dst = new MemoryRecordStore()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const imported = await importShardToRecords(dst, exported.archive!, {
        conflictStrategy: 'replace',
      })
      expect(imported).toMatchObject({
        success: true,
        capability_report: {
          requested_profile: 'record-v1',
          authority_status: 'supported',
          backend_supported: true,
          portable: true,
        },
      })
    }
    expect((await dst.get('note', src.b.note.id))?.deleted_at).not.toBeNull()
    expect((await dst.get('note_revised_current', src.b.note.id))?.content).toBe('')

    const reexported = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1',
    })
    expect(reexported.success).toBe(true)
    const reexportedFiles = unpackTarGz(reexported.archive!)
    for (const component of ['notes.jsonl', 'collections.json', 'tags.json', 'links.jsonl']) {
      expect(new TextDecoder().decode(reexportedFiles.get(component)))
        .toBe(new TextDecoder().decode(files.get(component)))
    }
  })

  it('preserves schema-2.0 absent note fields through RecordStore round trips', async () => {
    const src = await seededStore()
    await markAttachmentsAsSchema2(src.store)
    for (const sourceNote of await src.store.list('note')) {
      const trackedNote = {
        ...sourceNote,
        deleted_at: null,
        __fortemi_presence: {
          '/deleted_at': sourceNote.id === src.b.note.id ? 'absent' : 'null',
        },
      }
      if (sourceNote.id === src.b.note.id) {
        delete (trackedNote as Partial<typeof trackedNote>).deleted_at
      }
      await src.store.put('note', trackedNote as typeof sourceNote)
    }

    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
      schemaVersion: '2.0.0',
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    await expect(validateRecordV1ShardArchive(exported.archive!)).resolves.toEqual({
      valid: true,
      errors: [],
    })
    const files = unpackTarGz(exported.archive!)
    const sourceNotes = new TextDecoder().decode(files.get('notes.jsonl'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(Object.hasOwn(
      sourceNotes.find((note) => note.id === src.b.note.id)!,
      'deleted_at',
    )).toBe(false)

    const dst = new MemoryRecordStore()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const imported = await importShardToRecords(dst, exported.archive!, {
        conflictStrategy: 'replace',
      })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
    }
    const stored = (await dst.get('note', src.b.note.id)) as unknown as Record<string, unknown>
    expect(Object.hasOwn(stored, 'deleted_at')).toBe(false)
    expect(stored.__fortemi_presence).toEqual({ '/deleted_at': 'absent' })

    const reexported = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1',
      schemaVersion: '2.0.0',
    })
    expect(reexported.success, reexported.errors.join('; ')).toBe(true)
    expect(new TextDecoder().decode(unpackTarGz(reexported.archive!).get('notes.jsonl')))
      .toBe(new TextDecoder().decode(files.get('notes.jsonl')))

    const destinationNotes = new CanonicalNotesRepository(dst)
    await destinationNotes.softDelete(src.b.note.id)
    const deletedArchive = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1', schemaVersion: '2.0.0',
    })
    const deletedNote = new TextDecoder().decode(
      unpackTarGz(deletedArchive.archive!).get('notes.jsonl'),
    ).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((note) => note.id === src.b.note.id)!
    expect(typeof deletedNote.deleted_at).toBe('string')

    await destinationNotes.restore(src.b.note.id)
    const restoredArchive = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1', schemaVersion: '2.0.0',
    })
    const restoredNote = new TextDecoder().decode(
      unpackTarGz(restoredArchive.archive!).get('notes.jsonl'),
    ).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((note) => note.id === src.b.note.id)!
    expect(restoredNote.deleted_at).toBeNull()
  })

  it('rejects schema-2.0 export when legacy RecordStore presence is indeterminate', async () => {
    const src = await seededStore()
    await markAttachmentsAsSchema2(src.store)
    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
      schemaVersion: '2.0.0',
    })
    expect(exported.success).toBe(false)
    expect(exported.errors.join('\n')).toContain(
      'Cannot emit schema 2.0 with legacy-indeterminate state at /deleted_at',
    )
  })

  it('preserves schema-2.0 attachment, link, and manifest presence through RecordStore', async () => {
    const src = await seededStore()
    await markNotesAsSchema2(src.store)
    await markAttachmentsAsSchema2(src.store)
    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
      schemaVersion: '2.0.0',
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)

    const files = unpackTarGz(exported.archive!)
    const notes = new TextDecoder().decode(files.get('notes.jsonl'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const noteWithAttachment = notes.find((note) =>
      Array.isArray(note.attachments) && note.attachments.length > 0
    )!
    const attachment = (noteWithAttachment.attachments as Array<Record<string, unknown>>)[0]
    attachment.extracted_text = ''
    attachment.extraction_status = 'failed'
    attachment.reason = 'extractor_failed'
    files.set('notes.jsonl', bytes(notes.map((note) => JSON.stringify(note)).join('\n')))

    const links = new TextDecoder().decode(files.get('links.jsonl'))
      .trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    links[0].metadata = ''
    files.set('links.jsonl', bytes(links.map((link) => JSON.stringify(link)).join('\n')))

    const manifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')),
    ) as Record<string, unknown> & {
      producer: Record<string, unknown>
      checksums: Record<string, string>
    }
    manifest.matric_version = '2026.7.12'
    manifest.migrated_from = '1.2.0'
    manifest.migration_history = []
    manifest.producer.revision = 'presence-matrix'
    for (const path of Object.keys(manifest.checksums)) {
      manifest.checksums[path] = await sha256Hex(files.get(path)!)
    }
    files.set('manifest.json', bytes(JSON.stringify(manifest, null, 2)))
    const archive = packTarGz(files)
    await expect(validateRecordV1ShardArchive(archive)).resolves.toEqual({
      valid: true,
      errors: [],
    })

    const dst = new MemoryRecordStore()
    const imported = await importShardToRecords(dst, archive, {
      conflictStrategy: 'replace',
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    const reexported = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1',
      schemaVersion: '2.0.0',
    })
    expect(reexported.success, reexported.errors.join('; ')).toBe(true)

    const returnedFiles = unpackTarGz(reexported.archive!)
    const returnedNotes = new TextDecoder().decode(returnedFiles.get('notes.jsonl'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const returnedAttachment = (
      returnedNotes.find((note) => note.id === noteWithAttachment.id)!
        .attachments as Array<Record<string, unknown>>
    )[0]
    expect(returnedAttachment).toMatchObject({
      extracted_text: '',
      extraction_status: 'failed',
      reason: 'extractor_failed',
    })
    const returnedLink = JSON.parse(
      new TextDecoder().decode(returnedFiles.get('links.jsonl')).trim(),
    ) as Record<string, unknown>
    expect(returnedLink.metadata).toBe('')
    const returnedManifest = JSON.parse(
      new TextDecoder().decode(returnedFiles.get('manifest.json')),
    ) as Record<string, unknown> & { producer: Record<string, unknown> }
    expect(returnedManifest).toMatchObject({
      matric_version: '2026.7.12',
      migrated_from: '1.2.0',
      migration_history: [],
      producer: { revision: 'presence-matrix' },
    })
  })

  it('preserves nested collections through record-v1 import and re-export', async () => {
    const src = await seededStore()
    const child = await src.notes.createCollection('Nested', 'child', src.collection.id)
    await src.notes.addNoteToCollection(child.id, src.b.note.id)

    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
    })
    expect(exported.success).toBe(true)
    const files = unpackTarGz(exported.archive!)
    const collections = JSON.parse(
      new TextDecoder().decode(files.get('collections.json')),
    ) as Array<{ id: string; parent_id: string | null }>
    expect(collections.find((collection) => collection.id === child.id)?.parent_id)
      .toBe(src.collection.id)

    const dst = new MemoryRecordStore()
    const imported = await importShardToRecords(dst, exported.archive!, {
      conflictStrategy: 'replace',
    })
    expect(imported.success).toBe(true)
    expect((await dst.get('collection', child.id))?.parent_id).toBe(src.collection.id)

    const reexported = await exportShardFromRecordsWithReport(dst, {
      profile: 'record-v1',
    })
    expect(reexported.success).toBe(true)
    expect(new TextDecoder().decode(unpackTarGz(reexported.archive!).get('collections.json')))
      .toBe(new TextDecoder().decode(files.get('collections.json')))
  })

  it('rejects a cyclic record-v1 hierarchy before any RecordStore mutation', async () => {
    const src = await seededStore()
    const exported = await exportShardFromRecordsWithReport(src.store, {
      profile: 'record-v1',
    })
    const files = unpackTarGz(exported.archive!)
    const collections = JSON.parse(
      new TextDecoder().decode(files.get('collections.json')),
    ) as Array<Record<string, unknown>>
    collections[0].parent_id = collections[0].id
    const collectionBytes = new TextEncoder().encode(JSON.stringify(collections))
    files.set('collections.json', collectionBytes)
    const manifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')),
    ) as { checksums: Record<string, string> }
    manifest.checksums['collections.json'] = await sha256Hex(collectionBytes)
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))

    const dst = new MemoryRecordStore()
    const imported = await importShardToRecords(dst, packTarGz(files))
    expect(imported.success).toBe(false)
    expect(imported.errors.join('\n')).toContain('collection hierarchy contains a cycle')
    expect(await dst.headSeq()).toBe(0)
    expect(await dst.list('collection')).toEqual([])
    expect(await dst.list('note')).toEqual([])
  })

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

  it('replace converges legacy nulls, tombstones, timestamps, and note relationships', async () => {
    const src = await seededStore()
    const revised = await src.store.get('note_revised_current', src.a.note.id)
    await src.store.put('note_revised_current', {
      ...revised!,
      content: null,
      ai_metadata: { preserved: true },
      updated_at: src.a.note.updated_at,
    })
    await src.notes.softDelete(src.b.note.id)
    await src.notes.softDeleteLink(src.link.id)
    await src.attachments.delete(src.attachment.id)
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })

    const dst = new MemoryRecordStore()
    const dstBlobs = new MemoryBlobStore()
    expect((await importShardToRecords(dst, archive, { blobStore: dstBlobs })).success).toBe(true)

    const dstNotes = new CanonicalNotesRepository(dst)
    const dstAttachments = new CanonicalAttachmentsRepository(dst, dstBlobs)
    await dstNotes.addTag(src.a.note.id, 'stale-tag')
    const staleCollection = await dstNotes.createCollection('Stale')
    await dstNotes.addNoteToCollection(staleCollection.id, src.a.note.id)
    const destinationOnly = await dstNotes.create({
      title: 'Destination only',
      content: 'not present in the shard',
    })
    await dstNotes.createLink(src.a.note.id, destinationOnly.note.id, 'stale-link')
    await dstAttachments.attach({
      noteId: src.a.note.id,
      data: bytes('stale bytes'),
      filename: 'stale.txt',
    })

    const merged = await importShardToRecords(dst, archive, {
      conflictStrategy: 'skip',
      blobStore: dstBlobs,
    })
    expect(merged.success).toBe(true)
    expect((await dst.list('link')).some((link) => link.link_type === 'stale-link')).toBe(true)

    const first = await importShardToRecords(dst, archive, {
      conflictStrategy: 'replace',
      blobStore: dstBlobs,
    })
    expect(first.success).toBe(true)
    expect((await dst.get('note_revised_current', src.a.note.id))?.content).toBeNull()
    expect((await dst.get('note_revised_current', src.a.note.id))?.ai_metadata).toEqual({
      preserved: true,
    })
    expect((await dst.get('note', src.b.note.id))?.deleted_at).not.toBeNull()
    expect((await dst.list('note_tag')).filter((tag) => tag.note_id === src.a.note.id).map((tag) => tag.tag))
      .toEqual(['storage'])
    expect((await dst.list('collection_note')).filter((item) => item.note_id === src.a.note.id))
      .toHaveLength(1)
    expect((await dst.list('link')).filter((link) => link.link_type === 'stale-link'))
      .toHaveLength(0)
    expect((await dst.list('attachment')).filter((attachment) => attachment.filename === 'stale.txt'))
      .toHaveLength(0)

    const sourceFiles = unpackTarGz(archive)
    const converged = await exportShardFromRecords(dst, {
      includeBlobs: true,
      blobStore: dstBlobs,
    })
    const convergedFiles = unpackTarGz(converged)
    const sourceNoteIds = new Set([src.a.note.id, src.b.note.id])
    const sourceNotes = new TextDecoder().decode(sourceFiles.get('notes.jsonl'))
    const convergedNotes = new TextDecoder().decode(convergedFiles.get('notes.jsonl'))
      .split('\n')
      .filter((line) => sourceNoteIds.has((JSON.parse(line) as { id: string }).id))
      .join('\n')
    expect(convergedNotes).toBe(sourceNotes)
    for (const component of ['tags.json', 'links.jsonl']) {
      expect(new TextDecoder().decode(convergedFiles.get(component)))
        .toBe(new TextDecoder().decode(sourceFiles.get(component)))
    }
    expect(await dst.get('note', destinationOnly.note.id)).not.toBeNull()
    expect(await dst.get('collection', src.collection.id))
      .toEqual(await src.store.get('collection', src.collection.id))

    const repeat = await importShardToRecords(dst, archive, {
      conflictStrategy: 'replace',
      blobStore: dstBlobs,
    })
    expect(repeat.success).toBe(true)
    const repeatedFiles = unpackTarGz(await exportShardFromRecords(dst))
    for (const component of ['notes.jsonl', 'collections.json', 'tags.json', 'links.jsonl']) {
      expect(new TextDecoder().decode(repeatedFiles.get(component)))
        .toBe(new TextDecoder().decode(convergedFiles.get(component)))
    }
  })

  it('does not revive a destination tombstone newer than a legacy live record', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store)
    const dst = new MemoryRecordStore()
    expect((await importShardToRecords(dst, archive)).success).toBe(true)
    const note = await dst.get('note', src.b.note.id)
    await dst.put('note', {
      ...note!,
      updated_at: '2099-01-01T00:00:00.000Z',
      deleted_at: '2099-01-01T00:00:00.000Z',
    })

    expect((await importShardToRecords(dst, archive, { conflictStrategy: 'replace' })).success)
      .toBe(true)
    expect((await dst.get('note', src.b.note.id))?.deleted_at)
      .toBe('2099-01-01T00:00:00.000Z')
  })

  it('rolls back promoted blobs when the atomic record batch fails', async () => {
    class FailingBatchStore extends MemoryRecordStore {
      override async applyBatch(): Promise<JournalEntry[]> {
        throw new Error('injected record failure')
      }
    }

    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })
    const dst = new FailingBatchStore()
    const dstBlobs = new MemoryBlobStore()
    const preexistingChecksum = await dstBlobs.put(bytes('preexisting bytes'))
    const checksum = (await src.store.list('attachment_blob'))[0].content_hash

    const result = await importShardToRecords(dst, archive, { blobStore: dstBlobs })
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('injected record failure')
    expect(await dst.headSeq()).toBe(0)
    expect(await dst.list('note')).toEqual([])
    expect(await dstBlobs.has(checksum)).toBe(false)
    expect(await dstBlobs.has(preexistingChecksum)).toBe(true)
  })

  it('rejects a rollback-unsafe custom blob store before mutation', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })
    const dst = new MemoryRecordStore()
    const rollbackUnsafe = new MemoryBlobStore()
    Object.defineProperty(rollbackUnsafe, 'delete', { value: undefined })
    const checksum = (await src.store.list('attachment_blob'))[0].content_hash

    const result = await importShardToRecords(dst, archive, { blobStore: rollbackUnsafe })
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('must implement delete()')
    expect(await dst.headSeq()).toBe(0)
    expect(await dst.list('note')).toEqual([])
    expect(await rollbackUnsafe.has(checksum)).toBe(false)
  })

  it('rejects a non-atomic custom record store before blob or record mutation', async () => {
    const src = await seededStore()
    const archive = await exportShardFromRecords(src.store, {
      includeBlobs: true,
      blobStore: src.blobStore,
    })
    const batchUnsafe = new MemoryRecordStore()
    Object.defineProperty(batchUnsafe, 'applyBatch', { value: undefined })
    const dstBlobs = new MemoryBlobStore()
    const checksum = (await src.store.list('attachment_blob'))[0].content_hash

    const result = await importShardToRecords(batchUnsafe, archive, { blobStore: dstBlobs })
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('must implement applyBatch()')
    expect(await batchUnsafe.headSeq()).toBe(0)
    expect(await batchUnsafe.list('note')).toEqual([])
    expect(await dstBlobs.has(checksum)).toBe(false)
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

  it('rejects core-v1 count drift before any RecordStore mutation', async () => {
    const files = canonicalCoreV1Files()
    const manifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')),
    ) as { counts: { notes: number } }
    manifest.counts.notes += 1
    files.set('manifest.json', bytes(JSON.stringify(manifest)))

    const dst = new MemoryRecordStore()
    const result = await importShardToRecords(dst, packTarGz(files))

    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('Canonical core-v1 validation failed')
    expect(result.errors.join('\n')).toContain('count mismatch')
    expect(await dst.headSeq()).toBe(0)
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
