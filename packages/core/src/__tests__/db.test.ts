import { describe, it, expect, afterEach } from 'vitest'
import { createPGliteInstance } from '../db.js'
import type { PGlite } from '@electric-sql/pglite'

describe('PGlite database factory', { timeout: 30_000 }, () => {
  let db: PGlite | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('creates in-memory PGlite instance', async () => {
    db = await createPGliteInstance('memory')

    const result = await db.query<{ version: string }>('SELECT version()')
    expect(result.rows[0].version).toContain('PostgreSQL')
  })

  it('executes CREATE TABLE / INSERT / SELECT round-trip', async () => {
    db = await createPGliteInstance('memory')

    await db.exec(`
      CREATE TABLE test_notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    await db.query(
      'INSERT INTO test_notes (id, content) VALUES ($1, $2)',
      ['note-001', 'Hello from PGlite'],
    )

    const result = await db.query<{ id: string; content: string }>(
      'SELECT id, content FROM test_notes WHERE id = $1',
      ['note-001'],
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('note-001')
    expect(result.rows[0].content).toBe('Hello from PGlite')
  })

  it('supports transactions (BEGIN/COMMIT)', async () => {
    db = await createPGliteInstance('memory')

    await db.exec('CREATE TABLE tx_test (id TEXT PRIMARY KEY, val INT)')

    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO tx_test VALUES ($1, $2)', ['a', 1])
      await tx.query('INSERT INTO tx_test VALUES ($1, $2)', ['b', 2])
    })

    const result = await db.query<{ id: string; val: number }>('SELECT * FROM tx_test ORDER BY id')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ id: 'a', val: 1 })
    expect(result.rows[1]).toEqual({ id: 'b', val: 2 })
  })

  it('rolls back transaction on error', async () => {
    db = await createPGliteInstance('memory')

    await db.exec('CREATE TABLE rollback_test (id TEXT PRIMARY KEY)')

    try {
      await db.transaction(async (tx) => {
        await tx.query('INSERT INTO rollback_test VALUES ($1)', ['keep'])
        throw new Error('force rollback')
      })
    } catch {
      // expected
    }

    const result = await db.query('SELECT * FROM rollback_test')
    expect(result.rows).toHaveLength(0) // rolled back
  })

  it('loads pgvector extension', async () => {
    db = await createPGliteInstance('memory')

    // vector extension should be available
    await db.exec('CREATE TABLE vec_test (id TEXT PRIMARY KEY, embedding vector(3))')
    await db.query(
      'INSERT INTO vec_test VALUES ($1, $2)',
      ['v1', '[1.0, 2.0, 3.0]'],
    )

    const result = await db.query<{ id: string; embedding: string }>(
      'SELECT * FROM vec_test WHERE id = $1',
      ['v1'],
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('v1')
  })

  it('supports HNSW index creation on vector column', async () => {
    db = await createPGliteInstance('memory')

    await db.exec(`
      CREATE TABLE hnsw_test (
        id TEXT PRIMARY KEY,
        embedding vector(384)
      )
    `)

    await db.exec(`
      CREATE INDEX ON hnsw_test USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `)

    // Insert a vector and query — just verifying no errors
    const vec = Array.from({ length: 384 }, () => Math.random())
    await db.query(
      'INSERT INTO hnsw_test VALUES ($1, $2)',
      ['v1', JSON.stringify(vec)],
    )

    const result = await db.query(
      `SELECT id FROM hnsw_test ORDER BY embedding <=> $1 LIMIT 1`,
      [JSON.stringify(vec)],
    )

    expect(result.rows).toHaveLength(1)
  })

  it('supports tsvector full-text search', async () => {
    db = await createPGliteInstance('memory')

    await db.exec(`
      CREATE TABLE fts_test (
        id TEXT PRIMARY KEY,
        content TEXT,
        tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED
      )
    `)
    await db.exec('CREATE INDEX ON fts_test USING gin(tsv)')

    await db.query('INSERT INTO fts_test (id, content) VALUES ($1, $2)', ['1', 'Rust memory safety ownership model'])
    await db.query('INSERT INTO fts_test (id, content) VALUES ($1, $2)', ['2', 'JavaScript event loop async await'])
    await db.query('INSERT INTO fts_test (id, content) VALUES ($1, $2)', ['3', 'Rust borrow checker prevents data races'])

    const result = await db.query<{ id: string }>(
      "SELECT id FROM fts_test WHERE tsv @@ plainto_tsquery('english', $1) ORDER BY id",
      ['rust memory'],
    )

    expect(result.rows.length).toBeGreaterThanOrEqual(1)
    expect(result.rows[0].id).toBe('1')
  })
})
