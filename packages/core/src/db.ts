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

export async function createPGliteInstance(
  persistence: PersistenceMode,
  archiveName: string = 'default',
): Promise<PGlite> {
  const dataDir = getDataDir(persistence, archiveName)

  const options: Record<string, unknown> = {
    database: 'postgres', // PGlite 0.4.x breaking change: explicit required
    extensions: { vector },
  }

  if (dataDir) {
    options.dataDir = dataDir
  }

  const db = await PGlite.create(options)

  // Enable pgvector extension (must be done after create)
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')

  return db
}
