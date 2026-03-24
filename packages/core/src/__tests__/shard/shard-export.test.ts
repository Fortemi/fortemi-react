/**
 * Shard export pipeline — integration tests.
 *
 * Spins up a fresh PGlite, populates data, exports a shard, and validates
 * the archive contents match the server shard format specification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { exportShard } from '../../shard/shard-export.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import { validateChecksums } from '../../shard/checksum.js'
import type { ShardManifest, ShardNote, ShardLink, ShardCollection } from '../../shard/types.js'

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

describe('exportShard', () => {
  let db: PGlite
  let notes: NotesRepository
  let collections: CollectionsRepository
  let links: LinksRepository
  beforeEach(async () => {
    db = await createTestDb()
    notes = new NotesRepository(db)
    collections = new CollectionsRepository(db)
    links = new LinksRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('exports a valid tar.gz archive', async () => {
    await notes.create({ content: 'Hello world', title: 'Test' })

    const archive = await exportShard(db)
    expect(archive).toBeInstanceOf(Uint8Array)
    expect(archive.byteLength).toBeGreaterThan(0)

    // Should be valid tar.gz
    const files = unpackTarGz(archive)
    expect(files.has('manifest.json')).toBe(true)
    expect(files.has('notes.jsonl')).toBe(true)
  })

  it('manifest has correct structure', async () => {
    await notes.create({ content: 'Test note' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )

    expect(manifest.version).toBe('1.0.0')
    expect(manifest.format).toBe('matric-shard')
    expect(manifest.matric_version).toBeTruthy()
    expect(manifest.created_at).toBeTruthy()
    expect(manifest.min_reader_version).toBe('1.0.0')
    expect(manifest.components).toContain('notes')
    expect(manifest.counts.notes).toBe(1)
  })

  it('all checksums are valid', async () => {
    await notes.create({ content: 'Checksum test' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )

    const result = await validateChecksums(manifest.checksums, files)
    expect(result.valid).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('notes use shard field names (starred, not is_starred)', async () => {
    await notes.create({ content: 'Field test', title: 'Star test' })
    // Star the note
    const noteList = await notes.list()
    await notes.star(noteList.items[0].id, true)

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const notesJsonl = new TextDecoder().decode(files.get('notes.jsonl')!)
    const shardNote: ShardNote = JSON.parse(notesJsonl.split('\n')[0])

    expect(shardNote).toHaveProperty('starred')
    expect(shardNote).toHaveProperty('archived')
    expect(shardNote).not.toHaveProperty('is_starred')
    expect(shardNote).not.toHaveProperty('is_archived')
    expect(shardNote.starred).toBe(true)
  })

  it('notes contain original_content and revised_content', async () => {
    await notes.create({ content: 'My content' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const notesJsonl = new TextDecoder().decode(files.get('notes.jsonl')!)
    const shardNote: ShardNote = JSON.parse(notesJsonl.split('\n')[0])

    expect(shardNote.original_content).toBe('My content')
    expect(shardNote.revised_content).toBe('My content')
  })

  it('exports tags as note-level arrays', async () => {
    await notes.create({ content: 'Tagged note', tags: ['physics', 'math'] })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const notesJsonl = new TextDecoder().decode(files.get('notes.jsonl')!)
    const shardNote: ShardNote = JSON.parse(notesJsonl.split('\n')[0])

    expect(shardNote.tags.sort()).toEqual(['math', 'physics'])
  })

  it('exports collections as JSON array', async () => {
    await collections.create({ name: 'Research', description: 'Papers' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const collectionsJson: ShardCollection[] = JSON.parse(
      new TextDecoder().decode(files.get('collections.json')!),
    )

    expect(collectionsJson).toHaveLength(1)
    expect(collectionsJson[0].name).toBe('Research')
    expect(collectionsJson[0].description).toBe('Papers')
  })

  it('exports links with shard field names', async () => {
    const note1 = await notes.create({ content: 'Note A' })
    const note2 = await notes.create({ content: 'Note B' })
    await links.create(note1.id, note2.id, 'related')

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const linksJsonl = new TextDecoder().decode(files.get('links.jsonl')!)
    const shardLink: ShardLink = JSON.parse(linksJsonl.split('\n')[0])

    expect(shardLink).toHaveProperty('from_note_id')
    expect(shardLink).toHaveProperty('to_note_id')
    expect(shardLink).toHaveProperty('kind')
    expect(shardLink).not.toHaveProperty('source_note_id')
    expect(shardLink).not.toHaveProperty('target_note_id')
    expect(shardLink).not.toHaveProperty('link_type')
    expect(shardLink.from_note_id).toBe(note1.id)
    expect(shardLink.to_note_id).toBe(note2.id)
    expect(shardLink.kind).toBe('related')
  })

  it('JSONL format: one valid JSON per line', async () => {
    await notes.create({ content: 'Note 1' })
    await notes.create({ content: 'Note 2' })
    await notes.create({ content: 'Note 3' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const notesJsonl = new TextDecoder().decode(files.get('notes.jsonl')!)
    const lines = notesJsonl.split('\n')

    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('excludes soft-deleted notes', async () => {
    await notes.create({ content: 'Active' })
    const note2 = await notes.create({ content: 'Deleted' })
    await notes.delete(note2.id)

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )
    expect(manifest.counts.notes).toBe(1)
  })

  it('does not include embeddings by default', async () => {
    await notes.create({ content: 'Test' })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)

    expect(files.has('embeddings.jsonl')).toBe(false)
    expect(files.has('embedding_sets.json')).toBe(false)
  })

  it('exports global tag list', async () => {
    await notes.create({ content: 'A', tags: ['alpha', 'beta'] })
    await notes.create({ content: 'B', tags: ['beta', 'gamma'] })

    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const tagsJson = JSON.parse(new TextDecoder().decode(files.get('tags.json')!))
    const tagNames = tagsJson.map((t: { name: string }) => t.name).sort()

    expect(tagNames).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('exports empty archive when no data exists', async () => {
    const archive = await exportShard(db)
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )

    expect(manifest.counts.notes).toBe(0)
    expect(manifest.counts.links).toBe(0)
    expect(manifest.counts.collections).toBe(0)
  })

  it('tag filter exports only notes with that tag', async () => {
    await notes.create({ content: 'Research note', tags: ['app:research', 'ml'] })
    await notes.create({ content: 'Journal note', tags: ['app:journal'] })
    await notes.create({ content: 'Another research', tags: ['app:research', 'nlp'] })

    const archive = await exportShard(db, { tag: 'app:research' })
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )

    expect(manifest.counts.notes).toBe(2)

    // Tags should only include tags from exported notes, not app:journal
    const tagsJson = JSON.parse(new TextDecoder().decode(files.get('tags.json')!))
    const tagNames = tagsJson.map((t: { name: string }) => t.name).sort()
    expect(tagNames).toEqual(['app:research', 'ml', 'nlp'])
    expect(tagNames).not.toContain('app:journal')
  })

  it('tag filter scopes links to exported notes only', async () => {
    const note1 = await notes.create({ content: 'A', tags: ['app:research'] })
    const note2 = await notes.create({ content: 'B', tags: ['app:research'] })
    const note3 = await notes.create({ content: 'C', tags: ['app:journal'] })
    await links.create(note1.id, note2.id, 'related') // both in export
    await links.create(note1.id, note3.id, 'related') // note3 not in export

    const archive = await exportShard(db, { tag: 'app:research' })
    const files = unpackTarGz(archive)
    const manifest: ShardManifest = JSON.parse(
      new TextDecoder().decode(files.get('manifest.json')!),
    )

    expect(manifest.counts.links).toBe(1) // only the link between note1 and note2
  })
})
