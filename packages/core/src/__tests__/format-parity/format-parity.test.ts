import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { loadServerFixture, matchServerShape } from './helpers.js'

describe('Format Parity', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    const runner = new MigrationRunner(db)
    await runner.apply(allMigrations)
  })

  afterAll(async () => {
    await db.close()
  })

  it('archive table shape matches server', async () => {
    // Insert a test row matching server fixture
    await db.query(
      `INSERT INTO archive (id, name, schema_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ['019577b4-a7c0-7000-8000-000000000001', 'default', 4, '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z'],
    )

    const result = await db.query<Record<string, unknown>>('SELECT * FROM archive LIMIT 1')
    const serverFixture = loadServerFixture('archive')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    if (!comparison.pass) {
      console.error('Shape mismatch:', comparison)
    }

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('note table shape matches server', async () => {
    // Insert test data
    await db.query(
      `INSERT INTO note (id, archive_id, title, format, source, visibility, revision_mode, is_starred, is_pinned, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      ['019577b4-a7c0-7000-8000-000000000002', '019577b4-a7c0-7000-8000-000000000001', 'Test Note', 'markdown', 'user', 'private', 'standard', false, false, '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>('SELECT * FROM note LIMIT 1')
    const serverFixture = loadServerFixture('note')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    // Allow extra fields (like tsv) that the server might not include
    expect(comparison.typeMismatch).toEqual([])
  })
})
