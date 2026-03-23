/**
 * Content-addressable blob storage.
 *
 * Path format: blobs/{dir1}/{dir2}/{hash}
 *   dir1 = first 2 hex chars of hash
 *   dir2 = next 2 hex chars of hash
 *   filename = full hash
 *
 * Two implementations are provided:
 *   - OpfsBlobStore  — Origin Private File System (Chrome/Edge 86+)
 *   - IdbBlobStore   — IndexedDB fallback (Firefox, Safari)
 *
 * Use createBlobStore() to get the best available implementation.
 * Export MemoryBlobStore for use in tests.
 */

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface BlobStore {
  write(hash: string, data: Uint8Array): Promise<void>
  read(hash: string): Promise<Uint8Array | null>
  remove(hash: string): Promise<void>
  exists(hash: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashPath(hash: string): { dir1: string; dir2: string; filename: string } {
  return {
    dir1: hash.slice(0, 2),
    dir2: hash.slice(2, 4),
    filename: hash,
  }
}

// ---------------------------------------------------------------------------
// OPFS implementation
// ---------------------------------------------------------------------------

class OpfsBlobStore implements BlobStore {
  constructor(private archiveName: string) {}

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(`fortemi-${this.archiveName}-blobs`, { create: true })
  }

  private async getFileHandle(
    hash: string,
    create: boolean,
  ): Promise<FileSystemFileHandle | null> {
    const { dir1, dir2, filename } = hashPath(hash)
    try {
      const root = await this.getRoot()
      const d1 = await root.getDirectoryHandle(dir1, { create })
      const d2 = await d1.getDirectoryHandle(dir2, { create })
      return d2.getFileHandle(filename, { create })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return null
      }
      throw err
    }
  }

  async write(hash: string, data: Uint8Array): Promise<void> {
    const fh = await this.getFileHandle(hash, true)
    if (!fh) throw new Error(`OpfsBlobStore: could not create file for hash ${hash}`)
    // createSyncAccessHandle is worker-only; use a writable stream instead.
    const writable = await fh.createWritable()
    // Slice to a plain ArrayBuffer so TS is happy with the stricter
    // FileSystemWritableFileStream.write() overload signature.
    await writable.write(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    await writable.close()
  }

  async read(hash: string): Promise<Uint8Array | null> {
    const fh = await this.getFileHandle(hash, false)
    if (!fh) return null
    const file = await fh.getFile()
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async remove(hash: string): Promise<void> {
    const { dir1, dir2, filename } = hashPath(hash)
    try {
      const root = await this.getRoot()
      const d1 = await root.getDirectoryHandle(dir1, { create: false })
      const d2 = await d1.getDirectoryHandle(dir2, { create: false })
      await d2.removeEntry(filename)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return // already gone — idempotent
      }
      throw err
    }
  }

  async exists(hash: string): Promise<boolean> {
    const fh = await this.getFileHandle(hash, false)
    return fh !== null
  }
}

// ---------------------------------------------------------------------------
// IDB implementation
// ---------------------------------------------------------------------------

const IDB_STORE = 'blobs'
const IDB_VERSION = 1

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, IDB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

class IdbBlobStore implements BlobStore {
  private dbName: string
  private _db: IDBDatabase | null = null

  constructor(archiveName: string) {
    this.dbName = `fortemi-${archiveName}-blobs`
  }

  private async db(): Promise<IDBDatabase> {
    if (!this._db) {
      this._db = await openDb(this.dbName)
    }
    return this._db
  }

  async write(hash: string, data: Uint8Array): Promise<void> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(data, hash)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async read(hash: string): Promise<Uint8Array | null> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(hash)
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  }

  async remove(hash: string): Promise<void> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(hash)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async exists(hash: string): Promise<boolean> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).count(hash)
      req.onsuccess = () => resolve(req.result > 0)
      req.onerror = () => reject(req.error)
    })
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (testing)
// ---------------------------------------------------------------------------

export class MemoryBlobStore implements BlobStore {
  private store = new Map<string, Uint8Array>()

  async write(hash: string, data: Uint8Array): Promise<void> {
    this.store.set(hash, data)
  }

  async read(hash: string): Promise<Uint8Array | null> {
    return this.store.get(hash) ?? null
  }

  async remove(hash: string): Promise<void> {
    this.store.delete(hash)
  }

  async exists(hash: string): Promise<boolean> {
    return this.store.has(hash)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBlobStore(archiveName: string): BlobStore {
  if (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  ) {
    return new OpfsBlobStore(archiveName)
  }
  return new IdbBlobStore(archiveName)
}
