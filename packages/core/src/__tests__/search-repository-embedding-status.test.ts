/**
 * Tests for SearchRepository — embedding status (has_embedding) field.
 * Covers issue #94: per-result embedding status on all search methods.
 *
 * Tests written BEFORE implementation (red phase).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { SearchRepository } from '../repositories/search-repository.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let noteCounter = 0
let embCounter = 0

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

async function insertNote(
  db: PGlite,
  opts: {
    id?: string
    title?: string | null
    content?: string
  } = {},
): Promise<string> {
  noteCounter++
  const id = opts.id ?? `emb-note-${noteCounter}`
  const title = opts.title !== undefined ? opts.title : `Embedding Note ${noteCounter}`
  const content = opts.content ?? ''

  await db.query(
    `INSERT INTO note (id, title) VALUES ($1, $2)`,
    [id, title],
  )
  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, content],
  )
  return id
}

/** Insert a valid embedding for a note using the correct schema. */
async function insertEmbedding(db: PGlite, noteId: string): Promise<void> {
  embCounter++
  const setId = `emb-set-${embCounter}`
  const embId = `emb-${embCounter}`

  // 384-dim zero vector
  const vec = `[${new Array(384).fill('0').join(',')}]`

  await db.query(
    `INSERT INTO embedding_set (id, model_name, dimensions) VALUES ($1, $2, $3)`,
    [setId, 'test-model', 384],
  )
  await db.query(
    `INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ($1, $2, $3, $4::vector)`,
    [embId, noteId, setId, vec],
  )
  await db.query(
    `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id) VALUES ($1, $2, $3)`,
    [setId, noteId, embId],
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchRepository — has_embedding field', () => {
  let db: PGlite
  let repo: SearchRepository

  beforeEach(async () => {
    noteCounter = 0
    embCounter = 0
    db = await setupDb()
    repo = new SearchRepository(db)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // text search path
  // -------------------------------------------------------------------------

  it('text search: has_embedding=true when note has embedding', async () => {
    const id = await insertNote(db, { title: 'Embedded note alpha', content: 'alpha content' })
    await insertEmbedding(db, id)

    const resp = await repo.search('alpha')
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].has_embedding).toBe(true)
  })

  it('text search: has_embedding=false when note has no embedding', async () => {
    await insertNote(db, { title: 'Plain note beta', content: 'beta content' })

    const resp = await repo.search('beta')
    expect(resp.results).toHaveLength(1)
    expect(resp.results[0].has_embedding).toBe(false)
  })

  it('text search: mixed results show correct has_embedding per note', async () => {
    const id1 = await insertNote(db, { title: 'Gamma embedded', content: 'gamma topic' })
    const id2 = await insertNote(db, { title: 'Gamma plain', content: 'gamma topic' })
    await insertEmbedding(db, id1)

    const resp = await repo.search('gamma')
    expect(resp.results).toHaveLength(2)

    const embeddedResult = resp.results.find((r) => r.id === id1)
    const plainResult = resp.results.find((r) => r.id === id2)
    expect(embeddedResult?.has_embedding).toBe(true)
    expect(plainResult?.has_embedding).toBe(false)
  })

  // -------------------------------------------------------------------------
  // recent notes path (empty query)
  // -------------------------------------------------------------------------

  it('recent notes: has_embedding=true when note has embedding', async () => {
    const id = await insertNote(db, { title: 'Recent embedded note' })
    await insertEmbedding(db, id)

    const resp = await repo.search('')
    const result = resp.results.find((r) => r.id === id)
    expect(result).toBeDefined()
    expect(result!.has_embedding).toBe(true)
  })

  it('recent notes: has_embedding=false when note has no embedding', async () => {
    const id = await insertNote(db, { title: 'Recent plain note' })

    const resp = await repo.search('')
    const result = resp.results.find((r) => r.id === id)
    expect(result).toBeDefined()
    expect(result!.has_embedding).toBe(false)
  })

  // -------------------------------------------------------------------------
  // SearchResult type has has_embedding field
  // -------------------------------------------------------------------------

  it('SearchResult always has has_embedding field (boolean)', async () => {
    await insertNote(db, { title: 'Type check note', content: 'type check content' })

    const resp = await repo.search('type check')
    expect(resp.results).toHaveLength(1)
    expect(typeof resp.results[0].has_embedding).toBe('boolean')
  })
})
