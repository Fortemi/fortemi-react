/**
 * One-shot migration of the pre-bytecask blob layout into the new store.
 *
 * The legacy layout (shipped through v2026.7.x) was:
 *   - IndexedDB: database `fortemi-<archive>-blobs`, object store `blobs`,
 *     values keyed by the full checksum string (`blake3:<hex>`, historically
 *     also `sha256:<hex>`).
 *   - OPFS: directory `fortemi-<archive>-blobs/<h0h1>/<h2h3>/<checksum>`.
 *
 * Migration re-`put()`s every payload — the new store recomputes BLAKE3, so
 * legacy `sha256:`-keyed entries converge to canonical keys for free
 * (ADR-012 D3). The legacy source is deleted only after every entry migrated
 * without error; any failure leaves it untouched for the next attempt.
 */

import type { BlobStore } from './blob-store.js'

/** Outcome of one migration attempt (for diagnostics/logging). */
export interface LegacyMigrationReport {
  migrated: number
  /** Migration aborted without deleting the legacy source. */
  failed: boolean
}

function legacyName(archiveName: string): string {
  return `fortemi-${archiveName}-blobs`
}

// ── IndexedDB legacy source ─────────────────────────────────────────────────

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function legacyIdbExists(factory: IDBFactory, name: string): Promise<boolean> {
  if (typeof factory.databases === 'function') {
    const dbs = await factory.databases()
    return dbs.some((db) => db.name === name)
  }
  // No databases() enumeration: report unknown as absent rather than opening
  // (an open would create an empty database as a side effect).
  return false
}

async function migrateLegacyIdb(
  archiveName: string,
  target: BlobStore,
  factory: IDBFactory,
): Promise<number> {
  const name = legacyName(archiveName)
  if (!(await legacyIdbExists(factory, name))) return 0

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  try {
    if (!db.objectStoreNames.contains('blobs')) return 0
    const tx = db.transaction('blobs', 'readonly')
    const values = await idbRequest(tx.objectStore('blobs').getAll())
    let migrated = 0
    for (const value of values) {
      if (value instanceof Uint8Array) {
        await target.put(value)
        migrated += 1
      } else if (value instanceof ArrayBuffer) {
        await target.put(new Uint8Array(value))
        migrated += 1
      }
    }
    db.close()
    await idbRequest(factory.deleteDatabase(name))
    return migrated
  } finally {
    // Safe double-close: IDBDatabase.close() is idempotent.
    db.close()
  }
}

// ── OPFS legacy source ──────────────────────────────────────────────────────

/**
 * `FileSystemDirectoryHandle` async iteration is not in the project's TS DOM
 * lib yet; this is the standard `entries()` surface every OPFS-capable
 * browser ships.
 */
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

async function migrateLegacyOpfs(archiveName: string, target: BlobStore): Promise<number> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage?.getDirectory !== 'function'
  ) {
    return 0
  }
  const root = await navigator.storage.getDirectory()
  let legacyDir: IterableDirectoryHandle
  try {
    legacyDir = (await root.getDirectoryHandle(legacyName(archiveName), {
      create: false,
    })) as IterableDirectoryHandle
  } catch {
    return 0 // no legacy directory
  }

  let migrated = 0
  // Layout: <dir1>/<dir2>/<checksum-file>
  for await (const [, d1] of legacyDir.entries()) {
    if (d1.kind !== 'directory') continue
    for await (const [, d2] of (d1 as IterableDirectoryHandle).entries()) {
      if (d2.kind !== 'directory') continue
      for await (const [, fh] of (d2 as IterableDirectoryHandle).entries()) {
        if (fh.kind !== 'file') continue
        const file = await (fh as FileSystemFileHandle).getFile()
        await target.put(new Uint8Array(await file.arrayBuffer()))
        migrated += 1
      }
    }
  }
  await root.removeEntry(legacyName(archiveName), { recursive: true })
  return migrated
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Migrate any legacy blob layout for `archiveName` into `target`, then delete
 * the legacy source. Failures are contained: the legacy data stays in place
 * and the new store keeps whatever was already re-put (idempotent on retry).
 */
export async function migrateLegacyBlobStore(
  archiveName: string,
  target: BlobStore,
  indexedDbFactory?: IDBFactory,
): Promise<LegacyMigrationReport> {
  let migrated = 0
  let failed = false

  const factory = indexedDbFactory ?? globalThis.indexedDB
  if (factory) {
    try {
      migrated += await migrateLegacyIdb(archiveName, target, factory)
    } catch {
      failed = true
    }
  }
  try {
    migrated += await migrateLegacyOpfs(archiveName, target)
  } catch {
    failed = true
  }

  return { migrated, failed }
}
