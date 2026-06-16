import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  CURRENT_MIGRATION_HEAD,
  DB_SNAPSHOT_SCHEMA_VERSION,
  DbSnapshotVersionError,
  SUPPORTED_PGLITE_VERSION,
  dumpDbSnapshot,
  restoreDbSnapshot,
  verifyDbSnapshotMeta,
  type DbSnapshot,
  type DbSnapshotMeta,
} from '../data-archive.js'
import { allMigrations } from '../migrations/index.js'
import { ArchiveManager } from '../archive-manager.js'
import { PGliteStorageBackend } from '../storage-backend.js'
import pkg from '../../package.json' with { type: 'json' }

function metaFixture(overrides: Partial<DbSnapshotMeta> = {}): DbSnapshotMeta {
  return {
    schema_version: DB_SNAPSHOT_SCHEMA_VERSION,
    pglite_version: SUPPORTED_PGLITE_VERSION,
    pgvector_version: '0.8.0',
    migration_head: CURRENT_MIGRATION_HEAD,
    created_at: '2026-06-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('data-archive — version constants', () => {
  it('SUPPORTED_PGLITE_VERSION matches the installed dependency (no drift)', () => {
    const dep = (pkg.dependencies as Record<string, string>)['@electric-sql/pglite']
    expect(dep.replace(/^[\^~]/, '')).toBe(SUPPORTED_PGLITE_VERSION)
  })

  it('CURRENT_MIGRATION_HEAD is the max migration version', () => {
    const expected = allMigrations.reduce((head, m) => Math.max(head, m.version), 0)
    expect(CURRENT_MIGRATION_HEAD).toBe(expected)
    expect(CURRENT_MIGRATION_HEAD).toBeGreaterThan(0)
  })
})

describe('verifyDbSnapshotMeta', () => {
  it('accepts a matching stamp', () => {
    const result = verifyDbSnapshotMeta(metaFixture())
    expect(result.compatible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('rejects a migration-head mismatch (schema coupling)', () => {
    const result = verifyDbSnapshotMeta(metaFixture({ migration_head: CURRENT_MIGRATION_HEAD - 1 }))
    expect(result.compatible).toBe(false)
    expect(result.reasons.some((r) => r.includes('migration head'))).toBe(true)
  })

  it('rejects a PGlite major.minor mismatch (data-dir format coupling)', () => {
    const result = verifyDbSnapshotMeta(metaFixture({ pglite_version: '0.5.0' }))
    expect(result.compatible).toBe(false)
    expect(result.reasons.some((r) => r.includes('PGlite version'))).toBe(true)
  })

  it('tolerates a PGlite patch difference (same major.minor)', () => {
    const [maj, min] = SUPPORTED_PGLITE_VERSION.split('.')
    const result = verifyDbSnapshotMeta(metaFixture({ pglite_version: `${maj}.${min}.999` }))
    expect(result.compatible).toBe(true)
  })

  it('rejects an unknown snapshot schema_version', () => {
    const result = verifyDbSnapshotMeta(metaFixture({ schema_version: 'fortemi.db-snapshot.v999' as never }))
    expect(result.compatible).toBe(false)
  })

  it('treats a pgvector difference as an advisory warning, not a failure', () => {
    const result = verifyDbSnapshotMeta(metaFixture({ pgvector_version: '0.7.0' }), { pgvectorVersion: '0.8.0' })
    expect(result.compatible).toBe(true)
    expect(result.warnings.length).toBe(1)
  })

  it('honors explicit expectations override', () => {
    const result = verifyDbSnapshotMeta(metaFixture({ migration_head: 3, pglite_version: '1.2.3' }), {
      migrationHead: 3,
      pgliteVersion: '1.2.9',
    })
    expect(result.compatible).toBe(true)
  })
})

describe('restoreDbSnapshot — version gate', () => {
  it('throws DbSnapshotVersionError before loading when incompatible', async () => {
    const snapshot: DbSnapshot = {
      data: new Blob([new Uint8Array([0])]),
      meta: metaFixture({ migration_head: CURRENT_MIGRATION_HEAD + 5 }),
    }
    await expect(restoreDbSnapshot(snapshot)).rejects.toBeInstanceOf(DbSnapshotVersionError)
    await restoreDbSnapshot(snapshot).catch((err: DbSnapshotVersionError) => {
      expect(err.reasons.some((r) => r.includes('migration head'))).toBe(true)
      expect(err.meta.migration_head).toBe(CURRENT_MIGRATION_HEAD + 5)
    })
  })
})

describe('dump → restore round-trip', () => {
  let dumped: PGlite | undefined
  let restored: PGlite | undefined

  afterEach(async () => {
    await dumped?.close()
    await restored?.close()
    dumped = undefined
    restored = undefined
  })

  it('dumps a populated data dir and restores it with no migration/import', async () => {
    dumped = await PGlite.create({ database: 'postgres' })
    // Minimal stand-in for the migrated schema: a schema_version head + a data table.
    await dumped.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO schema_version (version, name) VALUES (${CURRENT_MIGRATION_HEAD}, 'head');
      CREATE TABLE note (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO note (id, title) VALUES ('n1', 'Pre-indexed Note');
    `)

    const snapshot = await dumpDbSnapshot(dumped, { compression: 'none', fortemiVersion: '2026.6.4' })
    expect(snapshot.meta.schema_version).toBe(DB_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.meta.migration_head).toBe(CURRENT_MIGRATION_HEAD)
    expect(snapshot.meta.pglite_version).toBe(SUPPORTED_PGLITE_VERSION)
    expect(snapshot.meta.fortemi_version).toBe('2026.6.4')

    restored = await restoreDbSnapshot(snapshot, { persistence: 'memory' })
    const rows = await restored.query<{ title: string }>('SELECT title FROM note WHERE id = $1', ['n1'])
    expect(rows.rows[0]?.title).toBe('Pre-indexed Note')
    const head = await restored.query<{ head: number }>('SELECT MAX(version) AS head FROM schema_version')
    expect(Number(head.rows[0]?.head)).toBe(CURRENT_MIGRATION_HEAD)
  }, 30_000)

  it('restores from a URL with a .meta.json sidecar via an injected fetch', async () => {
    dumped = await PGlite.create({ database: 'postgres' })
    await dumped.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO schema_version (version, name) VALUES (${CURRENT_MIGRATION_HEAD}, 'head');
      CREATE TABLE note (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO note (id, title) VALUES ('n2', 'From URL');
    `)
    const snapshot = await dumpDbSnapshot(dumped, { compression: 'none' })

    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const href = String(url)
      if (href.endsWith('.meta.json')) {
        return new Response(JSON.stringify(snapshot.meta), { status: 200 })
      }
      return new Response(snapshot.data, { status: 200 })
    }) as typeof fetch

    restored = await restoreDbSnapshot('/corpus/corpus.pgdata', { persistence: 'memory', fetchImpl })
    const rows = await restored.query<{ title: string }>('SELECT title FROM note WHERE id = $1', ['n2'])
    expect(rows.rows[0]?.title).toBe('From URL')
  }, 30_000)

  it('ArchiveManager.adopt wires a restored backend without running migrations', async () => {
    dumped = await PGlite.create({ database: 'postgres' })
    await dumped.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO schema_version (version, name) VALUES (${CURRENT_MIGRATION_HEAD}, 'head');
      CREATE TABLE note (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO note (id, title) VALUES ('n3', 'Adopted');
    `)
    const snapshot = await dumpDbSnapshot(dumped, { compression: 'none' })

    restored = await restoreDbSnapshot(snapshot, { persistence: 'memory' })
    const backend = new PGliteStorageBackend('pglite:snapshot:test', restored)
    const manager = new ArchiveManager('memory')
    const adopted = await manager.adopt(backend, 'default')

    expect(manager.getDb()).toBe(backend)
    const rows = await adopted.query<{ title: string }>('SELECT title FROM note WHERE id = $1', ['n3'])
    expect(rows.rows[0]?.title).toBe('Adopted')
    // adopt() must NOT re-run migrations: the head is exactly what the snapshot carried.
    const versions = await adopted.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM schema_version')
    expect(Number(versions.rows[0]?.count)).toBe(1)
  }, 30_000)
})
