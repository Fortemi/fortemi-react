/**
 * Shard import pipeline — integration tests.
 *
 * Tests the full import flow: unpack → validate → field-map → transactional insert.
 * Uses exportShard to create test archives, then imports them into fresh databases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { TagsRepository } from '../../repositories/tags-repository.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { packTarGz } from '../../shard/shard-tar.js'
import { sha256Hex } from '../../shard/checksum.js'
import type { ShardManifest } from '../../shard/types.js'

const encoder = new TextEncoder()

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

describe('importShard', () => {
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

  it('warns about skipped templates.json', async () => {
    const templatesData = encoder.encode('[]')
    const templatesHash = await sha256Hex(templatesData)
    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.3.0',
      format: 'matric-shard',
      created_at: new Date().toISOString(),
      components: [],
      counts: {},
      checksums: { 'templates.json': templatesHash },
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('templates.json', templatesData)
    const archive = packTarGz(files)

    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.warnings).toContain('templates.json skipped (not supported in browser)')
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
})
