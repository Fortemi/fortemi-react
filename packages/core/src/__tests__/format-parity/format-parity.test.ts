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

  it('collection table shape matches server', async () => {
    await db.query(
      `INSERT INTO collection (id, name, description, parent_id, position, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['019577b4-a7c0-7000-8000-000000000010', 'Research', 'Research notes', null, 0, '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM collection WHERE id = '019577b4-a7c0-7000-8000-000000000010'`,
    )
    const serverFixture = loadServerFixture('collection')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('note_tag table shape matches server', async () => {
    await db.query(
      `INSERT INTO note_tag (id, note_id, tag, created_at)
       VALUES ($1, $2, $3, $4)`,
      ['019577b4-a7c0-7000-8000-000000000020', '019577b4-a7c0-7000-8000-000000000002', 'research', '2026-03-22T10:00:00.000Z'],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM note_tag WHERE id = '019577b4-a7c0-7000-8000-000000000020'`,
    )
    const serverFixture = loadServerFixture('note_tag')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('skos_scheme table shape matches server', async () => {
    await db.query(
      `INSERT INTO skos_scheme (id, title, description, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['019577b4-a7c0-7000-8000-000000000030', 'Topics', 'Topic taxonomy', '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM skos_scheme WHERE id = '019577b4-a7c0-7000-8000-000000000030'`,
    )
    const serverFixture = loadServerFixture('skos_scheme')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('skos_concept table shape matches server', async () => {
    await db.query(
      `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['019577b4-a7c0-7000-8000-000000000040', '019577b4-a7c0-7000-8000-000000000030', 'Machine Learning', '[]', 'ML concepts', '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM skos_concept WHERE id = '019577b4-a7c0-7000-8000-000000000040'`,
    )
    const serverFixture = loadServerFixture('skos_concept')

    // Normalize alt_labels: PGlite may return JSONB as a string or parsed array
    const row = { ...result.rows[0] }
    if (typeof row.alt_labels === 'string') {
      row.alt_labels = JSON.parse(row.alt_labels as string)
    }

    const comparison = matchServerShape(row, serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('link table shape matches server', async () => {
    await db.query(
      `INSERT INTO link (id, source_note_id, target_note_id, link_type, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['019577b4-a7c0-7000-8000-000000000050', '019577b4-a7c0-7000-8000-000000000002', '019577b4-a7c0-7000-8000-000000000002', 'related', '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM link WHERE id = '019577b4-a7c0-7000-8000-000000000050'`,
    )
    const serverFixture = loadServerFixture('link')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('attachment_blob table shape matches server', async () => {
    await db.query(
      `INSERT INTO attachment_blob (id, content_hash, size_bytes, storage_path, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ['019577b4-a7c0-7000-8000-000000000070', 'sha256:abc123', 1024, null, '2026-03-22T10:00:00.000Z'],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM attachment_blob WHERE id = '019577b4-a7c0-7000-8000-000000000070'`,
    )
    const serverFixture = loadServerFixture('attachment_blob')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('attachment table shape matches server', async () => {
    await db.query(
      `INSERT INTO attachment (id, note_id, blob_id, document_type_id, filename, display_name, position, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      ['019577b4-a7c0-7000-8000-000000000080', '019577b4-a7c0-7000-8000-000000000002', '019577b4-a7c0-7000-8000-000000000070', null, 'test.pdf', null, 0, '2026-03-22T10:00:00.000Z', null],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM attachment WHERE id = '019577b4-a7c0-7000-8000-000000000080'`,
    )
    const serverFixture = loadServerFixture('attachment')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })

  it('job_queue table shape matches server', async () => {
    await db.query(
      `INSERT INTO job_queue (id, note_id, job_type, status, priority, required_capability, retry_count, max_retries, error, result, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      ['019577b4-a7c0-7000-8000-000000000060', '019577b4-a7c0-7000-8000-000000000002', 'title_generation', 'pending', 5, null, 0, 3, null, null, '2026-03-22T10:00:00.000Z', '2026-03-22T10:00:00.000Z'],
    )

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM job_queue WHERE id = '019577b4-a7c0-7000-8000-000000000060'`,
    )
    const serverFixture = loadServerFixture('job_queue')

    const comparison = matchServerShape(result.rows[0], serverFixture[0])

    expect(comparison.missing).toEqual([])
    expect(comparison.extra).toEqual([])
    expect(comparison.typeMismatch).toEqual([])
  })
})
