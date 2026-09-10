import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { TagsRepository } from '../../repositories/tags-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { SearchRepository } from '../../repositories/search-repository.js'
import { TemplatesRepository } from '../../repositories/templates-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { AttachmentsRepository } from '../../repositories/attachments-repository.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { applyValidatedNativeCore, readNativeCore, type NativeCore } from '../../shard/native-core.js'
import { readNativeNoteHistory, type NativeNoteHistory } from '../../shard/native-note-history.js'
import { validateFullV1ShardArchive, validateShardComponentRecord } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
function records<T>(component: string): T[] {
  const json = files.get(`${component}.json`)
  const text = new TextDecoder().decode(json ?? files.get(`${component}.jsonl`))
  return json ? JSON.parse(text) as T[] : text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}
const source: NativeCore = { notes: records('notes'), collections: records('collections'), tags: records('tags'), templates: records('templates'), links: records('links') }
const history: NativeNoteHistory = { note_originals: records('note_originals'), note_original_history: records('note_original_history'),
  note_revisions: records('note_revisions'), note_revised_current: records('note_revised_current') }
const timestamp = '2026-07-18T10:30:00.123456789Z'

describe('native core stage, not public full-v1 restoration', () => {
  let db: PGlite
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
  })
  afterEach(async () => { await db.close() })
  async function apply(state = source, stateHistory = history): Promise<void> {
    for (const component of Object.keys(state) as (keyof NativeCore)[]) for (const row of state[component]) {
      expect(validateShardComponentRecord(component, row, 'full-v1', '2.0.0').errors).toEqual([])
    }
    await db.transaction((tx) => applyValidatedNativeCore(tx, state, stateHistory))
  }
  async function expectState(state: NativeCore): Promise<void> {
    const actual = await readNativeCore(db)
    for (const component of Object.keys(state) as (keyof NativeCore)[]) {
      expect(actual[component]).toHaveLength(state[component].length)
      expect(actual[component]).toEqual(expect.arrayContaining<unknown>(state[component]))
    }
  }

  it('restores all five core components, history and ordered attachments without archive rows or jobs', async () => {
    await apply()
    await expectState(source)
    expect((await new NotesRepository(db).get(source.notes[0].id)).metadata).toEqual(source.notes[0].metadata)
    expect(await new TagsRepository(db).listRecords()).toEqual(expect.arrayContaining(source.tags))
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    const ids = (await db.query('SELECT id FROM note_tag ORDER BY id')).rows
    await apply()
    await expectState(source)
    expect((await db.query('SELECT id FROM note_tag ORDER BY id')).rows).toEqual(ids)
    const actualHistory = await readNativeNoteHistory(db)
    for (const component of Object.keys(history) as (keyof NativeNoteHistory)[]) {
      expect(actualHistory[component]).toEqual(expect.arrayContaining<unknown>(history[component]))
      expect(actualHistory[component]).toHaveLength(history[component].length)
    }
  })

  it('preserves arbitrary metadata, precise timestamps, array order, paths and link scores', async () => {
    const state = structuredClone(source)
    for (const note of state.notes) {
      Object.assign(note, { title: '', metadata: [null, '', false, 0, {}, { nested: null }], created_at: timestamp, updated_at: timestamp, deleted_at: timestamp })
      note.tags.reverse()
      for (const projection of note.attachments) projection.attachment.path = `dir/sub/${projection.attachment.path}`
    }
    for (const collection of state.collections) Object.assign(collection, { description: '', created_at: timestamp, note_count: 43 })
    for (const tag of state.tags) tag.created_at = timestamp
    for (const template of state.templates) Object.assign(template, { description: '', content: '', created_at: timestamp, updated_at: timestamp, default_tags: ['Z', 'a'] })
    for (const link of state.links) Object.assign(link, { metadata: 'literal JSON string', score: Math.PI, created_at: timestamp })
    await apply(state)
    await expectState(state)
    expect((await new NotesRepository(db).get(state.notes[0].id)).current.ai_metadata).toEqual(history.note_revised_current.find((row) => row.note_id === state.notes[0].id)!.ai_metadata)
  })

  it('preserves missing/null/value tombstones and follows later native deletion and restoration', async () => {
    const state = structuredClone(source)
    delete state.notes[0].deleted_at
    state.notes[1].deleted_at = null
    await apply(state)
    await expectState(state)
    const notes = new NotesRepository(db)
    await notes.delete(state.notes[0].id)
    expect((await readNativeCore(db)).notes.find((note) => note.id === state.notes[0].id)!.deleted_at).toBeTypeOf('string')
    await notes.restore(state.notes[0].id)
    expect((await readNativeCore(db)).notes.find((note) => note.id === state.notes[0].id)!.deleted_at).toBeNull()
    await apply(state)
    await expectState(state)
  })

  it('keeps note metadata independent from current AI metadata and searchable after edits', async () => {
    const state = structuredClone(source)
    state.notes[0].metadata = { provider: 'native-note' }
    await apply(state)
    const id = state.notes[0].id
    await db.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [id, '{"provider":"ai-only"}'])
    const repo = new NotesRepository(db)
    expect((await repo.get(id)).metadata).toEqual({ provider: 'native-note' })
    const search = new SearchRepository(db)
    expect((await search.search('', { mode: 'text', metadataPredicates: [{ path: 'provider', op: 'eq', value: 'native-note' }] })).results.map((row) => row.id)).toContain(id)
    await repo.update(id, { metadata: 'not serialized twice' })
    expect((await readNativeCore(db)).notes.find((note) => note.id === id)!.metadata).toBe('not serialized twice')
    expect((await repo.get(id)).current.ai_metadata).toEqual({ provider: 'ai-only' })
  })

  it('keeps legacy metadata projection for newly authored notes until metadata is explicit', async () => {
    const notes = new NotesRepository(db)
    const legacy = await notes.create({ title: 'Legacy authoring', content: '' })
    await db.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [legacy.id, '{"provider":"legacy-ai"}'])
    expect((await notes.get(legacy.id)).metadata).toEqual({ provider: 'legacy-ai' })
    const explicit = await notes.create({ title: 'Explicit null', content: '', metadata: null })
    await db.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [explicit.id, '{"provider":"ai-only"}'])
    expect((await notes.get(explicit.id)).metadata).toBeNull()
    await notes.update(legacy.id, { metadata: false })
    await db.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [legacy.id, 'null'])
    expect((await notes.get(legacy.id)).metadata).toBe(false)
  })

  it('retains unused declared tags and does not invent undeclared component rows', async () => {
    const state = structuredClone(source)
    state.tags.push({ name: 'unused', created_at: timestamp })
    state.notes[0].tags = ['Z', 'a', 'not-declared']
    await apply(state)
    await expectState(state)
    const tags = new TagsRepository(db)
    await tags.addTag(state.notes[0].id, 'authored')
    expect((await tags.listRecords()).map((row) => row.name)).toContain('authored')
    await tags.addTag(state.notes[0].id, 'not-declared')
    expect((await tags.listRecords()).map((row) => row.name)).toContain('not-declared')
    await expect(tags.addTag('missing-note', 'must-rollback')).rejects.toThrow()
    expect((await tags.listRecords()).map((row) => row.name)).not.toContain('must-rollback')
    await tags.removeTag(state.notes[0].id, 'authored')
    expect((await tags.listRecords()).map((row) => row.name)).toContain('authored')
  })

  it('retains snapshot collection counts until native membership changes', async () => {
    const state = structuredClone(source)
    state.collections.reverse()
    state.collections.forEach((row) => { row.note_count = 99 })
    await apply(state)
    await expectState(state)
    const note = state.notes.find((row) => row.collection_id !== null)!
    const collections = new CollectionsRepository(db)
    await collections.unassignNote(note.collection_id!, note.id)
    const actual = await readNativeCore(db)
    const count = actual.notes.filter((row) => row.collection_id === note.collection_id).length
    expect(actual.collections.find((row) => row.id === note.collection_id)!.note_count).toBe(count)
    await apply(state)
    await expectState(state)
  })

  it('moves a link between URL and note targets without duplicate identities', async () => {
    await apply()
    const state = structuredClone(source)
    const link = state.links[0]
    link.to_note_id = null; link.to_url = 'https://example.test/path'
    await apply(state)
    await expectState(state)
    expect((await db.query('SELECT 1 FROM link WHERE id = $1', [link.id])).rows).toEqual([])
    await new LinksRepository(db).delete(link.id)
    expect(await new LinksRepository(db).getRecord(link.id)).toBeNull()
    await apply(source)
    await expectState(source)
  })

  it('replaces selected attachment lists and rejects conflicting blob size atomically', async () => {
    await apply()
    const state = structuredClone(source)
    const note = state.notes.find((row) => row.attachments.length > 0)!
    note.attachments[0].attachment.bytes += 1
    await expect(db.transaction((tx) => applyValidatedNativeCore(tx, state, history))).rejects.toThrow('blob size conflicts')
    await expectState(source)
    note.attachments = []
    await apply(state)
    await expectState(state)
    expect((await db.query('SELECT * FROM attachment WHERE note_id = $1', [note.id])).rows).toEqual([])
    expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM attachment_blob')).rows[0].n).not.toBe(0)
  })

  it('exposes imported templates and both link targets through native repositories', async () => {
    await apply()
    const templates = new TemplatesRepository(db)
    expect(await templates.list()).toEqual(expect.arrayContaining(source.templates))
    const template = source.templates[0]
    await templates.update(template.id, { description: null, content: '', default_tags: ['Z', 'a'], collection_id: null })
    expect(await templates.get(template.id)).toMatchObject({ description: null, content: '', default_tags: ['Z', 'a'], collection_id: null })
    await expect(templates.update(template.id, { name: '' })).rejects.toThrow('Invalid native template')
    expect((await templates.get(template.id)).name).toBe(template.name)
    const created = await templates.create({ name: 'Native', content: '' })
    await templates.delete(created.id)
    await expect(templates.get(created.id)).rejects.toThrow('not found')
    await expect(templates.create({ name: '', content: '' })).rejects.toThrow('Invalid native template')
    const links = new LinksRepository(db)
    for (const link of source.links) expect(await links.getRecord(link.id)).toEqual(link)
    expect(await links.getRecord('019577b4-a7c0-7000-8000-000000009999')).toBeNull()
    for (const collection of source.collections) expect(await new CollectionsRepository(db).getRecord(collection.id)).toEqual(collection)
  })

  it('reads actual validated attachment bytes and follows native extraction changes', async () => {
    const blobs = new MemoryBlobStore()
    for (const [path, bytes] of files) if (path.startsWith('blobs/')) expect(await blobs.put(bytes)).toBe(`blake3:${path.slice(6)}`)
    await apply()
    const attachments = new AttachmentsRepository(db, blobs)
    for (const note of source.notes) for (const projection of note.attachments) {
      expect(await attachments.getBlob(projection.attachment.id)).toEqual(files.get(`blobs/${projection.attachment.checksum.slice(7)}`))
    }
    const note = source.notes.find((row) => row.attachments.length > 0)!
    const id = note.attachments[0].attachment.id
    await db.query("UPDATE attachment SET extracted_text = 'fresh extraction', status = 'completed', filename = 'new/path.txt' WHERE id = $1", [id])
    let actual = (await readNativeCore(db)).notes.find((row) => row.id === note.id)!.attachments[0]
    expect(actual).toMatchObject({ extracted_text: 'fresh extraction', extraction_status: 'extracted', reason: null, attachment: { path: 'new/path.txt' } })
    await db.query("UPDATE attachment SET status = 'quarantined' WHERE id = $1", [id])
    actual = (await readNativeCore(db)).notes.find((row) => row.id === note.id)!.attachments[0]
    expect(actual).toMatchObject({ extraction_status: 'blocked', reason: 'quarantined' })
    await apply()
    await expectState(source)
  })

  it('rolls back a late deferred relationship failure with original native history and attachments intact', async () => {
    await apply()
    const oldHistory = await readNativeNoteHistory(db)
    const state = structuredClone(source)
    state.notes[0].title = 'must roll back'
    state.notes[0].attachments = []
    state.templates[0].collection_id = '019577b4-a7c0-7000-8000-000000009999'
    await expect(db.transaction((tx) => applyValidatedNativeCore(tx, state, history))).rejects.toThrow()
    await expectState(source)
    expect(await readNativeNoteHistory(db)).toEqual(oldHistory)
  })

  it('preserves multiple native memberships but rejects their single-collection wire projection', async () => {
    await apply()
    const collection = await new CollectionsRepository(db).create({ name: 'Additional' })
    await new CollectionsRepository(db).assignNote(collection.id, source.notes.find((row) => row.collection_id !== null)!.id)
    await expect(readNativeCore(db)).rejects.toThrow('Multiple native collection memberships')
  })

  it('backfills legacy metadata and tag timestamps without altering original rows', async () => {
    const legacy = await PGlite.create({ extensions: { vector } })
    try {
      await legacy.exec('CREATE EXTENSION IF NOT EXISTS vector')
      await new MigrationRunner(legacy).apply(allMigrations.filter((migration) => migration.version < 30))
      const id = source.notes[0].id
      await legacy.query('INSERT INTO note (id, title) VALUES ($1, $2)', [id, 'Legacy'])
      await legacy.query('INSERT INTO note_revised_current (note_id, content, ai_metadata) VALUES ($1, $2, $3::jsonb)', [id, '', '"literal"'])
      await legacy.query('INSERT INTO note_tag (id, note_id, tag, created_at) VALUES ($1, $2, $3, $4)', [source.links[0].id, id, 'LegacyTag', timestamp])
      await new MigrationRunner(legacy).apply(allMigrations)
      expect((await new NotesRepository(legacy).get(id)).metadata).toBe('literal')
      expect((await new TagsRepository(legacy).listRecords())[0]).toMatchObject({ name: 'LegacyTag' })
      expect((await new TagsRepository(legacy).listRecords())[0].created_at).toBe('2026-07-18T10:30:00.123457Z')
      await legacy.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [id, 'false'])
      expect((await new NotesRepository(legacy).get(id)).metadata).toBe(false)
      await new NotesRepository(legacy).update(id, { metadata: { provider: 'explicit' } })
      await legacy.query('UPDATE note_revised_current SET ai_metadata = $2::jsonb WHERE note_id = $1', [id, 'null'])
      expect((await new NotesRepository(legacy).get(id)).metadata).toEqual({ provider: 'explicit' })
    } finally { await legacy.close() }
  })

  it('rejects unrepresentable native state instead of replaying a prior archive', async () => {
    await apply()
    await db.query('UPDATE link SET confidence = NULL WHERE id = $1', [source.links[0].id])
    await expect(readNativeCore(db)).rejects.toThrow('not representable')
    await apply()
    await db.query('UPDATE collection SET deleted_at = now() WHERE id = $1', [source.collections[0].id])
    await expect(readNativeCore(db)).rejects.toThrow('tombstone')
  })
})
