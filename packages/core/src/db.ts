/**
 * PGlite database factory.
 * Enforces PGlite 0.4.x conventions (explicit database: 'postgres').
 * Selects persistence adapter based on config.
 *
 * PGlite is loaded LAZILY via dynamic `import()` inside `createPGliteInstance`
 * (issue #261) — the top-level import is type-only so the emitted `dist/index.js`
 * carries no static `import '@electric-sql/pglite'`. Consumers that never boot a
 * PGlite-backed store therefore do not pull the WASM engine into their bundle,
 * and `@electric-sql/pglite` is an OPTIONAL dependency of `@fortemi/core`.
 */

import type { PGlite } from '@electric-sql/pglite'

export type PersistenceMode = 'opfs' | 'idb' | 'memory'

function getDataDir(persistence: PersistenceMode, archiveName: string): string | undefined {
  switch (persistence) {
    case 'opfs':
      return `opfs-ahp://fortemi-${archiveName}`
    case 'idb':
      return `idb://fortemi-${archiveName}`
    case 'memory':
      return undefined
  }
}

export interface CreatePGliteOptions {
  /**
   * Restore the instance from a physical data-dir snapshot (issue #187) — schema
   * + rows + INDEXES in one binary load, with no migration / import / reindex.
   * The blob comes from PGlite's `dumpDataDir`; see `dumpDbSnapshot`/`restoreDbSnapshot`.
   * When set, callers MUST NOT run migrations — the restored dir already carries them.
   */
  loadDataDir?: Blob | File
}

export async function createPGliteInstance(
  persistence: PersistenceMode,
  archiveName: string = 'default',
  options: CreatePGliteOptions = {},
): Promise<PGlite> {
  const dataDir = getDataDir(persistence, archiveName)

  // Lazy-load the engine and pgvector extension (issue #261). The dynamic
  // import keeps `@electric-sql/pglite` out of the static module graph, so it
  // is only fetched when a PGlite-backed store is actually constructed.
  const [{ PGlite }, { vector }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/vector'),
  ])

  const pgliteOptions: Record<string, unknown> = {
    database: 'postgres', // PGlite 0.4.x breaking change: explicit required
    extensions: { vector },
  }

  if (dataDir) {
    pgliteOptions.dataDir = dataDir
  }

  if (options.loadDataDir) {
    pgliteOptions.loadDataDir = options.loadDataDir
  }

  const db = await PGlite.create(pgliteOptions)

  // Enable pgvector extension (idempotent — already present on a restored dir).
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')

  return db
}
