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
