/**
 * Sequential SQL migration runner for PGlite.
 * Tracks applied migrations in a schema_version table.
 * Each migration runs in a transaction; version updated atomically.
 */

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from './event-bus.js'

export interface Migration {
  version: number
  name: string
  sql: string
}

export class MigrationRunner {
  constructor(
    private db: PGlite,
    private events?: TypedEventBus,
  ) {}

  async ensureSchemaTable(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (version)
      )
    `)
  }

  async getCurrentVersion(): Promise<number> {
    const result = await this.db.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version',
    )
    return result.rows[0].version
  }

  async apply(migrations: Migration[]): Promise<number> {
    await this.ensureSchemaTable()
    const currentVersion = await this.getCurrentVersion()

    const pending = migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version)

    let applied = 0

    for (const migration of pending) {
      await this.db.transaction(async (tx) => {
        await tx.exec(migration.sql)
        await tx.query(
          'INSERT INTO schema_version (version, name) VALUES ($1, $2)',
          [migration.version, migration.name],
        )
      })

      applied++
      this.events?.emit('migration.applied', { version: migration.version })
    }

    return applied
  }

  async getAppliedMigrations(): Promise<Array<{ version: number; name: string }>> {
    const result = await this.db.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_version ORDER BY version',
    )
    return result.rows
  }
}
