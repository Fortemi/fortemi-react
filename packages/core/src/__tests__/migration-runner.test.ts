import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { allMigrations } from '../migrations/index.js'
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

  it('applies migration 0001 successfully', async () => {
    const applied = await runner.apply(allMigrations)

    expect(applied).toBe(1)
    const version = await runner.getCurrentVersion()
    expect(version).toBe(1)
  })

  it('creates all core tables from migration 0001', async () => {
    await runner.apply(allMigrations)

    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
    const tableNames = tables.rows.map((r) => r.tablename)

    expect(tableNames).toContain('archive')
    expect(tableNames).toContain('note')
    expect(tableNames).toContain('note_original')
    expect(tableNames).toContain('note_revised_current')
    expect(tableNames).toContain('note_revision')
    expect(tableNames).toContain('collection')
    expect(tableNames).toContain('collection_note')
    expect(tableNames).toContain('job_queue')
  })

  it('is idempotent — running twice applies only once', async () => {
    const first = await runner.apply(allMigrations)
    const second = await runner.apply(allMigrations)

    expect(first).toBe(1)
    expect(second).toBe(0) // no new migrations
    expect(await runner.getCurrentVersion()).toBe(1)
  })

  it('records applied migration in schema_version', async () => {
    await runner.apply(allMigrations)

    const applied = await runner.getAppliedMigrations()
    expect(applied).toHaveLength(1)
    expect(applied[0].version).toBe(1)
    expect(applied[0].name).toBe('0001_initial_schema')
  })

  it('emits migration.applied event', async () => {
    const handler = vi.fn()
    events.on('migration.applied', handler)

    await runner.apply(allMigrations)

    expect(handler).toHaveBeenCalledWith({ version: 1 })
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

  it('note table has correct columns', async () => {
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
  })
})
