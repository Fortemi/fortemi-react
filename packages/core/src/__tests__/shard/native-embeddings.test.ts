import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { EmbeddingSetsRepository } from '../../repositories/embedding-sets-repository.js'
import { SearchRepository } from '../../repositories/search-repository.js'
import { linkingHandler } from '../../job-queue-worker.js'
import { applyValidatedNativeEmbeddings, readNativeEmbeddings, type NativeEmbeddings } from '../../shard/native-embeddings.js'
import { validateFullV1ShardArchive, validateShardComponentRecord } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
const records = <T>(path: string): T[] => {
  const text = new TextDecoder().decode(files.get(path))
  return path.endsWith('.jsonl') ? text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T) : JSON.parse(text) as T[]
}
const notes = records<{ id: string; revised_content: string }>('notes.jsonl')
const source: NativeEmbeddings = {
  embedding_configs: records('embedding_configs.json'), embedding_sets: records('embedding_sets.json'),
  embedding_set_members: records('embedding_set_members.jsonl'), embeddings: records('embeddings.jsonl'),
}
const owner = source.embeddings[0].note_id!
const peer = notes.find((row) => row.id !== owner)!.id

describe('native embedding stage, not public full-v1 restoration', () => {
  let db: PGlite
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    for (const row of notes) {
      await db.query('INSERT INTO note (id, title) VALUES ($1, $2)', [row.id, row.revised_content])
      await db.query('INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)', [row.id, row.revised_content])
    }
  })
  afterEach(async () => { await db.close() })
  async function apply(state = source): Promise<void> {
    for (const component of Object.keys(state) as (keyof NativeEmbeddings)[]) for (const row of state[component]) {
      const validation = validateShardComponentRecord(component, row, 'full-v1', '2.0.0')
      expect(validation.errors).toEqual([])
    }
    await db.transaction((tx) => applyValidatedNativeEmbeddings(tx, state))
  }

  it('restores all embedding fields to native state and resolves usable 768-dimensional vectors', async () => {
    await apply()
    expect(await readNativeEmbeddings(db)).toEqual(source)
    const sets = new EmbeddingSetsRepository(db)
    expect(await sets.get(source.embedding_sets[0].id)).toMatchObject({ model_name: 'test-model', dimensions: 768 })
    expect(await sets.getConfig(source.embedding_configs[0].id)).toMatchObject({ name: 'Research config', model: 'test-model', dimension: 768 })
    expect(await sets.listConfigs()).toHaveLength(1)
    expect(await sets.listMembers(source.embedding_sets[0].id)).toEqual([
      expect.objectContaining({ ...source.embedding_set_members[0], embedding_id: null }),
    ])
    expect((await sets.listEmbeddings(source.embedding_sets[0].id)).map((row) => row.id)).toEqual(source.embeddings.map((row) => row.id))
    const resolved = await sets.resolveSelector({ kind: 'embedding-set', embeddingSetId: source.embedding_sets[0].id })
    expect(resolved.noteIds).toEqual([owner])
    expect(JSON.parse(resolved.rows[0].vector)).toHaveLength(768)
    const result = await new SearchRepository(db, true).semanticSearch(source.embeddings[0].vector!, { embeddingSetId: source.embedding_sets[0].id })
    expect(result.results.map((row) => row.id)).toEqual([owner])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
  })

  it('preserves rich metadata, empty arrays, false, zero and scalar timestamp precision', async () => {
    const state = structuredClone(source)
    const timestamp = '2026-07-18T10:30:00.123456789Z'
    Object.assign(state.embedding_configs[0], { hnsw_m: 16, hnsw_ef_construction: 64, ivfflat_lists: 0,
      supports_mrl: false, matryoshka_dims: [384, 768], default_truncate_dim: 384, provider: 'custom',
      provider_config: { endpoint: 'local', nested: { value: null } }, content_types: [], strengths: ['code'],
      limitations: [], recommended_for: ['notes'], benchmark_scores: { quality: 0 }, is_available: false,
      document_composition: { include_title: false }, created_at: timestamp, updated_at: timestamp })
    Object.assign(state.embedding_sets[0], { usage_hints: '', keywords: [], criteria: {}, auto_embed_rules: {},
      index_type: 'hnsw', last_indexed_at: timestamp, document_count: 0, embedding_count: 0, embeddings_current: false,
      index_size_bytes: 4294967296, is_system: false, is_active: false, auto_refresh: false, refresh_interval: '',
      last_refresh_at: timestamp, agent_metadata: { a: [] }, created_by: '', created_at: timestamp, updated_at: timestamp })
    Object.assign(state.embedding_set_members[0], { membership_type: '', added_at: timestamp, added_by: '' })
    state.embeddings[0].created_at = timestamp
    state.embeddings[0].vector![0] = Math.PI
    await apply(state)
    expect(await readNativeEmbeddings(db)).toEqual(state)
    await db.query("UPDATE embedding_config SET updated_at = updated_at + interval '1 second'")
    expect((await readNativeEmbeddings(db)).embedding_configs[0].updated_at).toMatch(/^2026-07-18T10:30:01\./)
    await db.query('UPDATE embedding SET vector = $1::vector WHERE id = $2', [JSON.stringify(Array(768).fill(0.5)), state.embeddings[0].id])
    expect((await readNativeEmbeddings(db)).embeddings[0].vector).toEqual(Array(768).fill(0.5))
  })

  it.each(['absent', 'null', 'value'] as const)('preserves contract fingerprint %s', async (presence) => {
    const state = structuredClone(source)
    if (presence === 'absent') delete state.embeddings[0].contract_fingerprint
    if (presence === 'null') state.embeddings[0].contract_fingerprint = null
    await apply(state)
    expect(await readNativeEmbeddings(db)).toEqual(state)
  })

  it('retains nullable owners, vectors and times without claiming a usable embedding', async () => {
    const state = structuredClone(source)
    Object.assign(state.embeddings[0], { note_id: null, embedding_set_id: null, vector: null, created_at: null })
    state.embeddings[1].vector = null
    await apply(state)
    expect(await readNativeEmbeddings(db)).toEqual(state)
    expect((await new EmbeddingSetsRepository(db).resolveSelector({ kind: 'embedding-set', embeddingSetId: state.embedding_sets[0].id })).rows).toEqual([])
    expect(await new EmbeddingSetsRepository(db).listMembers(state.embedding_sets[0].id)).toEqual([
      expect.objectContaining(state.embedding_set_members[0]),
    ])
    const result = await new SearchRepository(db, true).semanticSearch(Array(768).fill(0.25))
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  it('coexists with local 384-dimensional vectors in semantic and hybrid search', async () => {
    await apply()
    const sets = new EmbeddingSetsRepository(db)
    const local = await sets.create({ name: 'Local vectors' })
    await sets.putEmbedding({ note_id: peer, embedding_set_id: local.id, vector: Array(384).fill(0.25) })
    const search = new SearchRepository(db, true)
    expect((await search.semanticSearch(Array(384).fill(0.25))).results.map((row) => row.id)).toEqual([peer])
    expect((await search.semanticSearch(Array(768).fill(0.25), { embeddingSetId: source.embedding_sets[0].id })).results.map((row) => row.id)).toEqual([owner])
    expect((await search.hybridSearch('', Array(768).fill(0.25))).results.map((row) => row.id)).toEqual([owner])
    expect((await search.hybridSearch('', Array(384).fill(0.25))).results.map((row) => row.id)).toEqual([peer])
    expect((await db.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_embedding_vector', 'idx_embedding_vector_768') ORDER BY indexname")).rows)
      .toEqual([{ indexname: 'idx_embedding_vector' }, { indexname: 'idx_embedding_vector_768' }])
  })

  it('repeats without duplicate native rows or changes to unrelated native sets', async () => {
    const local = await new EmbeddingSetsRepository(db).create({ name: 'Unrelated' })
    await apply()
    await apply()
    expect((await readNativeEmbeddings(db)).embeddings).toEqual(source.embeddings)
    expect((await new EmbeddingSetsRepository(db).get(local.id)).name).toBe('Unrelated')
    expect((await db.query('SELECT count(*)::int AS n FROM embedding_set_member')).rows).toEqual([{ n: 1 }])
  })

  it('ranks unique notes by their best chunk, including later chunks in a selected set', async () => {
    const state = structuredClone(source)
    const query = Array(768).fill(0) as number[]
    query[0] = 1
    state.embeddings[0].vector = [...query].reverse()
    state.embeddings[1].vector = query
    state.embeddings.push({ ...state.embeddings[0], id: '018f4c11-9f14-7d33-8a21-1c80f648f106', note_id: peer,
      vector: [0.5, 0.5, ...Array(766).fill(0)] })
    await apply(state)
    const search = new SearchRepository(db, true)
    for (const options of [{}, { embeddingSetId: state.embedding_sets[0].id }]) {
      const result = await search.semanticSearch(query, options)
      expect(result.total).toBe(2)
      expect(result.results.map((row) => row.id)).toEqual([owner, peer])
      expect((await search.semanticSearch(query, { ...options, limit: 1, offset: 1 })).results.map((row) => row.id)).toEqual([peer])
      expect((await search.hybridSearch('', query, options)).results.map((row) => row.id)).toEqual([owner, peer])
    }
  })

  it('rolls back all four components on a late failure', async () => {
    const before = await readNativeEmbeddings(db)
    await expect(db.transaction(async (tx) => {
      await applyValidatedNativeEmbeddings(tx, source)
      throw new Error('injected after embedding apply')
    })).rejects.toThrow('injected after embedding apply')
    expect(await readNativeEmbeddings(db)).toEqual(before)
  })

  it('does not invent hidden default configuration, set or member declarations', async () => {
    await apply()
    for (const table of ['embedding_config', 'embedding_set', 'embedding_set_member']) await db.query(`UPDATE ${table} SET shard_export_present = FALSE`)
    expect(await readNativeEmbeddings(db)).toEqual({ embedding_configs: [], embedding_sets: [], embedding_set_members: [], embeddings: source.embeddings })
  })

  it('links only compatible native vectors and skips metadata-only records', async () => {
    const state = structuredClone(source)
    state.embeddings.push({ ...state.embeddings[0], id: '018f4c11-9f14-7d33-8a21-1c80f648f106', note_id: peer })
    await apply(state)
    const local = await new EmbeddingSetsRepository(db).create({ name: 'Local' })
    await new EmbeddingSetsRepository(db).putEmbedding({ note_id: peer, embedding_set_id: local.id, vector: Array(384).fill(0.25) })
    const job: Parameters<typeof linkingHandler>[0] = { id: 'native-link-test', note_id: owner, job_type: 'linking',
      status: 'running', priority: 5, required_capability: null, retry_count: 0, max_retries: 3,
      error: null, result: null, created_at: new Date(), updated_at: new Date() }
    await linkingHandler(job, db)
    expect((await db.query('SELECT source_note_id, target_note_id FROM link')).rows)
      .toEqual([{ source_note_id: owner, target_note_id: peer }])
    await db.query('UPDATE embedding SET vector = NULL WHERE note_id = $1', [owner])
    expect(await linkingHandler(job, db)).toEqual({ skipped: true, reason: 'no vector found' })
  })
})

it('upgrades existing 384-dimensional native vectors without losing identities or values', async () => {
  const db = await PGlite.create({ extensions: { vector } })
  try {
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    const runner = new MigrationRunner(db)
    await runner.apply(allMigrations.filter((migration) => migration.version < 26))
    await db.query('INSERT INTO note (id) VALUES ($1)', [owner])
    await db.query("INSERT INTO embedding_set (id, model_name) VALUES ('legacy-set', 'legacy-model')")
    await db.query("INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ('legacy-vector', $1, 'legacy-set', $2::vector)", [owner, JSON.stringify(Array(384).fill(0.25))])
    await runner.apply(allMigrations)
    expect((await db.query('SELECT id, vector_dims(vector) AS dimensions FROM embedding')).rows)
      .toEqual([{ id: 'legacy-vector', dimensions: 384 }])
    expect((await readNativeEmbeddings(db)).embeddings[0].vector).toEqual(Array(384).fill(0.25))
  } finally { await db.close() }
})
