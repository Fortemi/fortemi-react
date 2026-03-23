import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { allMigrations } from '../migrations/index.js'
import { migration0001 } from '../migrations/0001_initial_schema.js'
import { migration0002 } from '../migrations/0002_skos_tagging.js'
import { migration0003 } from '../migrations/0003_attachments.js'
import type { Migration } from '../migration-runner.js'

describe('MigrationRunner', () => {
  let db: PGlite
  let events: TypedEventBus
  let runner: MigrationRunner

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    events = new TypedEventBus()
    runner = new MigrationRunner(db, events)
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates schema_version table on first run', async () => {
    await runner.ensureSchemaTable()

    const result = await db.query(
      "SELECT tablename FROM pg_tables WHERE tablename = 'schema_version'",
    )
    expect(result.rows).toHaveLength(1)
  })

  it('reports version 0 on empty database', async () => {
    await runner.ensureSchemaTable()
    const version = await runner.getCurrentVersion()
    expect(version).toBe(0)
  })

  it('applies all 4 migrations successfully', async () => {
    const applied = await runner.apply(allMigrations)

    expect(applied).toBe(4)
    const version = await runner.getCurrentVersion()
    expect(version).toBe(4)
  })

  it('creates all core tables from migrations 0001–0004', async () => {
    await runner.apply(allMigrations)

    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
    const tableNames = tables.rows.map((r) => r.tablename)

    // 0001 — initial schema
    expect(tableNames).toContain('archive')
    expect(tableNames).toContain('note')
    expect(tableNames).toContain('note_original')
    expect(tableNames).toContain('note_revised_current')
    expect(tableNames).toContain('note_revision')
    expect(tableNames).toContain('collection')
    expect(tableNames).toContain('collection_note')
    expect(tableNames).toContain('job_queue')
    expect(tableNames).toContain('api_key')
    expect(tableNames).toContain('link')
    expect(tableNames).toContain('provenance_edge')

    // 0002 — SKOS tagging
    expect(tableNames).toContain('skos_scheme')
    expect(tableNames).toContain('skos_concept')
    expect(tableNames).toContain('skos_concept_relation')
    expect(tableNames).toContain('note_tag')
    expect(tableNames).toContain('note_skos_tag')

    // 0003 — attachments
    expect(tableNames).toContain('document_type')
    expect(tableNames).toContain('attachment_blob')
    expect(tableNames).toContain('attachment')

    // 0004 — embeddings
    expect(tableNames).toContain('embedding_set')
    expect(tableNames).toContain('embedding')
    expect(tableNames).toContain('embedding_set_member')
  })

  it('is idempotent — running twice applies only once', async () => {
    const first = await runner.apply(allMigrations)
    const second = await runner.apply(allMigrations)

    expect(first).toBe(4)
    expect(second).toBe(0) // no new migrations
    expect(await runner.getCurrentVersion()).toBe(4)
  })

  it('records all applied migrations in schema_version', async () => {
    await runner.apply(allMigrations)

    const applied = await runner.getAppliedMigrations()
    expect(applied).toHaveLength(4)
    expect(applied[0].version).toBe(1)
    expect(applied[0].name).toBe('0001_initial_schema')
    expect(applied[1].version).toBe(2)
    expect(applied[1].name).toBe('0002_skos_tagging')
    expect(applied[2].version).toBe(3)
    expect(applied[2].name).toBe('0003_attachments')
    expect(applied[3].version).toBe(4)
    expect(applied[3].name).toBe('0004_embeddings')
  })

  it('emits migration.applied event for each migration', async () => {
    const handler = vi.fn()
    events.on('migration.applied', handler)

    await runner.apply(allMigrations)

    expect(handler).toHaveBeenCalledTimes(4)
    expect(handler).toHaveBeenNthCalledWith(1, { version: 1 })
    expect(handler).toHaveBeenNthCalledWith(2, { version: 2 })
    expect(handler).toHaveBeenNthCalledWith(3, { version: 3 })
    expect(handler).toHaveBeenNthCalledWith(4, { version: 4 })
  })

  it('rolls back failed migration', async () => {
    const badMigration: Migration = {
      version: 999,
      name: 'bad_migration',
      sql: 'CREATE TABLE will_fail (id INVALID_TYPE)',
    }

    await runner.ensureSchemaTable()

    await expect(runner.apply([badMigration])).rejects.toThrow()

    // Version should still be 0
    expect(await runner.getCurrentVersion()).toBe(0)
  })

  it('note table has correct columns including tsv', async () => {
    await runner.apply(allMigrations)

    const result = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'note' ORDER BY ordinal_position",
    )
    const columns = result.rows.map((r) => r.column_name)

    expect(columns).toContain('id')
    expect(columns).toContain('title')
    expect(columns).toContain('source')
    expect(columns).toContain('revision_mode')
    expect(columns).toContain('is_starred')
    expect(columns).toContain('created_at')
    expect(columns).toContain('deleted_at')
    expect(columns).toContain('tsv')
  })

  it('applies migrations incrementally — each migration builds on the previous', async () => {
    // Apply only migration 0001
    const after0001 = await runner.apply([migration0001])
    expect(after0001).toBe(1)
    expect(await runner.getCurrentVersion()).toBe(1)

    // Apply migration 0002 on top
    const after0002 = await runner.apply([migration0001, migration0002])
    expect(after0002).toBe(1) // only 0002 was new
    expect(await runner.getCurrentVersion()).toBe(2)

    // Apply migration 0003 on top
    const after0003 = await runner.apply([migration0001, migration0002, migration0003])
    expect(after0003).toBe(1)
    expect(await runner.getCurrentVersion()).toBe(3)

    // Apply migration 0004 on top
    const after0004 = await runner.apply(allMigrations)
    expect(after0004).toBe(1)
    expect(await runner.getCurrentVersion()).toBe(4)
  })

  it('note_tag enforces unique constraint on (note_id, tag)', async () => {
    await runner.apply(allMigrations)

    await db.query(
      "INSERT INTO note (id, format, source, visibility, revision_mode) VALUES ($1, 'markdown', 'user', 'private', 'standard')",
      ['note-1'],
    )
    await db.query(
      "INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)",
      ['tag-1', 'note-1', 'rust'],
    )

    await expect(
      db.query(
        "INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)",
        ['tag-2', 'note-1', 'rust'],
      ),
    ).rejects.toThrow()
  })

  it('skos_concept_relation enforces valid relation_type', async () => {
    await runner.apply(allMigrations)

    await db.query(
      "INSERT INTO skos_scheme (id, title) VALUES ($1, $2)",
      ['scheme-1', 'Test Scheme'],
    )
    await db.query(
      "INSERT INTO skos_concept (id, scheme_id, pref_label) VALUES ($1, $2, $3)",
      ['concept-1', 'scheme-1', 'Parent'],
    )
    await db.query(
      "INSERT INTO skos_concept (id, scheme_id, pref_label) VALUES ($1, $2, $3)",
      ['concept-2', 'scheme-1', 'Child'],
    )

    await expect(
      db.query(
        "INSERT INTO skos_concept_relation (id, source_concept_id, target_concept_id, relation_type) VALUES ($1, $2, $3, $4)",
        ['rel-1', 'concept-1', 'concept-2', 'invalid_type'],
      ),
    ).rejects.toThrow()
  })

  it('embedding table enforces unique (note_id, embedding_set_id)', async () => {
    await runner.apply(allMigrations)

    await db.query(
      "INSERT INTO note (id, format, source, visibility, revision_mode) VALUES ($1, 'markdown', 'user', 'private', 'standard')",
      ['note-emb-1'],
    )
    await db.query(
      "INSERT INTO embedding_set (id, model_name) VALUES ($1, $2)",
      ['eset-1', 'all-minilm-l6-v2'],
    )

    const vec = JSON.stringify(Array.from({ length: 384 }, () => 0.1))
    await db.query(
      "INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ($1, $2, $3, $4)",
      ['emb-1', 'note-emb-1', 'eset-1', vec],
    )

    await expect(
      db.query(
        "INSERT INTO embedding (id, note_id, embedding_set_id, vector) VALUES ($1, $2, $3, $4)",
        ['emb-2', 'note-emb-1', 'eset-1', vec],
      ),
    ).rejects.toThrow()
  })
})
