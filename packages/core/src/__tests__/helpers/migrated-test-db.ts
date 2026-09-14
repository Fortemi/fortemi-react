import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'

let pristine: Promise<Blob> | undefined

async function snapshot(): Promise<Blob> {
  const db = await PGlite.create({ extensions: { vector } })
  try {
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    return await db.dumpDataDir('none')
  } finally {
    await db.close()
  }
}

export async function createMigratedTestDb(): Promise<PGlite> {
  // Cache only immutable empty schema bytes, never a live or populated database.
  pristine ??= snapshot()
  const db = await PGlite.create({ extensions: { vector }, loadDataDir: await pristine })
  try {
    for (const table of ['note', 'native_shard_record_lineage', 'knowledge_shard_component_record', 'job_queue']) {
      assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows, [], `Nonempty test fixture: ${table}`)
    }
    assert.deepEqual(await new MigrationRunner(db).getAppliedMigrations(),
      allMigrations.map(({ version, name }) => ({ version, name })).sort((a, b) => a.version - b.version))
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}
