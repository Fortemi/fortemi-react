/**
 * Tests for SearchOptions.mode field enforcement in SearchRepository.
 * Covers issue #89: mode override ('text' | 'semantic' | 'hybrid' | 'auto').
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
  const id = opts.id ?? `mode-note-${noteCounter}`
  const title = opts.title !== undefined ? opts.title : `Mode Note ${noteCounter}`
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

async function insertEmbedding(db: PGlite, noteId: string): Promise<void> {
  embCounter++
  const setId = `emb-set-${embCounter}`
  const embId = `emb-${embCounter}`

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

// 384-dim embedding for tests
const TEST_EMBEDDING = new Array(384).fill(0).map((_, i) => i / 384)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchOptions.mode field', () => {
  let db: PGlite
  let repo: SearchRepository

  beforeEach(async () => {
    noteCounter = 0
    embCounter = 0
    db = await setupDb()
    repo = new SearchRepository(db, true)
  })

  afterEach(async () => {
    await db.close()
  })

  // -------------------------------------------------------------------------
  // mode='text' — never use embedding even when provided
  // -------------------------------------------------------------------------

  it('mode=text forces text search even when queryEmbedding is provided', async () => {
    await insertNote(db, { title: 'Text mode note', content: 'text mode content' })

    const resp = await repo.search('text mode', { mode: 'text' }, TEST_EMBEDDING)
    expect(resp.mode).toBe('text')
  })

  it('mode=text with empty query falls through to recent notes (text mode)', async () => {
    await insertNote(db, { title: 'Recent note for mode test' })

    const resp = await repo.search('', { mode: 'text' })
    expect(resp.mode).toBe('text')
  })

  // -------------------------------------------------------------------------
  // mode='semantic' — require embedding
  // -------------------------------------------------------------------------

  it('mode=semantic uses semantic search when embedding is provided', async () => {
    const id = await insertNote(db, { title: 'Semantic mode note' })
    await insertEmbedding(db, id)

    const resp = await repo.search('semantic mode', { mode: 'semantic' }, TEST_EMBEDDING)
    expect(resp.mode).toBe('semantic')
  })

  it('mode=semantic throws when no queryEmbedding is provided', async () => {
    await insertNote(db, { title: 'Semantic no embedding note' })

    await expect(
      repo.search('query', { mode: 'semantic' }),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // mode='hybrid' — force hybrid
  // -------------------------------------------------------------------------

  it('mode=hybrid uses hybrid search when embedding is provided', async () => {
    const id = await insertNote(db, { title: 'Hybrid mode note', content: 'hybrid content' })
    await insertEmbedding(db, id)

    const resp = await repo.search('hybrid mode', { mode: 'hybrid' }, TEST_EMBEDDING)
    expect(resp.mode).toBe('hybrid')
  })

  it('mode=hybrid throws when no queryEmbedding is provided', async () => {
    await insertNote(db, { title: 'Hybrid no embedding note' })

    await expect(
      repo.search('query', { mode: 'hybrid' }),
    ).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // mode='auto' and undefined — existing behavior
  // -------------------------------------------------------------------------

  it('mode=auto with embedding produces hybrid for non-empty query', async () => {
    const id = await insertNote(db, { title: 'Auto mode note', content: 'auto content' })
    await insertEmbedding(db, id)

    const resp = await repo.search('auto', { mode: 'auto' }, TEST_EMBEDDING)
    expect(resp.mode).toBe('hybrid')
  })

  it('mode=undefined (default) with embedding produces hybrid for non-empty query', async () => {
    const id = await insertNote(db, { title: 'Default mode note', content: 'default content' })
    await insertEmbedding(db, id)

    const resp = await repo.search('default', undefined, TEST_EMBEDDING)
    expect(resp.mode).toBe('hybrid')
  })

  it('mode=undefined without embedding produces text search', async () => {
    await insertNote(db, { title: 'No embedding note', content: 'no embedding content' })

    const resp = await repo.search('no embedding')
    expect(resp.mode).toBe('text')
  })
})
