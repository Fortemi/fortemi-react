/**
 * PGlite database factory.
 * Enforces PGlite 0.4.x conventions (explicit database: 'postgres').
 * Selects persistence adapter based on config.
 */

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

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
