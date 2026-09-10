import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { SourceUpsertRepository } from '../../repositories/source-upsert-repository.js'
import { aiRevisionHandler } from '../../job-queue-worker.js'
import { setLlmFunction } from '../../capabilities/llm-handler.js'
import {
  readNativeNoteHistory, replaceValidatedNativeNoteHistory,
  type NativeHistoryNote, type NativeNoteHistory,
} from '../../shard/native-note-history.js'
import { validateFullV1ShardArchive } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL(
  './fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url,
)))
const files = unpackTarGz(archive)
const records = <T>(component: string): T[] => new TextDecoder().decode(files.get(`${component}.jsonl`))
  .split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
const notes = records<NativeHistoryNote>('notes')
const source: NativeNoteHistory = {
  note_originals: records('note_originals'), note_original_history: records('note_original_history'),
  note_revisions: records('note_revisions'), note_revised_current: records('note_revised_current'),
}
const owner = source.note_originals[0].note_id
const peer = notes.find((note) => note.id !== owner)!
const sorted = (history: NativeNoteHistory) => Object.fromEntries(Object.entries(history).map(([key, rows]) =>
  [key, [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))

async function database(migrations = allMigrations): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(migrations)
  return db
}

describe('native note-history apply stage, not full-v1 archive dispatch', () => {
  let db: PGlite
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await database()
    for (const note of notes) await db.query(
      'INSERT INTO note (id, created_at, updated_at) VALUES ($1, $2, $3)',
      [note.id, note.created_at, note.updated_at],
    )
  })
  afterEach(async () => { setLlmFunction(null); await db.close() })
  const apply = (db: PGlite, history = source, selected = notes) => db.transaction((tx) =>
    replaceValidatedNativeNoteHistory(tx, selected, history))
  const job = (noteId = owner): Parameters<typeof aiRevisionHandler>[0] => ({
    id: 'history-test-job', note_id: noteId, job_type: 'ai_revision', status: 'running',
    priority: 1, required_capability: 'llm', retry_count: 0, max_retries: 3,
    error: null, result: null, created_at: new Date(), updated_at: new Date(),
  })

  it('restores every history field to native tables and exposes repository reads', async () => {
    expect(await apply(db)).toEqual({ note_originals: 1, note_original_history: 2, note_revisions: 2, note_revised_current: 1 })
    expect(sorted(await readNativeNoteHistory(db))).toEqual(sorted(source))
    const repository = new NotesRepository(db)
    const note = await repository.get(owner)
    expect(note.original).toMatchObject({ id: source.note_originals[0].id,
      content: source.note_originals[0].content, content_hash: source.note_originals[0].hash,
      version_number: 3, user_created_at: null, user_last_edited_at: source.note_originals[0].user_last_edited_at })
    expect(note.current).toMatchObject({ content: source.note_revised_current[0].content,
      last_revision_id: source.note_revised_current[0].last_revision_id, generation_count: 2, is_user_edited: true })
    expect(await repository.getOriginalHistory(owner)).toEqual([...source.note_original_history].reverse())
    expect(await repository.getRevisions(owner)).toEqual([...source.note_revisions].reverse()
      .map((row) => expect.objectContaining(row)))
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
  })

  it('keeps fallback contents usable without inventing absent component records', async () => {
    await apply(db)
    const note = await new NotesRepository(db).get(peer.id)
    expect(note.original.id).toBeNull()
    expect(note.original.content).toBe(peer.original_content)
    expect(note.current.content).toBe(peer.revised_content)
    expect(await readNativeNoteHistory(db, [peer.id])).toEqual({
      note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [],
    })
    expect(await readNativeNoteHistory(db, [])).toEqual({
      note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [],
    })
  })

  it('retains nullable and repeated original IDs under distinct note owners', async () => {
    const history = structuredClone(source)
    history.note_originals[0].id = null
    await apply(db, history)
    expect((await new NotesRepository(db).get(owner)).original.id).toBeNull()
    expect(sorted(await readNativeNoteHistory(db))).toEqual(sorted(history))
    history.note_originals[0].id = source.note_originals[0].id
    history.note_originals.push({ ...history.note_originals[0], note_id: peer.id, content: peer.original_content })
    await apply(db, history)
    expect(sorted(await readNativeNoteHistory(db))).toEqual(sorted(history))
    expect((await db.query('SELECT count(*)::int AS n FROM note_original')).rows).toEqual([{ n: 2 }])
  })

  it('preserves scalar timestamp precision and respects a later native timestamp change', async () => {
    const history = structuredClone(source)
    const timestamp = '2026-07-18T10:30:00.123456789Z'
    history.note_revisions[0].created_at_utc = timestamp
    history.note_original_history[0].created_at_utc = timestamp
    history.note_originals[0].user_created_at = timestamp
    await apply(db, history)
    expect(sorted(await readNativeNoteHistory(db))).toEqual(sorted(history))
    await db.query("UPDATE note_revision SET created_at = created_at + interval '1 second' WHERE id = $1", [history.note_revisions[0].id])
    const restored = await readNativeNoteHistory(db)
    expect(restored.note_revisions[0].created_at_utc).not.toBe(timestamp)
    expect(restored.note_revisions[0].created_at_utc).toMatch(/^2026-07-18T10:30:01\./)
  })

  it.each([null, {}, [], '', false, 0])('preserves current JSON metadata %j', async (metadata) => {
    const history = structuredClone(source)
    history.note_revised_current[0].ai_metadata = metadata
    await apply(db, history)
    expect((await readNativeNoteHistory(db)).note_revised_current[0].ai_metadata).toEqual(metadata)
  })

  it('replaces repeatedly, removes obsolete history, and preserves unrelated notes', async () => {
    const other = await new NotesRepository(db).create({ content: 'Unrelated note', title: 'Unrelated' })
    const untouched = await readNativeNoteHistory(db, [other.id])
    await apply(db)
    await apply(db)
    expect(sorted(await readNativeNoteHistory(db, notes.map((note) => note.id)))).toEqual(sorted(source))
    await apply(db, { ...source, note_original_history: [] })
    expect((await new NotesRepository(db).getOriginalHistory(owner))).toEqual([])
    expect(await readNativeNoteHistory(db, [other.id])).toEqual(untouched)
  })

  it('makes local edits usable after sparse imported revision numbers', async () => {
    const history = structuredClone(source)
    history.note_revisions[0].revision_number = 3
    history.note_revisions[1].revision_number = 20
    await apply(db, history)
    const repository = new NotesRepository(db)
    await repository.update(owner, { content: 'Edited after restore' })
    const revised = await repository.getRevisions(owner)
    expect(revised.map((row) => row.revision_number)).toEqual([21, 20, 3])
    expect(revised[0].parent_revision_id).toBe(history.note_revisions[1].id)
    const current = (await readNativeNoteHistory(db)).note_revised_current[0]
    expect(current.content).toBe('Edited after restore')
    expect(current.last_revision_id).toBeNull()
    expect((await readNativeNoteHistory(db)).note_revisions.slice(0, 2)).toEqual(history.note_revisions)
    await repository.update(peer.id, { content: 'Edited fallback content' })
    expect((await readNativeNoteHistory(db, [peer.id])).note_revised_current[0].content).toBe('Edited fallback content')
    expect((await readNativeNoteHistory(db, [peer.id])).note_originals).toEqual([])
  })

  it('rolls back replacement after a late failure in the enclosing transaction', async () => {
    await apply(db)
    const before = await readNativeNoteHistory(db)
    await expect(db.transaction(async (tx) => {
      await replaceValidatedNativeNoteHistory(tx, notes, { ...source, note_original_history: [] })
      throw new Error('injected after native history apply')
    })).rejects.toThrow('injected after native history apply')
    expect(await readNativeNoteHistory(db)).toEqual(before)
  })

  it('versions source updates after restored sparse history and retains replaced originals', async () => {
    const repository = new SourceUpsertRepository(db)
    const request = (content: string, policy: 'version' | 'replace' = 'version') => ({
      source_namespace: 'history-test', source_schema_version: '1.0.0',
      import_run_id: content, batch_id: content, policy,
      items: [{ external_id: 'fixture-owner', content }],
    })
    const inserted = await repository.upsertRequest(request('Source initial'))
    const noteId = inserted.items[0].note_id!
    const history = structuredClone(source)
    for (const rows of Object.values(history)) for (const row of rows) row.note_id = noteId
    history.note_revisions[0].revision_number = 3
    history.note_revisions[1].revision_number = 20
    await apply(db, history, [{ ...notes.find((note) => note.id === owner)!, id: noteId }])
    expect((await repository.upsertRequest(request('Source version'))).counts.versioned).toBe(1)
    const versioned = await readNativeNoteHistory(db, [noteId])
    const latest = versioned.note_revisions[2]
    expect(latest).toMatchObject({ revision_number: 21, parent_revision_id: history.note_revisions[1].id, content: 'Source version' })
    expect(versioned.note_revised_current[0]).toMatchObject({ content: 'Source version', last_revision_id: latest.id })
    expect(versioned.note_revisions.slice(0, 2)).toEqual(history.note_revisions)
    expect((await repository.upsertRequest(request('Source replacement', 'replace'))).counts.replaced).toBe(1)
    const replaced = await readNativeNoteHistory(db, [noteId])
    expect(replaced.note_originals[0]).toMatchObject({ version_number: 4, content: 'Source replacement' })
    expect(replaced.note_original_history.slice(0, 2)).toEqual(history.note_original_history)
    expect(replaced.note_original_history[2]).toMatchObject({ version_number: 3,
      content: history.note_originals[0].content, hash: history.note_originals[0].hash })
    expect(replaced.note_revised_current[0]).toMatchObject({ content: 'Source replacement', last_revision_id: null })
    expect(replaced.note_revisions).toEqual(versioned.note_revisions)
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
  })

  it('commits AI history, native current pointer, and follow-up job together', async () => {
    const history = structuredClone(source)
    history.note_revisions[1].revision_number = 20
    await apply(db, history)
    setLlmFunction(async () => 'AI revision after restore')
    const result = await aiRevisionHandler(job(), db)
    const after = await readNativeNoteHistory(db, [owner])
    const latest = after.note_revisions[2]
    expect(result).toEqual({ revision_number: 21, revision_id: latest.id, model: 'llm' })
    expect(latest).toMatchObject({ content: 'AI revision after restore', generation_count: 3,
      parent_revision_id: history.note_revisions[1].id, is_user_edited: false })
    expect(latest.ai_generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(after.note_revisions.slice(0, 2)).toEqual(history.note_revisions)
    expect(after.note_revised_current[0]).toMatchObject({ content: latest.content, last_revision_id: latest.id })
    expect((await db.query('SELECT note_id, job_type FROM job_queue')).rows)
      .toEqual([{ note_id: owner, job_type: 'concept_tagging' }])
  })

  it('does not overwrite native edits made while AI inference was running', async () => {
    await apply(db)
    setLlmFunction(async () => {
      await new NotesRepository(db).update(owner, { content: 'User edit during inference' })
      return 'Stale AI output'
    })
    expect(await aiRevisionHandler(job(), db)).toEqual({ skipped: true, reason: 'content changed during inference' })
    const after = await readNativeNoteHistory(db, [owner])
    expect(after.note_revised_current[0].content).toBe('User edit during inference')
    expect(after.note_revisions).toHaveLength(3)
    expect(after.note_revisions.some((row) => row.content === 'Stale AI output')).toBe(false)
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
  })

  it('rolls back AI history and current state when follow-up job insertion fails', async () => {
    await apply(db)
    const before = await readNativeNoteHistory(db)
    await db.exec("ALTER TABLE job_queue ADD CONSTRAINT injected_job_failure CHECK (job_type <> 'concept_tagging')")
    setLlmFunction(async () => 'AI output that cannot be committed')
    await expect(aiRevisionHandler(job(), db)).rejects.toThrow()
    expect(await readNativeNoteHistory(db)).toEqual(before)
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
  })

  it('keeps native null current content visible instead of substituting old source content', async () => {
    await apply(db)
    await db.query('UPDATE note_revised_current SET content = NULL, last_revision_id = NULL WHERE note_id = $1', [owner])
    expect((await readNativeNoteHistory(db, [owner])).note_revised_current[0].content).toBeNull()
    setLlmFunction(async () => { throw new Error('must not infer over null content') })
    expect(await aiRevisionHandler(job(), db)).toEqual({ skipped: true, reason: 'null current content' })
    await new NotesRepository(db).update(owner, { content: 'Authored after null' })
    expect((await readNativeNoteHistory(db, [owner])).note_revised_current[0].content).toBe('Authored after null')
    expect((await readNativeNoteHistory(db, [owner])).note_revisions).toEqual(source.note_revisions)
  })

  it('enforces same-note revision ownership even when an internal caller bypasses preflight', async () => {
    await apply(db)
    const before = await readNativeNoteHistory(db)
    await expect(db.transaction(async (tx) => {
      await tx.query('UPDATE note_revised_current SET last_revision_id = $1 WHERE note_id = $2',
        [source.note_revisions[0].id, peer.id])
    })).rejects.toThrow()
    expect(await readNativeNoteHistory(db)).toEqual(before)
  })
})

it('fails an ambiguous legacy-owner migration atomically without deleting either original', async () => {
  const db = await database(allMigrations.filter((migration) => migration.version < 25))
  try {
    await db.query('INSERT INTO note (id) VALUES ($1)', [owner])
    for (const id of ['legacy-original-a', 'legacy-original-b']) await db.query(
      'INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $1, $1)', [id, owner],
    )
    await expect(new MigrationRunner(db).apply(allMigrations)).rejects.toThrow()
    expect(await new MigrationRunner(db).getCurrentVersion()).toBe(24)
    expect((await db.query('SELECT id FROM note_original ORDER BY id')).rows)
      .toEqual([{ id: 'legacy-original-a' }, { id: 'legacy-original-b' }])
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='note_original' AND column_name='version_number'")).rows).toEqual([])
  } finally { await db.close() }
})
