import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { GraphRepository } from '../../repositories/graph-repository.js'
import { CommunitiesRepository } from '../../repositories/communities-repository.js'
import { applyValidatedNativeGraph, readNativeGraph, readNativeGraphComponent, type NativeGraph } from '../../shard/native-graph.js'
import { validateFullV1ShardArchive, validateShardComponentRecord } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
function records<T>(component: string): T[] {
  const json = files.get(`${component}.json`)
  const text = new TextDecoder().decode(json ?? files.get(`${component}.jsonl`))
  return json ? JSON.parse(text) as T[] : text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}
const source: NativeGraph = { graph_sources: records('graph_sources'), graph_edges: records('graph_edges'),
  communities: records('communities'), community_assignments: records('community_assignments') }
const sourceId = source.graph_sources[0].id
const setId = source.communities[0].id
const noteIds = records<{ id: string }>('notes').map((note) => note.id)
const timestamp = '2026-07-18T10:30:00.123456789Z'

describe('native graph stage, not public full-v1 restoration', () => {
  let db: PGlite
  let graphs: GraphRepository
  let communities: CommunitiesRepository
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    graphs = new GraphRepository(db)
    communities = new CommunitiesRepository(db)
    for (const id of noteIds) await db.query('INSERT INTO note (id, title) VALUES ($1, $1)', [id])
  })
  afterEach(async () => { await db.close() })
  async function apply(state = source): Promise<void> {
    for (const component of Object.keys(state) as (keyof NativeGraph)[]) for (const row of state[component]) {
      expect(validateShardComponentRecord(component, row, 'full-v1', '2.0.0').errors).toEqual([])
    }
    await db.transaction((tx) => applyValidatedNativeGraph(tx, state))
  }
  async function expectState(state: NativeGraph): Promise<void> {
    const actual = await readNativeGraph(db)
    for (const component of Object.keys(state) as (keyof NativeGraph)[]) {
      expect(actual[component]).toHaveLength(state[component].length)
      expect(actual[component]).toEqual(expect.arrayContaining<unknown>(state[component]))
    }
  }

  it('restores all four producer components to native repositories without jobs or archive rows', async () => {
    await apply()
    await expectState(source)
    expect(await graphs.getSourceRecord(sourceId)).toEqual(source.graph_sources[0])
    expect(await graphs.getEdgeRecords(sourceId)).toEqual(source.graph_edges)
    expect(await communities.getCommunitySet(setId)).toEqual(source.communities[0])
    expect(await communities.getCommunityRecords(setId)).toEqual(source.communities[0].communities)
    expect(await communities.getAssignmentRecords(setId)).toEqual(expect.arrayContaining(source.community_assignments))
    expect(await communities.listCommunitySources()).toEqual([expect.objectContaining({ id: setId, graphSourceId: sourceId })])
    expect(await communities.listCommunitySummaries(setId)).toEqual([expect.objectContaining({ id: 'community-a', size: 2, confidence: 0.95 })])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    await apply()
    await expectState(source)
  })

  it('loads stored communities and assignments without recomputing or inventing members', async () => {
    const state = structuredClone(source)
    state.communities[0].communities.push({ ...state.communities[0].communities[0], id: 'empty-community', representative_note_ids: [] })
    state.community_assignments = state.community_assignments.slice(0, 1)
    await apply(state)
    const graph = await graphs.loadGraphArtifact(sourceId, [], setId)
    expect(graph.communities).toEqual([
      { id: 'community-a', nodes: [state.community_assignments[0].note_id] },
      { id: 'empty-community', nodes: [] },
    ])
    expect(graph.edges).toEqual(source.graph_edges.map((edge) => ({ source: edge.from_note_id, target: edge.to_note_id, weight: edge.weight, kind: edge.kind })))
    await expect(graphs.loadGraphArtifact('other-source', [], setId)).rejects.toThrow('does not belong')
  })

  it('preserves nested community order independently of rank and representative-note order', async () => {
    const state = structuredClone(source)
    const original = state.communities[0].communities[0]
    state.communities[0].communities = [{ ...original, id: 'Z', rank: 5, representative_note_ids: [...noteIds].reverse() },
      { ...original, id: 'A', rank: 0 }, original]
    await apply(state)
    expect(await communities.getCommunitySet(setId)).toEqual(state.communities[0])
    await db.query('UPDATE community SET position = 9, rank = NULL WHERE community_set_id = $1 AND id = $2', [setId, 'Z'])
    expect((await communities.getCommunityRecords(setId)).map((row) => row.id)).toEqual(['A', original.id, 'Z'])
  })

  it('keeps null, empty objects, nested JSON states, zero and exact timestamps', async () => {
    const state = structuredClone(source)
    Object.assign(state.graph_sources[0], { source_table: null, embedding_set_id: null, virtual_set_id: null, model: null, dimension: null,
      truncate_dimension: null, metric: null, algorithm: null, parameters: null, freshness: {}, created_at: timestamp })
    Object.assign(state.graph_edges[0], { weight: 0, rank: null, metadata: { nested: [null, false, 0, '', {}, []] } })
    Object.assign(state.communities[0], { algorithm: null, parameters: {}, freshness: {}, created_at: timestamp })
    Object.assign(state.communities[0].communities[0], { label: null, rank: null, size: 0, confidence: 0, representative_note_ids: null, metadata: null })
    for (const row of state.community_assignments) Object.assign(row, { confidence: null, metadata: {} })
    await apply(state)
    await expectState(state)
    await db.exec("UPDATE graph_source SET created_at = '2026-08-01T00:00:00Z'; UPDATE community_set SET created_at = '2026-08-02T00:00:00Z'")
    expect((await graphs.getSourceRecord(sourceId))!.created_at).toBe('2026-08-01T00:00:00.000000Z')
    expect((await communities.getCommunitySet(setId))!.created_at).toBe('2026-08-02T00:00:00.000000Z')
  })

  it('keeps case-sensitive graph/set/community identities and normalizes only UUID references', async () => {
    const state = structuredClone(source)
    const another = structuredClone(source)
    another.graph_sources[0].id = sourceId.toUpperCase()
    another.graph_sources[0].embedding_set_id = noteIds[0].toUpperCase()
    another.graph_edges[0].graph_source_id = sourceId.toUpperCase()
    another.graph_edges[0].from_note_id = another.graph_edges[0].from_note_id.toUpperCase()
    another.communities[0].id = setId.toUpperCase()
    another.communities[0].graph_source_id = sourceId.toUpperCase()
    another.communities[0].communities[0].representative_note_ids = [noteIds[0].toUpperCase()]
    another.community_assignments.forEach((row) => { row.community_set_id = setId.toUpperCase(); row.note_id = row.note_id.toUpperCase() })
    for (const key of Object.keys(state) as (keyof NativeGraph)[]) (state[key] as unknown[]).push(...another[key])
    await apply(state)
    expect(await graphs.getSourceRecord(sourceId.toUpperCase())).toMatchObject({ id: sourceId.toUpperCase(), embedding_set_id: noteIds[0] })
    expect(await graphs.getSourceRecord(sourceId)).toEqual(source.graph_sources[0])
    expect((await communities.getCommunitySet(setId.toUpperCase()))!.communities[0].representative_note_ids).toEqual([noteIds[0]])
    expect(await graphs.getSourceRecord('absent')).toBeNull()
    expect(await communities.getCommunitySet('absent')).toBeNull()
    await expect(readNativeGraphComponent(db, 'graph_sources', { 'id; DELETE FROM note': sourceId } as never)).rejects.toThrow('Unknown graph filter')
  })

  it('keeps parallel edge identities and updates native assignments between communities', async () => {
    const state = structuredClone(source)
    state.graph_edges.push({ ...state.graph_edges[0], kind: 'manual', weight: Math.PI, metadata: {} })
    state.communities[0].communities.push({ ...state.communities[0].communities[0], id: 'alternate' })
    await apply(state)
    state.community_assignments[0].community_id = 'alternate'
    state.community_assignments[0].confidence = 0
    await apply(state)
    await expectState(state)
    await db.query("UPDATE graph_edge_artifact SET weight = $1, metadata_json = '{}'::jsonb WHERE kind = 'manual'", [Math.E])
    expect((await graphs.getEdgeRecords(sourceId)).find((edge) => edge.kind === 'manual')).toMatchObject({ weight: Math.E, metadata: {} })
    await graphs.markSimilarityGraphStale(sourceId, 'native edit')
    expect((await graphs.getSourceRecord(sourceId))!.freshness).toMatchObject({ status: 'stale', stale_reason: 'native edit' })
  })

  it('replaces the complete nested child list only for included sets', async () => {
    await apply()
    const saved = await communities.saveCommunity({ name: 'Unrelated', sourceType: 'user-authored', noteIds: [noteIds[0]] })
    const unrelated = await communities.getCommunitySet(saved.id)
    const state = structuredClone(source)
    state.communities[0].communities = []
    state.community_assignments = []
    await apply(state)
    expect(await communities.getCommunityRecords(setId)).toEqual([])
    expect(await communities.getAssignmentRecords(setId)).toEqual([])
    expect(await communities.getCommunitySet(saved.id)).toEqual(unrelated)
  })

  it('rolls back late errors, including removed nested children and assignments', async () => {
    await apply()
    const state = structuredClone(source)
    state.communities[0].communities = []
    state.graph_sources[0].name = 'must roll back'
    await expect(db.transaction((tx) => applyValidatedNativeGraph(tx, state))).rejects.toThrow()
    await expectState(source)
  })

  it('authors community source, set, child and assignments atomically after import', async () => {
    await apply()
    const original = await readNativeGraph(db)
    await expect(communities.saveCommunity({ name: 'Failed save', sourceType: 'user-authored', noteIds: ['unknown-note'] })).rejects.toThrow()
    expect(await readNativeGraph(db)).toEqual(original)
    const saved = await communities.saveCommunity({ name: 'Local save', sourceType: 'user-authored', noteIds: [noteIds[0]] })
    const record = (await communities.getCommunitySet(saved.id))!
    expect(validateShardComponentRecord('communities', record, 'full-v1', '2.0.0').errors).toEqual([])
    expect(await communities.getAssignmentRecords(saved.id)).toHaveLength(1)
    expect(await communities.getCommunitySet(setId)).toEqual(source.communities[0])
  })

  it('deletes actual graph-owned records without replaying archived state', async () => {
    await apply()
    await db.query('DELETE FROM graph_source WHERE id = $1', [sourceId])
    expect(await readNativeGraph(db)).toEqual({ graph_sources: [], graph_edges: [], communities: [], community_assignments: [] })
    expect((await db.query('SELECT id FROM note')).rows).toHaveLength(noteIds.length)
  })

  it('backfills a populated legacy community list in its existing rank/id order', async () => {
    const legacy = await PGlite.create({ extensions: { vector } })
    try {
      await legacy.exec('CREATE EXTENSION IF NOT EXISTS vector')
      await new MigrationRunner(legacy).apply(allMigrations.filter((migration) => migration.version < 29))
      await legacy.exec(`INSERT INTO graph_source (id, name, kind, input_hash, freshness_json) VALUES ('legacy', 'Legacy', 'manual', 'legacy', '{}');
        INSERT INTO community_set (id, graph_source_id, name, source_type, input_hash, freshness_json) VALUES ('legacy', 'legacy', 'Legacy', 'imported', 'legacy', '{}');
        INSERT INTO community (community_set_id, id, rank, metadata_json) VALUES ('legacy', 'Z', 0, '{"keep":null}'), ('legacy', 'A', 1, NULL), ('legacy', 'B', NULL, '{}')`)
      await new MigrationRunner(legacy).apply(allMigrations)
      const rows = await new CommunitiesRepository(legacy).getCommunityRecords('legacy')
      expect(rows.map((row) => row.id)).toEqual(['Z', 'A', 'B'])
      expect(rows[0].metadata).toEqual({ keep: null })
    } finally { await legacy.close() }
  })
})
