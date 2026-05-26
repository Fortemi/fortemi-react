import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { EmbeddingSetsRepository } from '../repositories/embedding-sets-repository.js'
import { SearchRepository } from '../repositories/search-repository.js'
import { GraphRepository, detectCommunities } from '../repositories/graph-repository.js'
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
