/**
 * Shard import pipeline — integration tests.
 *
 * Tests the full import flow: unpack → validate → field-map → transactional insert.
 * Uses exportShard to create test archives, then imports them into fresh databases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { EmbeddingSetsRepository } from '../../repositories/embedding-sets-repository.js'
import { TagsRepository } from '../../repositories/tags-repository.js'
import { AttachmentsRepository } from '../../repositories/attachments-repository.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { validateShardArchive } from '../../shard/schema-validator.js'
import { sha256Hex } from '../../shard/checksum.js'
import { compareShardVersions } from '../../shard/types.js'
import type { ImportProgress, ShardLink, ShardManifest, ShardNote } from '../../shard/types.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const testDir = fileURLToPath(new URL('.', import.meta.url))
const goldenFixturePath = resolve(
  testDir,
  'fixtures/golden/server-2026.7.1-fortemi-docs.shard',
)

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

/** Helper: create a populated DB and export a shard from it. */
async function createTestShard(): Promise<{ archive: Uint8Array; sourceDb: PGlite }> {
  const sourceDb = await createTestDb()
  const notes = new NotesRepository(sourceDb)
  const collections = new CollectionsRepository(sourceDb)
  const links = new LinksRepository(sourceDb)

  const note1 = await notes.create({ content: 'First note', title: 'Note 1', tags: ['alpha', 'beta'] })
  const note2 = await notes.create({ content: 'Second note', title: 'Note 2', tags: ['beta', 'gamma'] })
  await collections.create({ name: 'Research', description: 'Papers' })
  await links.create(note1.id, note2.id, 'related')

  const archive = await exportShard(sourceDb)
  return { archive, sourceDb }
}

describe('importShard', { timeout: 30_000 }, () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('imports all components from a valid shard', async () => {
    const { archive, sourceDb } = await createTestShard()

    const result = await importShard(db, archive)
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(2)
    expect(result.counts.collections).toBe(1)
    expect(result.counts.links).toBe(1)
    expect(result.errors).toEqual([])
  })

  it('reports import progress phases without changing existing result shape', async () => {
    const { archive, sourceDb } = await createTestShard()
    const progress: ImportProgress[] = []

    const result = await importShard(db, archive, {
      batchSize: 1,
      onProgress: (event) => progress.push(event),
    })
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(progress.some((event) => event.phase === 'unpack' && event.done === event.total)).toBe(true)
    expect(progress.some((event) => event.phase === 'validate' && event.done === event.total)).toBe(true)
    expect(progress.some((event) => event.phase === 'notes' && event.done === 2 && event.total === 2)).toBe(true)
    expect(progress.some((event) => event.phase === 'links' && event.done === 1 && event.total === 1)).toBe(true)
    expect(progress.some((event) => event.phase === 'index' && event.done === event.total)).toBe(true)
  })

  it('imported notes have correct content', async () => {
    const { archive, sourceDb } = await createTestShard()

    await importShard(db, archive)
    await sourceDb.close()

    const notes = new NotesRepository(db)
    const list = await notes.list({ sort: 'title', order: 'asc' })

    expect(list.items).toHaveLength(2)
    expect(list.items[0].title).toBe('Note 1')
    expect(list.items[1].title).toBe('Note 2')
  })

  it('imported notes have tags', async () => {
    const { archive, sourceDb } = await createTestShard()

    await importShard(db, archive)
    await sourceDb.close()

    const tags = new TagsRepository(db)
    const allTags = await tags.listAllTags()
    const tagNames = allTags.map((t) => t.tag).sort()

    expect(tagNames).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('imported collections are queryable', async () => {
    const { archive, sourceDb } = await createTestShard()

    await importShard(db, archive)
    await sourceDb.close()

    const collections = new CollectionsRepository(db)
    const list = await collections.list()

    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Research')
    expect(list[0].description).toBe('Papers')
  })

  it('imported links have correct field mapping', async () => {
    const { archive, sourceDb } = await createTestShard()

    await importShard(db, archive)
    await sourceDb.close()

    const linkRows = await db.query<{ source_note_id: string; target_note_id: string; link_type: string }>(
      `SELECT source_note_id, target_note_id, link_type FROM link WHERE deleted_at IS NULL`,
    )

    expect(linkRows.rows).toHaveLength(1)
    expect(linkRows.rows[0].link_type).toBe('related')
  })

  it('imports and re-exports URL-only server links', async () => {
    const linkData = encoder.encode(JSON.stringify({
      id: 'link-url-1',
      from_note_id: 'note-1',
      to_note_id: null,
      to_url: 'https://example.test',
      kind: 'reference',
      score: null,
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { label: 'Example' },
    }))
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: ['links'],
      counts: { links: 1 },
      checksums: { 'links.jsonl': await sha256Hex(linkData) },
      min_reader_version: '1.0.0',
    }
    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('links.jsonl', linkData)

    const result = await importShard(db, packTarGz(files))
    const linkRows = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM link')
    const urlLinkRows = await db.query<{ n: number; to_url: string; metadata: string }>(
      `SELECT COUNT(*)::int AS n, MIN(to_url) AS to_url, MIN(metadata_json::text) AS metadata FROM link_url_target`,
    )

    expect(result.success).toBe(true)
    expect(result.counts.links).toBe(1)
    expect(result.skipped.links ?? 0).toBe(0)
    expect(result.warnings.some((warning) => warning.includes('URL-only shard link skipped: link-url-1'))).toBe(false)
    expect(linkRows.rows[0].n).toBe(0)
    expect(urlLinkRows.rows[0].n).toBe(1)
    expect(urlLinkRows.rows[0].to_url).toBe('https://example.test')
    expect(JSON.parse(urlLinkRows.rows[0].metadata)).toEqual({ label: 'Example' })

    const exported = unpackTarGz(await exportShard(db))
    const exportedLink = JSON.parse(
      new TextDecoder().decode(exported.get('links.jsonl')!),
    ) as ShardLink
    expect(exportedLink).toMatchObject({
      id: 'link-url-1',
      from_note_id: 'note-1',
      to_note_id: null,
      to_url: 'https://example.test',
      kind: 'reference',
      metadata: { label: 'Example' },
    })
  })

  it('round-trips portable note metadata without modification', async () => {
    const metadata = {
      aiwg_fortemi_index: {
        envelope: {
          schema_version: 'aiwg.fortemi.index.export.v2',
          generated_at: '2026-07-16T00:00:00.000Z',
        },
        record: {
          id: 'aiwg:skill:design-review',
          relationships: [{ type: 'uses', target_id: 'aiwg:agent:architect' }],
        },
      },
    }
    const note: ShardNote = {
      id: '01981f44-a9d0-7c6f-a8b0-701d514d0d52',
      title: 'Design Review',
      original_content: 'Review an architecture design.',
      revised_content: null,
      metadata,
      format: 'markdown',
      source: 'aiwg-index',
      starred: false,
      archived: false,
      tags: ['review'],
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
      deleted_at: null,
    }
    const noteData = encoder.encode(JSON.stringify(note))
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: 'fortemi-core-aiwg-index',
      format: 'matric-shard',
      created_at: '2026-07-16T00:00:00.000Z',
      components: ['notes'],
      counts: { notes: 1 },
      checksums: { 'notes.jsonl': await sha256Hex(noteData) },
      min_reader_version: '1.0.0',
    }
    const files = new Map<string, Uint8Array>([
      ['manifest.json', encoder.encode(JSON.stringify(manifest))],
      ['notes.jsonl', noteData],
    ])

    expect((await importShard(db, packTarGz(files))).success).toBe(true)
    const exported = unpackTarGz(await exportShard(db))
    const exportedNote = JSON.parse(
      decoder.decode(exported.get('notes.jsonl')!),
    ) as ShardNote

    expect(exportedNote.id).toBe(note.id)
    expect(exportedNote.metadata).toEqual(metadata)
  })

  it('skip strategy: existing records untouched', async () => {
    const { archive, sourceDb } = await createTestShard()

    // First import
    await importShard(db, archive)

    // Modify a note title
    const notesBefore = new NotesRepository(db)
    const list = await notesBefore.list()
    await notesBefore.update(list.items[0].id, { title: 'Modified' })

    // Second import with skip — should not overwrite
    const result = await importShard(db, archive, { conflictStrategy: 'skip' })
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(0)
    expect(result.counts.collections).toBe(0)
    expect(result.counts.links).toBe(0)
    expect(result.skipped.notes).toBe(2)
    expect(result.skipped.collections).toBe(1)
    expect(result.skipped.links).toBe(1)
    const notesAfter = new NotesRepository(db)
    const updated = await notesAfter.get(list.items[0].id)
    expect(updated.title).toBe('Modified') // unchanged
  })

  it('replace strategy: existing records overwritten', async () => {
    const { archive, sourceDb } = await createTestShard()

    // First import
    await importShard(db, archive)

    // Modify a note title
    const notesBefore = new NotesRepository(db)
    const list = await notesBefore.list()
    const originalTitle = list.items[0].title
    await notesBefore.update(list.items[0].id, { title: 'Modified' })

    // Second import with replace — should overwrite
    const result = await importShard(db, archive, { conflictStrategy: 'replace' })
    await sourceDb.close()

    expect(result.success).toBe(true)
    const notesAfter = new NotesRepository(db)
    const updated = await notesAfter.get(list.items[0].id)
    expect(updated.title).toBe(originalTitle) // restored to original
  })

  it('error strategy: aborts on duplicate', async () => {
    const { archive, sourceDb } = await createTestShard()

    // First import succeeds
    await importShard(db, archive)

    // Second import with error strategy should fail
    const result = await importShard(db, archive, { conflictStrategy: 'error' })
    await sourceDb.close()

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects archive with missing manifest', async () => {
    const files = new Map<string, Uint8Array>()
    files.set('notes.jsonl', encoder.encode('{}'))
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain('Missing manifest.json')
  })

  it('returns a structured error for a null manifest', async () => {
    const archive = packTarGz(new Map([['manifest.json', encoder.encode('null')]]))
    await expect(importShard(db, archive)).resolves.toMatchObject({ success: false })
  })

  it('returns a structured error when manifest checksums are missing', async () => {
    const manifest = { version: '1.0.0', format: 'matric-shard', components: [], counts: {} }
    const archive = packTarGz(new Map([['manifest.json', encoder.encode(JSON.stringify(manifest))]]))
    const result = await importShard(db, archive)
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('checksums must be an object')
  })

  it('returns a component-named structured error for checksum-matching corrupt JSONL', async () => {
    const linksData = encoder.encode('{not json}\n')
    const manifest: ShardManifest = {
      version: '1.0.0', matric_version: '2026.3.0', format: 'matric-shard',
      created_at: new Date().toISOString(), components: ['links'], counts: { links: 1 },
      checksums: { 'links.jsonl': await sha256Hex(linksData) }, min_reader_version: '1.0.0',
    }
    const archive = packTarGz(new Map([
      ['manifest.json', encoder.encode(JSON.stringify(manifest))],
      ['links.jsonl', linksData],
    ]))
    const result = await importShard(db, archive)
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain('links.jsonl')
  })

  it('rejects archive with invalid checksum', async () => {
    const notesData = encoder.encode('{"id":"1","title":"Test","original_content":"x","revised_content":null,"format":"markdown","source":"user","starred":false,"archived":false,"tags":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","deleted_at":null}')
    const badChecksum = 'deadbeef'.repeat(8)
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: ['notes'],
      counts: { notes: 1 },
      checksums: { 'notes.jsonl': badChecksum },
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('notes.jsonl', notesData)
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain('Checksum validation failed')
  })

  it('rejects archive with incompatible version', async () => {
    const manifest: ShardManifest = {
      version: '99.0.0',
      matric_version: '99.0.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: [],
      counts: {},
      checksums: {},
      min_reader_version: '99.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(false)
    expect(result.errors[0]).toContain('reader version')
  })

  it('compares shard reader versions numerically', () => {
    expect(compareShardVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareShardVersions('1.0.10', '1.0.2')).toBeGreaterThan(0)
    expect(compareShardVersions('1.0.0', '1.0')).toBe(0)
    expect(compareShardVersions('1.2.0', '1.10.0')).toBeLessThan(0)
  })

  it('warns about unknown components', async () => {
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: [],
      counts: {},
      checksums: {},
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('custom_data.json', encoder.encode('{}'))
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.warnings).toContain('Unknown component skipped: custom_data.json')
  })

  it('imports and re-exports templates.json', async () => {
    const templatesData = encoder.encode(JSON.stringify([
      {
        id: 'tmpl-1',
        name: 'Research brief',
        description: 'Reusable research note',
        content: '# {{title}}',
        format: 'markdown',
        default_tags: ['research', 'brief'],
        collection_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ]))
    const templatesHash = await sha256Hex(templatesData)
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: ['templates'],
      counts: { templates: 1 },
      checksums: { 'templates.json': templatesHash },
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('templates.json', templatesData)
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.counts.templates).toBe(1)
    expect(result.warnings).not.toContain('templates.json skipped (not supported in browser)')

    const rows = await db.query<{ name: string; tags: string }>(
      `SELECT name, default_tags::text AS tags FROM template WHERE id = 'tmpl-1'`,
    )
    expect(rows.rows[0].name).toBe('Research brief')
    expect(JSON.parse(rows.rows[0].tags)).toEqual(['research', 'brief'])

    const exported = unpackTarGz(await exportShard(db))
    const exportedTemplates = JSON.parse(
      new TextDecoder().decode(exported.get('templates.json')!),
    ) as Array<{ id: string; default_tags: string[] }>
    expect(exportedTemplates).toEqual([
      expect.objectContaining({ id: 'tmpl-1', default_tags: ['research', 'brief'] }),
    ])
  })

  it('entire import is atomic (transaction rollback on failure)', async () => {
    // Create a shard with a note, then corrupt the links to cause a FK error
    const sourceDb = await createTestDb()
    const notes = new NotesRepository(sourceDb)
    await notes.create({ content: 'Test' })
    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    // Import into target — should succeed
    const result = await importShard(db, archive)
    expect(result.success).toBe(true)

    // Verify note count
    const countResult = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM note WHERE deleted_at IS NULL`)
    expect(parseInt(countResult.rows[0].cnt, 10)).toBe(1)
  })

  it('returns duration_ms', async () => {
    const { archive, sourceDb } = await createTestShard()

    const result = await importShard(db, archive)
    await sourceDb.close()

    expect(result.duration_ms).toBeGreaterThan(0)
  })

  it('handles empty shard archive', async () => {
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: [],
      counts: {},
      checksums: {},
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(0)
  })

  it('accepts ArrayBuffer input', async () => {
    const { archive, sourceDb } = await createTestShard()

    // Convert to ArrayBuffer (simulates File API)
    const ab = new ArrayBuffer(archive.byteLength)
    new Uint8Array(ab).set(archive)
    const arrayBuffer = ab
    const result = await importShard(db, arrayBuffer)
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(2)
  })

  it('imports the pinned server golden shard fixture with explicit unsupported-component warnings', async () => {
    const archive = readFileSync(goldenFixturePath)

    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(329)
    expect(result.counts.templates).toBe(0)
    expect(result.counts.embedding_sets).toBe(1)
    expect(result.counts.embedding_configs).toBe(8)
    expect(result.counts.embedding_set_members).toBe(329)
    expect(result.skipped.embedding_set_members ?? 0).toBe(0)
    expect(result.warnings).not.toContain('templates.json skipped (not supported in browser)')
    expect(result.warnings).not.toContain('embedding_configs.json skipped (not supported in browser)')
    expect(result.warnings.some((warning) => warning.includes('embedding_set_member row(s) were not imported'))).toBe(false)

    const notes = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM note')
    const embeddingSets = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM embedding_set')
    const embeddingConfigs = await db.query<{ n: number; default_count: number }>(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_default)::int AS default_count FROM embedding_config`,
    )
    const embeddingSetMembers = await db.query<{
      n: number
      null_embeddings: number
      membership_type: string | null
    }>(
      `SELECT
         COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE embedding_id IS NULL)::int AS null_embeddings,
         MIN(membership_type) AS membership_type
       FROM embedding_set_member`,
    )
    expect(notes.rows[0].n).toBe(329)
    expect(embeddingSets.rows[0].n).toBe(1)
    expect(embeddingConfigs.rows[0]).toEqual({ n: 8, default_count: 1 })
    expect(embeddingSetMembers.rows[0].n).toBe(329)
    expect(embeddingSetMembers.rows[0].null_embeddings).toBe(329)
    expect(embeddingSetMembers.rows[0].membership_type).toBe('auto')

    const exportedArchive = await exportShard(db, { includeEmbeddings: true })
    expect(validateShardArchive(exportedArchive)).toEqual({ valid: true, errors: [] })

    const exported = unpackTarGz(exportedArchive)
    const exportedManifest: ShardManifest = JSON.parse(decoder.decode(exported.get('manifest.json')!))
    expect(exportedManifest.components).toEqual(expect.arrayContaining([
      'notes',
      'embedding_sets',
      'embedding_configs',
      'embedding_set_members',
    ]))
    expect(exportedManifest.counts.notes).toBe(329)
    expect(exportedManifest.counts.embedding_sets).toBe(1)
    expect(exportedManifest.counts.embedding_configs).toBe(8)
    expect(exportedManifest.counts.embedding_set_members).toBe(329)

    const exportedConfigs = JSON.parse(
      new TextDecoder().decode(exported.get('embedding_configs.json')!),
    ) as Array<{ id: string; name: string; model: string }>
    expect(exportedConfigs).toHaveLength(8)
    expect(exportedConfigs.some((config) => config.name === 'default' && config.model === 'nomic-embed-text')).toBe(true)
  })

  it('imports legacy React embedding_set_member rows that still carry embedding_id', async () => {
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    const sourceSets = new EmbeddingSetsRepository(sourceDb)
    const note = await sourceNotes.create({ content: 'Embedded note' })
    const set = await sourceSets.create({ name: 'Legacy set' })
    const embedding = await sourceSets.putEmbedding({
      note_id: note.id,
      embedding_set_id: set.id,
      vector: [1, ...Array(383).fill(0)],
    })

    const currentArchive = await exportShard(sourceDb, { includeEmbeddings: true })
    const files = unpackTarGz(currentArchive)
    const legacyMembers = encoder.encode(JSON.stringify({
      embedding_set_id: set.id,
      note_id: note.id,
      embedding_id: embedding.id,
    }))
    files.set('embedding_set_members.jsonl', legacyMembers)

    const manifest: ShardManifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
    manifest.checksums['embedding_set_members.jsonl'] = await sha256Hex(legacyMembers)
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))

    const result = await importShard(db, packTarGz(files))
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(result.counts.embedding_set_members).toBe(1)

    const rows = await db.query<{ embedding_id: string | null; membership_type: string }>(
      `SELECT embedding_id, membership_type FROM embedding_set_member WHERE embedding_set_id = $1 AND note_id = $2`,
      [set.id, note.id],
    )
    expect(rows.rows[0]).toEqual({ embedding_id: embedding.id, membership_type: 'materialized' })
  })

  it('imports legacy React embedding rows without server metadata fields (#344)', async () => {
    // Legacy React shards (pre-migration-0016) carry only id, note_id,
    // embedding_set_id, vector, created_at on embedding rows — no
    // chunk_index/text/model. Import must normalize to schema defaults
    // instead of rolling back on the NOT NULL chunk_index constraint.
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    const sourceSets = new EmbeddingSetsRepository(sourceDb)
    const note = await sourceNotes.create({ content: 'Legacy embedded note' })
    const set = await sourceSets.create({ name: 'Legacy embedding set' })
    const embedding = await sourceSets.putEmbedding({
      note_id: note.id,
      embedding_set_id: set.id,
      vector: [1, ...Array(383).fill(0)],
    })

    const currentArchive = await exportShard(sourceDb, { includeEmbeddings: true })
    const files = unpackTarGz(currentArchive)

    // Rewrite embeddings.jsonl to the legacy React row shape.
    const legacyRows = decoder
      .decode(files.get('embeddings.jsonl')!)
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const row = JSON.parse(line)
        return JSON.stringify({
          id: row.id,
          note_id: row.note_id,
          embedding_set_id: row.embedding_set_id,
          vector: row.vector,
          created_at: row.created_at,
        })
      })
      .join('\n')
    const legacyData = encoder.encode(legacyRows + '\n')
    files.set('embeddings.jsonl', legacyData)

    const manifest: ShardManifest = JSON.parse(decoder.decode(files.get('manifest.json')!))
    manifest.checksums['embeddings.jsonl'] = await sha256Hex(legacyData)
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    const archive = packTarGz(files)

    // Legacy rows also pass archive schema validation.
    expect(validateShardArchive(archive)).toEqual({ valid: true, errors: [] })

    const result = await importShard(db, archive)
    await sourceDb.close()

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.counts.embeddings).toBe(1)

    const rows = await db.query<{
      chunk_index: number
      text: string
      model: string | null
      embedding_set_id: string
    }>(
      `SELECT chunk_index, text, model, embedding_set_id FROM embedding WHERE id = $1`,
      [embedding.id],
    )
    expect(rows.rows[0]).toEqual({
      chunk_index: 0,
      text: '',
      model: null,
      embedding_set_id: set.id,
    })
  })

  it('imports server-shaped embedding rows without React embedding_set_id', async () => {
    const iso = '2026-01-01T00:00:00.000Z'
    const vector = Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)
    const note: ShardNote = {
      id: 'note-server-embedding',
      title: 'Server embedding note',
      original_content: 'Original embedding note',
      revised_content: 'Chunk source text',
      collection_id: null,
      attachments: [],
      format: 'markdown',
      source: 'manual',
      starred: false,
      archived: false,
      tags: [],
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    }
    const embedding = {
      id: 'emb-server-1',
      note_id: note.id,
      chunk_index: 3,
      text: 'Chunk source text',
      vector,
      model: 'nomic-embed-text',
    }

    const notesData = encoder.encode(JSON.stringify(note) + '\n')
    const embeddingsData = encoder.encode(JSON.stringify(embedding) + '\n')
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: 'test',
      format: 'matric-shard',
      created_at: iso,
      components: ['notes', 'embeddings'],
      counts: { notes: 1, embeddings: 1 },
      checksums: {
        'notes.jsonl': await sha256Hex(notesData),
        'embeddings.jsonl': await sha256Hex(embeddingsData),
      },
      min_reader_version: '1.0.0',
    }
    const files = new Map<string, Uint8Array>()
    files.set('notes.jsonl', notesData)
    files.set('embeddings.jsonl', embeddingsData)
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    const archive = packTarGz(files)

    expect(validateShardArchive(archive)).toEqual({ valid: true, errors: [] })
    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.counts.embeddings).toBe(1)

    const rows = await db.query<{
      chunk_index: number
      text: string
      model: string | null
      embedding_set_id: string
      membership_type: string | null
    }>(
      `SELECT e.chunk_index, e.text, e.model, e.embedding_set_id, m.membership_type
       FROM embedding e
       JOIN embedding_set_member m ON m.embedding_id = e.id
       WHERE e.id = $1`,
      [embedding.id],
    )
    expect(rows.rows[0]).toMatchObject({
      chunk_index: 3,
      text: 'Chunk source text',
      model: 'nomic-embed-text',
      membership_type: 'materialized',
    })
  })
})

describe('importShard — E1 attachment round-trip (#237)', { timeout: 30_000 }, () => {
  it('preserves attachment metadata and byte counts without inlining raw blob payloads', async () => {
    // Source DB with one note carrying a real attachment.
    const sourceDb = await createTestDb()
    const notes = new NotesRepository(sourceDb)
    const attachments = new AttachmentsRepository(sourceDb, new MemoryBlobStore())
    const note = await notes.create({ content: 'Has attachment', title: 'Doc', tags: [] })
    await attachments.attach({
      noteId: note.id,
      data: encoder.encode('binary-payload-bytes'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      extractedText: 'report text',
    })

    // The export carries the attachment reference (S1: server `attachments` field).
    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    // Import into a fresh DB.
    const targetDb = await createTestDb()
    const result = await importShard(targetDb, archive)

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(1)

    // Shards preserve extracted text plus attachment metadata. They do not carry
    // the raw payload, so BlobStore bytes are unavailable after import unless an
    // external attachment source hydrates them separately.
    const rows = await targetDb.query<{
      id: string
      filename: string
      mime_type: string | null
      extracted_text: string | null
      content_hash: string
      size_bytes: number
      storage_path: string | null
    }>(
      `SELECT a.id, a.filename, a.mime_type, a.extracted_text, b.content_hash, b.size_bytes, b.storage_path
         FROM attachment a
         JOIN attachment_blob b ON b.id = a.blob_id`,
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({
      filename: 'report.pdf',
      mime_type: 'application/pdf',
      extracted_text: 'report text',
      size_bytes: 'binary-payload-bytes'.length,
      // storage_path is NULL on import: the browser addresses blobs by
      // content_hash via the BlobStore; `path` is the display filename, never
      // a storage locator (binary-attachment projection contract, Ask 3).
      storage_path: null,
    })
    expect(rows.rows[0].content_hash).toMatch(/^blake3:[0-9a-f]{64}$/)

    const importedAttachments = new AttachmentsRepository(targetDb, new MemoryBlobStore())
    await expect(importedAttachments.getBlob(rows.rows[0].id)).resolves.toBeNull()

    const reexported = await exportShard(targetDb)
    const reexportedFiles = unpackTarGz(reexported)
    const reexportedNote: ShardNote = JSON.parse(
      decoder.decode(reexportedFiles.get('notes.jsonl')!).split('\n')[0],
    )
    expect(reexportedNote.attachments).toEqual([
      {
        extracted_text: 'report text',
        attachment: {
          id: rows.rows[0].id,
          path: 'report.pdf',
          mime: 'application/pdf',
          checksum: rows.rows[0].content_hash,
          bytes: 'binary-payload-bytes'.length,
        },
      },
    ])
    expect(decoder.decode(reexportedFiles.get('notes.jsonl')!)).not.toContain('binary-payload-bytes')
    expect(result.warnings.some((w) => /metadata only/.test(w))).toBe(true)
    expect(result.warnings.some((w) => w.includes('#271'))).toBe(true)

    await targetDb.close()
  })

  it('restores note collection membership from collection_id', async () => {
    const sourceDb = await createTestDb()
    const notes = new NotesRepository(sourceDb)
    const collections = new CollectionsRepository(sourceDb)
    const collection = await collections.create({ name: 'Imported collection' })
    const note = await notes.create({ content: 'Collection member', title: 'Member', tags: [] })
    await collections.assignNote(collection.id, note.id)

    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const targetDb = await createTestDb()
    const result = await importShard(targetDb, archive)
    const rows = await targetDb.query<{ collection_id: string; note_id: string }>(
      'SELECT collection_id, note_id FROM collection_note',
    )

    expect(result.success).toBe(true)
    expect(rows.rows).toEqual([{ collection_id: collection.id, note_id: note.id }])

    await targetDb.close()
  })

  it('emits no attachment warning when a shard has no attachments', async () => {
    const { archive, sourceDb } = await createTestShard()
    const targetDb = await createTestDb()
    const result = await importShard(targetDb, archive)
    await sourceDb.close()

    expect(result.warnings.some((w) => /were not imported/.test(w))).toBe(false)

    await targetDb.close()
  })
})
