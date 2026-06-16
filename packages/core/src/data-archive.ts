/**
 * Physical data-dir snapshot (issue #187).
 *
 * A *snapshot* is a binary dump of a populated PGlite data directory — schema +
 * rows + INDEXES (including the HNSW vector index from migration 0004) — that
 * restores in a single binary load with NO migration, NO shard import, and NO
 * client-side HNSW build. It is the fast, pre-indexed, single-version restore
 * option, complementary to logical Knowledge Shards (which are portable + mergeable
 * but pay the import + reindex cost on every load).
 *
 * Named "snapshot" to stay distinct from:
 *  - `ArchiveManager` / `archiveName` — a *named persistence store* (idb/opfs namespace).
 *  - Knowledge Shards — logical, portable, mergeable interchange (`importShard`).
 *
 * Safety (the one real risk of the physical format): a Postgres data dir is coupled
 * to the PGlite/pgvector version and the schema-migration head it was built with.
 * Every snapshot carries a version stamp (a JSON sidecar); `restoreDbSnapshot`
 * verifies compatibility BEFORE loading and fails fast (`DbSnapshotVersionError`) on
 * mismatch, so a host can fall back to a shard import.
 */

import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance, type CreatePGliteOptions, type PersistenceMode } from './db.js'
import { allMigrations } from './migrations/index.js'

/** Snapshot meta envelope schema. */
export const DB_SNAPSHOT_SCHEMA_VERSION = 'fortemi.db-snapshot.v1' as const

/**
 * PGlite version this build of @fortemi/core bundles and can safely restore a
 * snapshot from. Kept in sync with the `@electric-sql/pglite` dependency; a unit
 * test asserts it matches package.json so it can't silently drift.
 */
export const SUPPORTED_PGLITE_VERSION = '0.4.1'

/** Schema-migration head this build expects a restored snapshot to carry. */
export const CURRENT_MIGRATION_HEAD: number = allMigrations.reduce(
  (head, migration) => Math.max(head, migration.version),
  0,
)

export type DbSnapshotCompression = 'none' | 'gzip' | 'auto'

export interface DbSnapshotMeta {
  schema_version: typeof DB_SNAPSHOT_SCHEMA_VERSION
  /** PGlite version the data dir was dumped from (data-dir format coupling). */
  pglite_version: string
  /** pgvector extension version at dump time (advisory). */
  pgvector_version: string | null
  /** Max applied migration version at dump time (schema coupling). */
  migration_head: number
  /** ISO-8601 dump time. */
  created_at: string
  /** @fortemi/core version that produced the snapshot (diagnostic only). */
  fortemi_version?: string
}

export interface DbSnapshot {
  /** The PGlite data-dir dump (gzip by default). Serve as a static asset. */
  data: Blob | File
  /** Version stamp — serve alongside `data` as a `<name>.meta.json` sidecar. */
  meta: DbSnapshotMeta
}

/** Minimal shape `dumpDbSnapshot` needs — PGlite satisfies it structurally. */
export interface DumpableDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  dumpDataDir(compression?: DbSnapshotCompression): Promise<Blob | File>
}

export interface DumpDbSnapshotOptions {
  /** Defaults to 'gzip'. */
  compression?: DbSnapshotCompression
  /** Recorded in meta for diagnostics. */
  fortemiVersion?: string
  /** Override the timestamp (tests / reproducible builds). */
  createdAt?: string
}

async function readMigrationHead(db: DumpableDb): Promise<number> {
  try {
    const result = await db.query<{ head: number }>(
      'SELECT COALESCE(MAX(version), 0) AS head FROM schema_version',
    )
    return Number(result.rows[0]?.head ?? 0)
  } catch {
    // No schema_version table → an unmigrated dir; head 0.
    return 0
  }
}

async function readPgvectorVersion(db: DumpableDb): Promise<string | null> {
  try {
    const result = await db.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    )
    return result.rows[0]?.extversion ?? null
  } catch {
    return null
  }
}

/**
 * Dump a populated PGlite into a versioned snapshot. Build-time (Node), after the
 * corpus is loaded and the HNSW index has been built once.
 *
 * Returns `{ data, meta }`: write `data` to e.g. `corpus.pgdata` and `meta` to
 * `corpus.pgdata.meta.json` (the sidecar `restoreDbSnapshot(url)` looks for).
 */
export async function dumpDbSnapshot(
  db: DumpableDb,
  options: DumpDbSnapshotOptions = {},
): Promise<DbSnapshot> {
  const migration_head = await readMigrationHead(db)
  const pgvector_version = await readPgvectorVersion(db)
  const data = await db.dumpDataDir(options.compression ?? 'gzip')
  const meta: DbSnapshotMeta = {
    schema_version: DB_SNAPSHOT_SCHEMA_VERSION,
    pglite_version: SUPPORTED_PGLITE_VERSION,
    pgvector_version,
    migration_head,
    created_at: options.createdAt ?? new Date().toISOString(),
    ...(options.fortemiVersion ? { fortemi_version: options.fortemiVersion } : {}),
  }
  return { data, meta }
}

export interface DbSnapshotExpectations {
  migrationHead?: number
  pgliteVersion?: string
  /** When provided, a differing snapshot pgvector version is a warning, not a failure. */
  pgvectorVersion?: string | null
}

export interface DbSnapshotCompat {
  compatible: boolean
  /** Hard incompatibilities — restore must refuse. */
  reasons: string[]
  /** Advisory differences — restore proceeds. */
  warnings: string[]
}

function majorMinor(version: string): string {
  const parts = version.split('.')
  return `${parts[0] ?? '0'}.${parts[1] ?? '0'}`
}

/**
 * Verify a snapshot's version stamp against what this build supports. Pure —
 * unit-testable with no PGlite. Hard gates: snapshot schema, migration head
 * (exact), PGlite major.minor (data-dir format). pgvector is advisory.
 */
export function verifyDbSnapshotMeta(
  meta: DbSnapshotMeta,
  expected: DbSnapshotExpectations = {},
): DbSnapshotCompat {
  const reasons: string[] = []
  const warnings: string[] = []
  const expectedHead = expected.migrationHead ?? CURRENT_MIGRATION_HEAD
  const expectedPglite = expected.pgliteVersion ?? SUPPORTED_PGLITE_VERSION

  if (meta.schema_version !== DB_SNAPSHOT_SCHEMA_VERSION) {
    reasons.push(`unsupported snapshot schema_version: ${String(meta.schema_version)}`)
  }
  if (meta.migration_head !== expectedHead) {
    reasons.push(`migration head mismatch: snapshot=${meta.migration_head}, supported=${expectedHead}`)
  }
  if (majorMinor(meta.pglite_version) !== majorMinor(expectedPglite)) {
    reasons.push(`PGlite version mismatch: snapshot=${meta.pglite_version}, supported=${expectedPglite}`)
  }
  if (expected.pgvectorVersion !== undefined && meta.pgvector_version !== expected.pgvectorVersion) {
    warnings.push(`pgvector version differs: snapshot=${String(meta.pgvector_version)}, expected=${String(expected.pgvectorVersion)}`)
  }

  return { compatible: reasons.length === 0, reasons, warnings }
}

/** Thrown by `restoreDbSnapshot` when the snapshot is incompatible with this build. */
export class DbSnapshotVersionError extends Error {
  readonly reasons: string[]
  readonly meta: DbSnapshotMeta
  constructor(reasons: string[], meta: DbSnapshotMeta) {
    super(`Incompatible DB snapshot: ${reasons.join('; ')}`)
    this.name = 'DbSnapshotVersionError'
    this.reasons = reasons
    this.meta = meta
  }
}

export type DbSnapshotSource =
  | DbSnapshot
  | string
  | { dataUrl: string; metaUrl?: string }

export interface RestoreDbSnapshotOptions {
  /** Persistence for the restored instance. Defaults to 'memory' (read-only demos). */
  persistence?: PersistenceMode
  archiveName?: string
  /** Verification expectations (defaults to this build's supported values). */
  expectations?: DbSnapshotExpectations
  /** Injectable fetch (tests / non-browser). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

function isInlineSnapshot(source: DbSnapshotSource): source is DbSnapshot {
  return typeof source === 'object' && 'data' in source && 'meta' in source
}

async function resolveSnapshotSource(
  source: DbSnapshotSource,
  fetchImpl: typeof fetch,
): Promise<DbSnapshot> {
  if (isInlineSnapshot(source)) return source

  const dataUrl = typeof source === 'string' ? source : source.dataUrl
  const metaUrl = typeof source === 'string'
    ? `${source}.meta.json`
    : (source.metaUrl ?? `${source.dataUrl}.meta.json`)

  const metaResponse = await fetchImpl(metaUrl)
  if (!metaResponse.ok) {
    throw new Error(`Failed to fetch snapshot meta (${metaResponse.status}): ${metaUrl}`)
  }
  const meta = (await metaResponse.json()) as DbSnapshotMeta

  const dataResponse = await fetchImpl(dataUrl)
  if (!dataResponse.ok) {
    throw new Error(`Failed to fetch snapshot data (${dataResponse.status}): ${dataUrl}`)
  }
  const data = await dataResponse.blob()

  return { data, meta }
}

/**
 * Restore a PGlite from a physical snapshot — verify the version stamp first,
 * then load the data dir with **no migration / import / HNSW build**. Throws
 * `DbSnapshotVersionError` on incompatibility (catch it to fall back to a shard
 * import). The returned instance is ready to query; do NOT run migrations on it.
 */
export async function restoreDbSnapshot(
  source: DbSnapshotSource,
  options: RestoreDbSnapshotOptions = {},
): Promise<PGlite> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch)
  const { data, meta } = await resolveSnapshotSource(source, fetchImpl)

  const compat = verifyDbSnapshotMeta(meta, options.expectations)
  if (!compat.compatible) {
    throw new DbSnapshotVersionError(compat.reasons, meta)
  }

  const createOptions: CreatePGliteOptions = { loadDataDir: data }
  return createPGliteInstance(options.persistence ?? 'memory', options.archiveName ?? 'default', createOptions)
}
