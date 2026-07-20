/**
 * @source @packages/core/src/shard/profile-registry.ts
 * @source @packages/core/src/shard/shard-export.ts
 * @requirement @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @created 2026-07-17
 * @agent Codex
 */

import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import {
  exportShardFromRecordsWithReport,
  importShardToRecords,
} from '../../records/record-shard.js'
import { exportShard, exportShardWithReport } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import {
  createShardCapabilityReport,
  getKnowledgeShardProfileRegistry,
} from '../../shard/profile-registry.js'
import { validateCoreV1ShardArchive } from '../../shard/schema-validator.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import type { DatabaseClient } from '../../storage-backend.js'
import type { ShardManifest, ShardNote } from '../../shard/types.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

function reservedProfileArchive(profile: string): Uint8Array {
  return packTarGz(new Map([
    ['manifest.json', encoder.encode(JSON.stringify({
      version: '1.0.0',
      profile,
      producer: { name: 'test', version: '1.0.0' },
      format: 'matric-shard',
      created_at: '2026-07-17T12:00:00Z',
      components: ['notes'],
      counts: {},
      checksums: {},
      min_reader_version: '1.0.0',
    }))],
  ]))
}

describe('Knowledge Shard portability profiles (#355)', () => {
  let db: PGlite | undefined

  afterEach(async () => {
    await db?.close()
    db = undefined
  })

  it('derives authority status and backend advertisements from the pinned registry', () => {
    const registry = getKnowledgeShardProfileRegistry()
    expect(registry[0]).toEqual({
      profile: 'core-v1',
      authority_status: 'supported',
      components: ['notes', 'collections', 'tags', 'templates', 'links'],
    })
    expect(registry[1]).toMatchObject({
      profile: 'full-v1',
      authority_status: 'supported',
      components: expect.arrayContaining([
        'notes',
        'note_revisions',
        'provenance_records',
        'skos_collection_members',
        'community_assignments',
      ]),
    })
    expect(registry[1].components).toHaveLength(33)
    expect(registry[2]).toEqual({
      profile: 'record-v1',
      authority_status: 'supported',
      components: ['notes', 'collections', 'tags', 'links'],
    })

    expect(createShardCapabilityReport({
      backend: 'pglite',
      operation: 'export',
      requestedProfile: 'core-v1',
    })).toMatchObject({
      authority_status: 'supported',
      backend_supported: true,
      portable: true,
      advertised_profiles: ['core-v1'],
      authority: {
        commit: '81fbeaf065df3818edd046ed8a744f10eeb00e6f',
        contract_revision: '19',
        schema_version: '1.2.0',
      },
    })
    expect(createShardCapabilityReport({
      backend: 'record-store',
      operation: 'export',
      requestedProfile: 'record-v1',
    })).toMatchObject({
      authority_status: 'supported',
      backend_supported: true,
      portable: true,
      advertised_profiles: ['record-v1'],
      supported_components: ['notes', 'collections', 'tags', 'links'],
    })
  })

  it('emits a self-validating core-v1 archive and reports omitted extension data', async () => {
    db = await createTestDb()
    const notes = new NotesRepository(db)
    const activeNote = await notes.create({
      content: 'Profiled note',
      title: 'Core export',
      tags: ['note-tag'],
    })
    const deletedNote = await notes.create({
      content: 'Deleted profile note',
      title: 'Core tombstone',
      tags: [],
    })
    await notes.delete(deletedNote.id)
    const sourceTombstone = await db.query<{ deleted_at: Date }>(
      'SELECT deleted_at FROM note WHERE id = $1',
      [deletedNote.id],
    )
    await db.query(
      `INSERT INTO template (
         id, name, description, content, format, default_tags, collection_id, created_at, updated_at
       ) VALUES (
         '018f2d2d-bc00-7cc8-8ad2-f147d6a2e701',
         'Core template',
         NULL,
         '# Template',
         'markdown',
         '["template-tag"]',
         NULL,
         '2026-07-17T11:40:00Z',
         '2026-07-17T11:41:00Z'
       )`,
    )
    await db.query(
      `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
       VALUES (
         '018f2d2d-bc00-7cc8-8ad2-f147d6a2e702',
         'Extension scheme',
         NULL,
         '2026-07-17T11:00:00Z',
         '2026-07-17T11:00:00Z'
       )`,
    )

    const result = await exportShardWithReport(db, { profile: 'core-v1' })
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.capability_report).toMatchObject({
      requested_profile: 'core-v1',
      authority_status: 'supported',
      backend_supported: true,
      portable: true,
      declared_components: ['notes', 'collections', 'tags', 'templates', 'links'],
    })
    expect(result.capability_report.losses).toContainEqual({
      code: 'component-outside-profile',
      component: 'skos_schemes',
      count: 1,
      message: '1 skos_schemes record(s) are outside core-v1 and were omitted.',
    })
    expect(result.capability_report.losses).not.toContainEqual(
      expect.objectContaining({ code: 'tombstones-outside-profile' }),
    )

    const files = unpackTarGz(result.archive!)
    expect([...files.keys()].sort()).toEqual([
      'collections.json',
      'links.jsonl',
      'manifest.json',
      'notes.jsonl',
      'tags.json',
      'templates.json',
    ])
    await expect(validateCoreV1ShardArchive(files)).resolves.toEqual({
      valid: true,
      errors: [],
    })

    const manifest = JSON.parse(decoder.decode(files.get('manifest.json'))) as ShardManifest
    expect(manifest).toMatchObject({
      version: '1.2.0',
      profile: 'core-v1',
      producer: { name: 'fortemi-react' },
      components: ['notes', 'collections', 'tags', 'templates', 'links'],
      counts: {
        notes: 2,
        collections: 0,
        tags: 2,
        templates: 1,
        links: 0,
        embedding_sets: 0,
        embedding_set_members: 0,
        embeddings: 0,
        embedding_configs: 0,
      },
    })
    expect(manifest).not.toHaveProperty('layout')
    expect(manifest).not.toHaveProperty('migrated_from')

    const exportedNotes = decoder.decode(files.get('notes.jsonl'))
      .split('\n')
      .map((line) => JSON.parse(line) as ShardNote)
    expect(exportedNotes.find((note) => note.id === activeNote.id)).toMatchObject({
      metadata: null,
      attachments: [],
      deleted_at: null,
    })
    expect(exportedNotes.find((note) => note.id === deletedNote.id)?.deleted_at)
      .toBe(sourceTombstone.rows[0].deleted_at.toISOString())
    expect(JSON.parse(decoder.decode(files.get('tags.json')))).toEqual([
      expect.objectContaining({ name: 'note-tag' }),
      expect.objectContaining({ name: 'template-tag' }),
    ])

    await db.close()
    db = await createTestDb()
    const imported = await importShard(db, result.archive!)
    expect(imported).toMatchObject({
      success: true,
      capability_report: {
        requested_profile: 'core-v1',
        authority_status: 'supported',
        backend_supported: true,
        portable: true,
        losses: [],
      },
    })
    const restoredTombstone = await db.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM note WHERE id = $1',
      [deletedNote.id],
    )
    expect(restoredTombstone.rows[0].deleted_at?.toISOString())
      .toBe(sourceTombstone.rows[0].deleted_at.toISOString())

    const records = new MemoryRecordStore()
    const recordResult = await importShardToRecords(records, result.archive!)
    expect(recordResult).toMatchObject({
      success: false,
      capability_report: {
        requested_profile: 'core-v1',
        authority_status: 'supported',
        backend_supported: false,
        supported_components: ['notes', 'collections', 'tags', 'links'],
        unsupported_components: ['templates'],
      },
    })
    expect(await records.headSeq()).toBe(0)
  }, 30_000)

  it('rejects authority-supported but unimplemented profiles before querying or mutating', async () => {
    const archive = reservedProfileArchive('full-v1')
    const noQueryDb = {
      query: () => {
        throw new Error('profile rejection must precede database queries')
      },
      transaction: () => {
        throw new Error('profile rejection must precede transactions')
      },
    } as unknown as DatabaseClient

    const pglite = await importShard(noQueryDb, archive)
    expect(pglite).toMatchObject({
      success: false,
      capability_report: {
        requested_profile: 'full-v1',
        authority_status: 'supported',
        backend_supported: false,
      },
    })
    expect(pglite.errors.join('\n')).toContain(
      'not supported by the pglite import path',
    )

    const records = new MemoryRecordStore()
    const recordResult = await importShardToRecords(records, archive)
    expect(recordResult).toMatchObject({
      success: false,
      capability_report: {
        requested_profile: 'full-v1',
        authority_status: 'supported',
        backend_supported: false,
      },
    })
    expect(await records.headSeq()).toBe(0)
  })

  it('returns machine-readable failures for unknown and incompatible export profiles', async () => {
    const noQueryDb = {} as DatabaseClient
    const unknown = await exportShardWithReport(noQueryDb, { profile: 'vendor-private-v1' })
    expect(unknown).toMatchObject({
      success: false,
      archive: null,
      capability_report: {
        authority_status: 'unknown',
        backend_supported: false,
      },
    })

    const backendIncompatible = await exportShardWithReport(noQueryDb, { profile: 'record-v1' })
    expect(backendIncompatible).toMatchObject({
      success: false,
      archive: null,
      capability_report: {
        authority_status: 'supported',
        backend_supported: false,
      },
    })

    const incompatible = await exportShardWithReport(noQueryDb, {
      profile: 'core-v1',
      clusterNotesSize: 10,
      includeBlobs: true,
    })
    expect(incompatible.success).toBe(false)
    expect(incompatible.errors).toEqual([
      'core-v1 does not declare clustered note files',
      'core-v1 declares attachment references but not blob sidecar files',
    ])

    await expect(exportShard(noQueryDb, { profile: 'core-v1' })).rejects.toThrow(
      'Named portability profiles require exportShardWithReport',
    )

    const records = new MemoryRecordStore()
    const supported = await exportShardFromRecordsWithReport(records, {
      profile: 'record-v1',
    })
    expect(supported).toMatchObject({
      success: true,
      errors: [],
      capability_report: {
        authority_status: 'supported',
        backend_supported: true,
        advertised_profiles: ['record-v1'],
      },
    })
    expect(supported.archive).toBeInstanceOf(Uint8Array)
    expect(await records.headSeq()).toBe(0)
  })
})
