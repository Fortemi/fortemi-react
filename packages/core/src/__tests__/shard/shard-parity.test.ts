/**
 * Shard format parity tests — round-trip validation.
 *
 * These tests verify that:
 * 1. Exported field names match the server shard specification exactly
 * 2. Import of server-compatible shards works correctly
 * 3. Round-trip (export → import) preserves all data
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
import { unpackTarGz } from '../../shard/shard-tar.js'
import { sha256Hex } from '../../shard/checksum.js'
import { packTarGz } from '../../shard/shard-tar.js'
import type { ShardManifest, ShardNote, ShardLink, ShardCollection, ShardTag } from '../../shard/types.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

describe('shard format parity: exported field names', () => {
  let db: PGlite
  let notes: NotesRepository
  let links: LinksRepository

  beforeEach(async () => {
    db = await createTestDb()
    notes = new NotesRepository(db)
    links = new LinksRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('note JSON uses server field names: starred, archived, original_content, revised_content', async () => {
    await notes.create({ content: 'Test', title: 'Parity test', tags: ['tag1'] })
    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const noteJson = JSON.parse(decoder.decode(files.get('notes.jsonl')!).split('\n')[0])

    // Server-spec fields that MUST exist
    const requiredFields = [
      'id', 'title', 'original_content', 'revised_content',
      'format', 'source', 'starred', 'archived', 'tags',
      'created_at', 'updated_at', 'deleted_at',
    ]
    for (const field of requiredFields) {
      expect(noteJson, `Missing field: ${field}`).toHaveProperty(field)
    }

    // Browser-only fields that must NOT exist
    const forbiddenFields = [
      'is_starred', 'is_archived', 'is_pinned',
      'archive_id', 'revision_mode', 'visibility',
    ]
    for (const field of forbiddenFields) {
      expect(noteJson, `Forbidden field present: ${field}`).not.toHaveProperty(field)
    }
  })

  it('link JSON uses server field names: from_note_id, to_note_id, kind, score', async () => {
    const note1 = await notes.create({ content: 'A' })
    const note2 = await notes.create({ content: 'B' })
    await links.create(note1.id, note2.id, 'supports')

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const linkJson = JSON.parse(decoder.decode(files.get('links.jsonl')!).split('\n')[0])

    // Server-spec fields that MUST exist
    expect(linkJson).toHaveProperty('id')
    expect(linkJson).toHaveProperty('from_note_id')
    expect(linkJson).toHaveProperty('to_note_id')
    expect(linkJson).toHaveProperty('kind')
    expect(linkJson).toHaveProperty('score')
    expect(linkJson).toHaveProperty('created_at')

    // Browser-only fields that must NOT exist
    expect(linkJson).not.toHaveProperty('source_note_id')
    expect(linkJson).not.toHaveProperty('target_note_id')
    expect(linkJson).not.toHaveProperty('link_type')
    expect(linkJson).not.toHaveProperty('confidence')
    expect(linkJson).not.toHaveProperty('updated_at')
    expect(linkJson).not.toHaveProperty('deleted_at')
  })

  it('manifest schema matches server spec', async () => {
    await notes.create({ content: 'Test' })
    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(decoder.decode(files.get('manifest.json')!))

    expect(manifest.version).toBe('1.0.0')
    expect(manifest.format).toBe('matric-shard')
    expect(manifest.matric_version).toMatch(/^\d{4}\.\d+\.\d+$/) // CalVer
    expect(manifest.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO 8601
    expect(manifest.min_reader_version).toBe('1.0.0')
    expect(manifest.components).toBeInstanceOf(Array)
    expect(typeof manifest.counts).toBe('object')
    expect(typeof manifest.checksums).toBe('object')
  })

  it('JSONL format: one valid JSON object per line, no trailing commas', async () => {
    await notes.create({ content: 'Note 1' })
    await notes.create({ content: 'Note 2' })
    await notes.create({ content: 'Note 3' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const notesContent = decoder.decode(files.get('notes.jsonl')!)

    // No trailing newline should create empty lines
    const lines = notesContent.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3)

    for (const line of lines) {
      // Each line must be valid JSON
      const parsed = JSON.parse(line)
      expect(typeof parsed).toBe('object')
      // No trailing commas (would fail JSON.parse already)
      expect(line.trim()).not.toMatch(/,\s*$/)
    }
  })

  it('checksums in manifest are correct SHA-256 hex strings', async () => {
    await notes.create({ content: 'Checksum verification' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(decoder.decode(files.get('manifest.json')!))

    for (const [filename, hash] of Object.entries(manifest.checksums)) {
      // Each hash must be exactly 64 hex characters (SHA-256)
      expect(hash, `Hash for ${filename}`).toMatch(/^[0-9a-f]{64}$/)

      // Each hash must match the actual file content
      const fileData = files.get(filename)
      expect(fileData, `File ${filename} must exist`).toBeDefined()
      const actualHash = await sha256Hex(fileData!)
      expect(actualHash, `Checksum mismatch for ${filename}`).toBe(hash)
    }
  })
})

describe('shard format parity: server fixture import', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('imports a hand-crafted server-format shard', async () => {
    // Create a minimal shard that matches server output format exactly
    const shardNote: ShardNote = {
      id: '019541a0-0000-7000-8000-000000000001',
      title: 'Server Note',
      original_content: 'Content from server',
      revised_content: 'Revised on server',
      format: 'markdown',
      source: 'api',
      starred: true,
      archived: false,
      tags: ['imported', 'server'],
      created_at: '2026-01-15T10:00:00.000Z',
      updated_at: '2026-01-16T12:00:00.000Z',
      deleted_at: null,
    }

    const shardCollection: ShardCollection = {
      id: '019541a0-0000-7000-8000-000000000010',
      name: 'Server Collection',
      description: 'Imported from server',
      parent_id: null,
      created_at: '2026-01-15T10:00:00.000Z',
      note_count: 1,
    }

    const shardLink: ShardLink = {
      id: '019541a0-0000-7000-8000-000000000020',
      from_note_id: '019541a0-0000-7000-8000-000000000001',
      to_note_id: '019541a0-0000-7000-8000-000000000001',
      kind: 'self-reference',
      score: 0.95,
      created_at: '2026-01-15T10:00:00.000Z',
    }

    const shardTags: ShardTag[] = [
      { name: 'imported', created_at: '2026-01-15T10:00:00.000Z' },
      { name: 'server', created_at: '2026-01-15T10:00:00.000Z' },
    ]

    // Build shard archive
    const notesData = encoder.encode(JSON.stringify(shardNote))
    const collectionsData = encoder.encode(JSON.stringify([shardCollection]))
    const tagsData = encoder.encode(JSON.stringify(shardTags))
    const linksData = encoder.encode(JSON.stringify(shardLink))

    const checksums: Record<string, string> = {
      'notes.jsonl': await sha256Hex(notesData),
      'collections.json': await sha256Hex(collectionsData),
      'tags.json': await sha256Hex(tagsData),
      'links.jsonl': await sha256Hex(linksData),
    }

    const manifest: ShardManifest = {
      version: '1.0.0',
      matric_version: '2026.2.13',
      format: 'matric-shard',
      created_at: '2026-01-15T10:00:00.000Z',
      components: ['notes', 'collections', 'tags', 'links'],
      counts: { notes: 1, collections: 1, tags: 2, links: 1 },
      checksums,
      min_reader_version: '1.0.0',
    }

    const files = new Map<string, Uint8Array>()
    files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
    files.set('notes.jsonl', notesData)
    files.set('collections.json', collectionsData)
    files.set('tags.json', tagsData)
    files.set('links.jsonl', linksData)
    const archive = packTarGz(files)

    // Import
    const result = await importShard(db, archive)

    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(1)
    expect(result.counts.collections).toBe(1)
    expect(result.counts.links).toBe(1)

    // Verify imported data
    const notesRepo = new NotesRepository(db)
    const note = await notesRepo.get(shardNote.id)
    expect(note.title).toBe('Server Note')
    expect(note.original.content).toBe('Content from server')
    expect(note.current.content).toBe('Revised on server')
    expect(note.is_starred).toBe(true)
    expect(note.is_archived).toBe(false)
    expect(note.tags.sort()).toEqual(['imported', 'server'])
  })
})

describe('shard format parity: round-trip', () => {
  it('export → import into new DB → note count matches', { timeout: 30_000 }, async () => {
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    await sourceNotes.create({ content: 'Note 1', title: 'First', tags: ['a'] })
    await sourceNotes.create({ content: 'Note 2', title: 'Second', tags: ['b'] })
    await sourceNotes.create({ content: 'Note 3', title: 'Third', tags: ['a', 'c'] })

    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const targetDb = await createTestDb()
    const result = await importShard(targetDb, archive)
    expect(result.success).toBe(true)

    const targetNotes = new NotesRepository(targetDb)
    const list = await targetNotes.list()
    expect(list.total).toBe(3)
    await targetDb.close()
  })

  it('export → import → content identical', { timeout: 30_000 }, async () => {
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    await sourceNotes.create({ content: 'Exact content match test', title: 'Content Parity' })

    const archive = await exportShard(sourceDb)
    const sourceList = await sourceNotes.list()
    const sourceNote = await sourceNotes.get(sourceList.items[0].id)
    await sourceDb.close()

    const targetDb = await createTestDb()
    await importShard(targetDb, archive)
    const targetNotes = new NotesRepository(targetDb)
    const targetNote = await targetNotes.get(sourceNote.id)

    expect(targetNote.title).toBe(sourceNote.title)
    expect(targetNote.original.content).toBe(sourceNote.original.content)
    expect(targetNote.current.content).toBe(sourceNote.current.content)
    expect(targetNote.is_starred).toBe(sourceNote.is_starred)
    expect(targetNote.is_archived).toBe(sourceNote.is_archived)
    await targetDb.close()
  })

  it('export → import → tags preserved', { timeout: 30_000 }, async () => {
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    await sourceNotes.create({ content: 'Tagged', tags: ['alpha', 'beta', 'gamma'] })

    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const targetDb = await createTestDb()
    await importShard(targetDb, archive)
    const targetTags = new TagsRepository(targetDb)
    const allTags = await targetTags.listAllTags()
    const tagNames = allTags.map((t) => t.tag).sort()

    expect(tagNames).toEqual(['alpha', 'beta', 'gamma'])
    await targetDb.close()
  })

  it('export → import → links preserved (with field name transforms)', { timeout: 30_000 }, async () => {
    const sourceDb = await createTestDb()
    const sourceNotes = new NotesRepository(sourceDb)
    const sourceLinks = new LinksRepository(sourceDb)

    const note1 = await sourceNotes.create({ content: 'Source' })
    const note2 = await sourceNotes.create({ content: 'Target' })
    const link = await sourceLinks.create(note1.id, note2.id, 'supports')

    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const targetDb = await createTestDb()
    await importShard(targetDb, archive)

    // Verify link exists with correct field mapping
    const targetLinkRows = await targetDb.query<{
      id: string
      source_note_id: string
      target_note_id: string
      link_type: string
    }>(`SELECT id, source_note_id, target_note_id, link_type FROM link WHERE deleted_at IS NULL`)

    expect(targetLinkRows.rows).toHaveLength(1)
    expect(targetLinkRows.rows[0].id).toBe(link.id)
    expect(targetLinkRows.rows[0].source_note_id).toBe(note1.id)
    expect(targetLinkRows.rows[0].target_note_id).toBe(note2.id)
    expect(targetLinkRows.rows[0].link_type).toBe('supports')
    await targetDb.close()
  })

  it('export → import → collections preserved', { timeout: 30_000 }, async () => {
    const sourceDb = await createTestDb()
    const sourceColl = new CollectionsRepository(sourceDb)
    await sourceColl.create({ name: 'Research', description: 'Papers' })
    await sourceColl.create({ name: 'Personal' })

    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const targetDb = await createTestDb()
    await importShard(targetDb, archive)
    const targetColl = new CollectionsRepository(targetDb)
    const list = await targetColl.list()

    expect(list).toHaveLength(2)
    const names = list.map((c) => c.name).sort()
    expect(names).toEqual(['Personal', 'Research'])
    await targetDb.close()
  })
})
