import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { EmbeddingSetsRepository } from '../repositories/embedding-sets-repository.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { GraphRepository, detectCommunities } from '../repositories/graph-repository.js'
import { CommunitiesRepository } from '../repositories/communities-repository.js'
import { exportShard } from '../shard/shard-export.js'
import { importShard } from '../shard/shard-import.js'
import { unpackTarGz } from '../shard/shard-tar.js'

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string, title: string): Promise<void> {
  await db.query(`INSERT INTO note (id, title) VALUES ($1, $2)`, [id, title])
  await db.query(
    `INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)`,
    ['orig-' + id, id, title + ' body', 'hash-' + id],
  )
  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, title + ' body'],
  )
}

function vec(first: number, second: number): number[] {
  return [first, second, ...new Array(382).fill(0)]
}

function parseVector(value: string): number[] {
  return value.replace(/^\[/, '').replace(/\]$/, '').split(',').filter(Boolean).map(Number)
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    dot += left[i] * right[i]
    leftNorm += left[i] * left[i]
    rightNorm += right[i] * right[i]
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
  return denominator === 0 ? 0 : dot / denominator
}

describe('embedding sets and graph APIs', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await setupDb()
    await insertNote(db, 'note-a', 'Alpha')
    await insertNote(db, 'note-b', 'Beta')
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates named embedding sets and scopes semantic search to a selected set', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const full = await sets.create({ name: 'Full content', purpose: 'Full note vectors' })
    const summaries = await sets.create({ name: 'AI summaries', purpose: 'Summary vectors' })

    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: full.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: full.id, vector: vec(0, 1) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: summaries.id, vector: vec(1, 0) })

    const repo = new SearchRepository(db, true)
    const fullResults = await repo.semanticSearch(vec(1, 0), { embeddingSetId: full.id, limit: 1 })
    const summaryResults = await repo.semanticSearch(vec(1, 0), { embeddingSetId: summaries.id, limit: 10 })

    expect(fullResults.results[0].id).toBe('note-a')
    expect(summaryResults.results.map((r) => r.id)).toEqual(['note-b'])

    const textScoped = await repo.search('Beta', { mode: 'text', embeddingSetId: summaries.id })
    const recentScoped = await repo.search('', { embeddingSetId: summaries.id })
    expect(textScoped.results.map((r) => r.id)).toEqual(['note-b'])
    expect(recentScoped.results.map((r) => r.id)).toEqual(['note-b'])
  })

  it('builds a k-NN similarity graph from one embedding set and clusters any edge set', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const set = await sets.create({ name: 'AI summaries' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: set.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: set.id, vector: vec(0.9, 0.1) })

    const graph = await new GraphRepository(db).buildSimilarityGraph(set.id, { k: 1 })

    expect(graph.nodes.map((n) => n.id)).toEqual(['note-a', 'note-b'])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({ source: 'note-a', target: 'note-b', kind: 'similarity' })
    expect(graph.communities[0].nodes.sort()).toEqual(['note-a', 'note-b'])

    const arbitrary = detectCommunities([
      { source: 'a', target: 'b', weight: 1 },
      { source: 'c', target: 'd', weight: 1 },
    ])
    expect(arbitrary.map((c) => c.nodes.sort())).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('matches the previous per-row k-NN semantics while reporting batched graph progress', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const set = await sets.create({ name: 'Graph vectors' })
    await insertNote(db, 'note-c', 'Gamma')
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: set.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: set.id, vector: vec(0.9, 0.1) })
    await sets.putEmbedding({ note_id: 'note-c', embedding_set_id: set.id, vector: vec(0, 1) })

    const resolved = await sets.resolveSelector({ kind: 'embedding-set', embeddingSetId: set.id })
    const expectedEdges = new Map<string, number>()
    for (const row of resolved.rows) {
      const sourceVector = parseVector(row.vector)
      const neighbors = resolved.rows
        .filter((candidate) => candidate.note_id !== row.note_id)
        .map((candidate) => ({
          noteId: candidate.note_id,
          similarity: cosineSimilarity(sourceVector, parseVector(candidate.vector)),
        }))
        .sort((a, b) => b.similarity - a.similarity || a.noteId.localeCompare(b.noteId))
        .slice(0, 2)
      for (const neighbor of neighbors) {
        const [source, target] = [row.note_id, neighbor.noteId].sort()
        const key = `${source}:${target}`
        expectedEdges.set(key, Math.max(expectedEdges.get(key) ?? -Infinity, neighbor.similarity))
      }
    }

    const progress: string[] = []
    const graph = await new GraphRepository(db).buildSimilarityGraph(set.id, {
      k: 2,
      batchSize: 1,
      onProgress: (event) => progress.push(`${event.phase}:${event.done}/${event.total}`),
    })

    expect(graph.edges.map((edge) => `${edge.source}:${edge.target}`)).toEqual(
      Array.from(expectedEdges.keys()).sort(),
    )
    expect(graph.edges.map((edge) => edge.weight)).toEqual(
      graph.edges.map((edge) => expectedEdges.get(`${edge.source}:${edge.target}`)),
    )
    expect(progress).toContain('prepare:3/3')
    expect(progress).toContain('neighbors:3/3')
  })


  it('resolves criteria virtual embedding sets for search and graph construction', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const base = await sets.create({ name: 'Full content', purpose: 'Full note vectors' })
    await db.query('INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)', ['tag-note-a-alpha', 'note-a', 'alpha'])
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: base.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: base.id, vector: vec(0.9, 0.1) })

    const virtual = await sets.createVirtualDefinition({
      id: 'virtual-alpha',
      name: 'Tagged alpha',
      purpose: 'Alpha-tagged notes from the base set',
      source: { type: 'criteria', baseSetId: base.id, criteria: { tags: ['alpha'] } },
      compatibility: {
        model: 'require-same',
        dimension: 'require-same',
        duplicateVectors: 'prefer-set-order',
        missingVectors: 'omit',
      },
    })

    const descriptors = await sets.listDescriptors()
    expect(descriptors.find((set) => set.id === virtual.id)).toMatchObject({
      kind: 'virtual',
      name: 'Tagged alpha',
      freshness: { status: 'unknown' },
    })

    const selector = { kind: 'embedding-set' as const, embeddingSetId: virtual.id }
    const search = await new SearchRepository(db, true).search('', { embeddingSetSelector: selector })
    expect(search.results.map((r) => r.id)).toEqual(['note-a'])

    const graph = await new GraphRepository(db).buildSimilarityGraph(selector, { k: 1, threshold: 0.5 })
    expect(graph.nodes.map((n) => n.id)).toEqual(['note-a'])
    expect(graph.edges).toEqual([])
  })

  it('resolves criteria virtual embedding sets using note properties and enrichment state', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const base = await sets.create({ name: 'Property vectors', purpose: 'Property-scoped vectors' })
    await db.query(
      `UPDATE note
       SET source = 'docs-seed', visibility = 'public', is_starred = true
       WHERE id = 'note-a'`,
    )
    await db.query(
      `UPDATE note_revised_current
       SET is_user_edited = true, generation_count = 2, ai_metadata = '{"provider":"test"}'::jsonb
       WHERE note_id = 'note-a'`,
    )
    await db.query(
      `INSERT INTO note_revision (id, note_id, revision_number, type, content)
       VALUES ('rev-note-a-1', 'note-a', 1, 'ai', 'Alpha revised')`,
    )
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: base.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: base.id, vector: vec(0.9, 0.1) })

    const resolved = await sets.resolveSelector({
      kind: 'virtual-definition',
      definition: {
        id: 'property-filtered',
        name: 'Property filtered',
        source: {
          type: 'criteria',
          baseSetId: base.id,
          criteria: {
            sources: ['docs-seed'],
            visibilities: ['public'],
            formats: ['markdown'],
            isStarred: true,
            isArchived: false,
            hasTitle: true,
            hasEmbedding: true,
            isUserEdited: true,
            hasAiMetadata: true,
            hasRevisions: true,
            minGenerationCount: 1,
            maxGenerationCount: 3,
          },
        },
        compatibility: {
          model: 'require-same',
          dimension: 'require-same',
          duplicateVectors: 'prefer-set-order',
          missingVectors: 'omit',
        },
      },
    })

    expect(resolved.noteIds).toEqual(['note-a'])
  })

  it('materializes, reuses, and invalidates criteria virtual embedding selectors', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const base = await sets.create({ name: 'Materialized property vectors' })
    await db.query(`UPDATE note SET source = 'docs-seed' WHERE id = 'note-a'`)
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: base.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: base.id, vector: vec(0.9, 0.1) })

    const materialized = await sets.createVirtualDefinition({
      id: 'materialized-docs',
      name: 'Materialized docs',
      source: { type: 'criteria', baseSetId: base.id, criteria: { sources: ['docs-seed'] } },
      compatibility: {
        model: 'require-same',
        dimension: 'require-same',
        duplicateVectors: 'prefer-set-order',
        missingVectors: 'omit',
      },
      materialization: { allowed: true, freshness: 'unknown' },
    })

    const first = await sets.resolveSelector({ kind: 'embedding-set', embeddingSetId: materialized.id })
    expect(first.noteIds).toEqual(['note-a'])
    expect(first.resolutionSource).toBe('materialized')

    await db.query(`UPDATE note SET source = 'manual' WHERE id = 'note-a'`)
    const stillCached = await sets.resolveSelector({ kind: 'embedding-set', embeddingSetId: materialized.id })
    expect(stillCached.noteIds).toEqual(['note-a'])
    expect(stillCached.resolutionSource).toBe('materialized')

    const live = await sets.resolveSelector({
      kind: 'virtual-definition',
      definition: {
        id: 'live-docs',
        name: 'Live docs',
        source: { type: 'criteria', baseSetId: base.id, criteria: { sources: ['docs-seed'] } },
        compatibility: {
          model: 'require-same',
          dimension: 'require-same',
          duplicateVectors: 'prefer-set-order',
          missingVectors: 'omit',
        },
      },
    })
    expect(live.noteIds).toEqual([])
    expect(live.resolutionSource).toBe('live')

    await sets.markVirtualSetStale(materialized.id, 'note source changed')
    const staleLive = await sets.resolveSelector({ kind: 'embedding-set', embeddingSetId: materialized.id })
    expect(staleLive.noteIds).toEqual([])
    expect(staleLive.resolutionSource).toBe('live')
    expect(staleLive.freshness.status).toBe('stale')

    const refreshed = await sets.refreshMaterializedVirtualSet(materialized.id)
    expect(refreshed.noteIds).toEqual([])
    expect(refreshed.resolutionSource).toBe('materialized')
    const row = await sets.get(materialized.id)
    expect(row.materialization_json).toMatchObject({
      allowed: true,
      freshness: 'fresh',
      resolvedMemberCount: 0,
    })
  })

  it('resolves set-operation virtual definitions over compatible physical sets', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const first = await sets.create({ name: 'First' })
    const second = await sets.create({ name: 'Second' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: first.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: second.id, vector: vec(0.9, 0.1) })

    const resolved = await sets.resolveSelector({
      kind: 'virtual-definition',
      definition: {
        id: 'combined',
        name: 'Combined',
        source: { type: 'set-operation', operation: 'union', setIds: [first.id, second.id] },
        compatibility: {
          model: 'require-same',
          dimension: 'require-same',
          duplicateVectors: 'prefer-set-order',
          missingVectors: 'omit',
        },
      },
    })

    expect(resolved.errors).toEqual([])
    expect(resolved.noteIds).toEqual(['note-a', 'note-b'])
  })




  it('previews and saves dynamic and user-authored communities without overwriting each other', async () => {
    const communities = new CommunitiesRepository(db)
    const preview = await communities.previewDynamicCommunity({ query: 'Alpha' })
    expect(preview.map((assignment) => assignment.noteId)).toEqual(['note-a'])

    const dynamic = await communities.saveCommunity({
      name: 'Alpha search snapshot',
      label: 'Alpha',
      sourceType: 'dynamic-snapshot',
      filters: { query: 'Alpha' },
    })
    const authored = await communities.saveCommunity({
      name: 'Manual pair',
      label: 'Manual',
      sourceType: 'user-authored',
      noteIds: ['note-a', 'note-b'],
      representativeNoteIds: ['note-a'],
    })

    const sources = await communities.listCommunitySources()
    expect(sources.map((source) => source.sourceType).sort()).toEqual(['dynamic-snapshot', 'user-authored'])

    const dynamicAssignments = await communities.getCommunityAssignments(dynamic.id)
    const authoredAssignments = await communities.getCommunityAssignments(authored.id)
    expect(dynamicAssignments.map((assignment) => assignment.noteId)).toEqual(['note-a'])
    expect(authoredAssignments.map((assignment) => assignment.noteId)).toEqual(['note-a', 'note-b'])

    await insertNote(db, 'note-c', 'Alpha C')
    const rerun = await communities.rerunDynamicCommunity(dynamic.id)
    expect(rerun.map((assignment) => assignment.noteId).sort()).toEqual(['note-a', 'note-c'])
    expect((await communities.getCommunityAssignments(dynamic.id)).map((assignment) => assignment.noteId)).toEqual(['note-a'])
  })

  it('builds, reuses, and invalidates cached similarity graph artifacts', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const set = await sets.create({ name: 'Cache vectors' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: set.id, vector: vec(1, 0) })
    await sets.putEmbedding({ note_id: 'note-b', embedding_set_id: set.id, vector: vec(0.9, 0.1) })

    const repo = new GraphRepository(db)
    const selector = { kind: 'embedding-set' as const, embeddingSetId: set.id }
    const first = await repo.buildOrLoadSimilarityGraph({ selector, k: 1, threshold: 0.5 })
    expect(first.cache).toBe('miss-live-built')
    expect(first.graph.edges).toHaveLength(1)

    const second = await repo.buildOrLoadSimilarityGraph({ selector, k: 1, minSimilarity: 0.5 })
    expect(second.cache).toBe('hit')
    expect(second.graph.edges).toEqual(first.graph.edges)

    await repo.markSimilarityGraphStale(first.graphSource.id, 'test invalidation')
    await expect(repo.buildOrLoadSimilarityGraph({ selector, k: 1, minSimilarity: 0.5, source: 'cache-only' })).rejects.toThrow('similarity graph cache stale')

    const rebuilt = await repo.buildOrLoadSimilarityGraph({ selector, k: 1, minSimilarity: 0.5 })
    expect(rebuilt.cache).toBe('stale-live-built')
    expect(rebuilt.graphSource.id).toBe(first.graphSource.id)

    await expect(repo.buildOrLoadSimilarityGraph({ selector, minSimilarity: 0.2, threshold: 0.5 })).rejects.toThrow('conflicting-threshold')
  })

  it('round-trips virtual embedding definitions and graph community artifacts through shards', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const base = await sets.create({ id: 'base-set', name: 'Base vectors' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: base.id, vector: vec(1, 0) })
    await sets.createVirtualDefinition({
      id: 'virtual-notes',
      name: 'Virtual notes',
      source: { type: 'criteria', baseSetId: base.id, criteria: { noteIds: ['note-a'] } },
      compatibility: {
        model: 'require-same',
        dimension: 'require-same',
        duplicateVectors: 'prefer-set-order',
        missingVectors: 'omit',
      },
    })

    await db.query(
      `INSERT INTO graph_source (id, name, kind, source_table, embedding_set_id, virtual_set_id, metric, algorithm, parameters_json, input_hash, freshness_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb)`,
      ['graph-1', 'Topic graph', 'similarity', 'embedding', base.id, 'virtual-notes', 'cosine', 'knn', '{"k":1}', 'sha256:test', '{"status":"fresh"}'],
    )
    await db.query(
      `INSERT INTO graph_edge_artifact (graph_source_id, from_note_id, to_note_id, weight, kind, rank)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['graph-1', 'note-a', 'note-b', 0.91, 'similarity', 1],
    )
    await db.query(
      `INSERT INTO community_set (id, graph_source_id, name, source_type, algorithm, input_hash, freshness_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      ['communities-1', 'graph-1', 'Topic communities', 'precomputed', 'label-propagation', 'sha256:test', '{"status":"fresh"}'],
    )
    await db.query(
      `INSERT INTO community (community_set_id, id, label, rank, size, representative_note_ids)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['communities-1', 'community-a', 'Alpha', 1, 2, ['note-a']],
    )
    await db.query(
      `INSERT INTO community_assignment (community_set_id, community_id, note_id, confidence, source_type)
       VALUES ($1, $2, $3, $4, $5)`,
      ['communities-1', 'community-a', 'note-a', 0.99, 'precomputed'],
    )

    const shard = await exportShard(db, { includeEmbeddings: true })
    const files = unpackTarGz(shard)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    expect(manifest.components).toEqual(expect.arrayContaining(['graph_sources', 'graph_edges', 'communities', 'community_assignments']))
    expect(manifest.counts).toMatchObject({ graph_sources: 1, graph_edges: 1, community_sets: 1, communities: 1, community_assignments: 1 })

    const exportedSets = JSON.parse(new TextDecoder().decode(files.get('embedding_sets.json')))
    expect(exportedSets.find((set: { id: string }) => set.id === 'virtual-notes')).toMatchObject({
      kind: 'virtual',
      source: { type: 'criteria' },
    })

    const imported = await setupDb()
    try {
      const result = await importShard(imported, shard)
      expect(result.errors).toEqual([])
      expect(result.counts).toMatchObject({ graph_sources: 1, graph_edges: 1, community_sets: 1, communities: 1, community_assignments: 1 })
      const importedSources = await imported.query<{ id: string; virtual_set_id: string | null; freshness_json: { status: string } }>('SELECT id, virtual_set_id, freshness_json FROM graph_source')
      expect(importedSources.rows).toEqual([{ id: 'graph-1', virtual_set_id: 'virtual-notes', freshness_json: { status: 'unknown' } }])
      const importedVirtual = await new EmbeddingSetsRepository(imported).get('virtual-notes')
      expect(importedVirtual.kind).toBe('virtual')
    } finally {
      await imported.close()
    }
  }, 30000)

  it('exports materialized selector metadata only when explicitly requested', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const base = await sets.create({ id: 'mat-base-set', name: 'Materialized base' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: base.id, vector: vec(1, 0) })
    await sets.createVirtualDefinition({
      id: 'mat-virtual-notes',
      name: 'Materialized virtual notes',
      source: { type: 'criteria', baseSetId: base.id, criteria: { noteIds: ['note-a'] } },
      compatibility: {
        model: 'require-same',
        dimension: 'require-same',
        duplicateVectors: 'prefer-set-order',
        missingVectors: 'omit',
      },
      materialization: { allowed: true, freshness: 'unknown' },
    })

    const defaultShard = await exportShard(db, { includeEmbeddings: true })
    const defaultFiles = unpackTarGz(defaultShard)
    const defaultSets = JSON.parse(new TextDecoder().decode(defaultFiles.get('embedding_sets.json')))
    const defaultMembers = new TextDecoder().decode(defaultFiles.get('embedding_set_members.jsonl'))
    expect(defaultSets.find((set: { id: string }) => set.id === 'mat-virtual-notes')).toMatchObject({
      materialization: null,
      freshness: { status: 'unknown' },
    })
    expect(defaultMembers).not.toContain('mat-virtual-notes')

    const explicitShard = await exportShard(db, {
      includeEmbeddings: true,
      includeMaterializedSelectors: true,
    })
    const explicitFiles = unpackTarGz(explicitShard)
    const explicitSets = JSON.parse(new TextDecoder().decode(explicitFiles.get('embedding_sets.json')))
    const explicitMembers = new TextDecoder().decode(explicitFiles.get('embedding_set_members.jsonl'))
    expect(explicitSets.find((set: { id: string }) => set.id === 'mat-virtual-notes').materialization).toMatchObject({
      allowed: true,
      freshness: 'fresh',
      resolvedMemberCount: 1,
    })
    expect(explicitMembers).toContain('mat-virtual-notes')
  }, 30000)

  it('round-trips embedding set name and purpose through shards', async () => {
    const sets = new EmbeddingSetsRepository(db)
    const set = await sets.create({ name: 'AI summaries', purpose: 'Generated summary embeddings' })
    await sets.putEmbedding({ note_id: 'note-a', embedding_set_id: set.id, vector: vec(1, 0) })

    const shard = await exportShard(db, { includeEmbeddings: true })
    const files = unpackTarGz(shard)
    const exportedSets = JSON.parse(new TextDecoder().decode(files.get('embedding_sets.json')))
    expect(exportedSets[0]).toMatchObject({
      name: 'AI summaries',
      purpose: 'Generated summary embeddings',
    })

    const imported = await setupDb()
    try {
      const result = await importShard(imported, shard)
      expect(result.errors).toEqual([])
      expect(result.success).toBe(true)
      const importedSets = await new EmbeddingSetsRepository(imported).list()
      expect(importedSets[0]).toMatchObject({
        name: 'AI summaries',
        purpose: 'Generated summary embeddings',
      })
    } finally {
      await imported.close()
    }
  }, 30000)
})
