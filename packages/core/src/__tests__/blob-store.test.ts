/**
 * BlobStore seam tests — the content-addressed contract (#319 / ADR-013).
 *
 * The shared contract suite runs against both implementations:
 *   - MemoryBlobStore (dependency-free test/no-persistence tier)
 *   - the bytecask-backed store (IndexedDB tier over fake-indexeddb)
 *
 * Bytecask-only suites cover reload persistence, interrupted-write
 * reconciliation, and the one-shot legacy-layout migration.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect } from 'vitest'
import { MemoryBlobStore, createBlobStore, createLazyBlobStore } from '../blob-store.js'
import type { BlobStore } from '../blob-store.js'
import { computeBlobHash } from '../hash.js'

const DATA_A = new Uint8Array([1, 2, 3, 4, 5])
const DATA_B = new Uint8Array([10, 20, 30])

function contractSuite(label: string, makeStore: () => Promise<BlobStore>) {
  describe(`${label} — contract`, () => {
    it('put returns the canonical blake3:<hex> checksum', async () => {
      const store = await makeStore()
      const checksum = await store.put(DATA_A)
      expect(checksum).toBe(computeBlobHash(DATA_A))
      expect(checksum).toMatch(/^blake3:[0-9a-f]{64}$/)
      await store.close()
    })

    it('read round-trips bytes by canonical checksum', async () => {
      const store = await makeStore()
      const checksum = await store.put(DATA_A)
      expect(await store.read(checksum)).toEqual(DATA_A)
      await store.close()
    })

    it('read returns null for unknown checksums (reference-only)', async () => {
      const store = await makeStore()
      expect(await store.read(computeBlobHash(DATA_B))).toBeNull()
      await store.close()
    })

    it('has reflects physical byte presence', async () => {
      const store = await makeStore()
      expect(await store.has(computeBlobHash(DATA_A))).toBe(false)
      await store.put(DATA_A)
      expect(await store.has(computeBlobHash(DATA_A))).toBe(true)
      await store.close()
    })

    it('delete removes exactly one promoted checksum', async () => {
      const store = await makeStore()
      const checksum = await store.put(DATA_A)
      expect(store.delete).toBeTypeOf('function')
      expect(await store.delete!(checksum)).toBe(true)
      expect(await store.delete!(checksum)).toBe(false)
      expect(await store.has(checksum)).toBe(false)
      expect(await store.read(checksum)).toBeNull()
      await store.close()
    })

    it('duplicate puts deduplicate to one checksum', async () => {
      const store = await makeStore()
      const first = await store.put(DATA_A)
      const second = await store.put(new Uint8Array(DATA_A))
      expect(second).toBe(first)
      await store.close()
    })

    it('stores and retrieves an empty payload', async () => {
      const store = await makeStore()
      const empty = new Uint8Array(0)
      const checksum = await store.put(empty)
      expect(await store.read(checksum)).toEqual(empty)
      await store.close()
    })

    it('stores and retrieves a 1 MiB payload', { timeout: 30_000 }, async () => {
      const store = await makeStore()
      const big = new Uint8Array(1024 * 1024)
      for (let i = 0; i < big.length; i += 1) big[i] = i & 0xff
      const checksum = await store.put(big)
      expect(await store.read(checksum)).toEqual(big)
      await store.close()
    })

    it('reconcile reports missing (live but absent) and unreferenced (orphan) bytes', async () => {
      const store = await makeStore()
      const kept = await store.put(DATA_A)
      const orphan = await store.put(DATA_B)
      const missing = computeBlobHash(new Uint8Array([9, 9, 9]))

      const result = await store.reconcile([kept, missing])
      expect(result.referenced).toBe(1)
      expect(result.missing).toEqual([missing])
      expect(result.unreferenced).toEqual([orphan])
      expect(result.removed).toBe(0)
      // Orphan bytes remain until removal is explicit.
      expect(await store.has(orphan)).toBe(true)
      await store.close()
    })

    it('reconcile removeUnreferenced sweeps orphans immediately', async () => {
      const store = await makeStore()
      const kept = await store.put(DATA_A)
      const orphan = await store.put(DATA_B)

      const result = await store.reconcile([kept], { removeUnreferenced: true })
      expect(result.removed).toBe(1)
      expect(result.bytesFreed).toBe(DATA_B.byteLength)
      expect(await store.has(orphan)).toBe(false)
      expect(await store.read(kept)).toEqual(DATA_A)
      await store.close()
    })

    it('gc collects unreferenced objects after reconcile marks them', async () => {
      const store = await makeStore()
      const kept = await store.put(DATA_A)
      const orphan = await store.put(DATA_B)

      await store.reconcile([kept])
      const result = await store.gc({ minAgeMs: 0 })
      expect(result.collected).toBe(1)
      expect(await store.has(orphan)).toBe(false)
      expect(await store.has(kept)).toBe(true)
      await store.close()
    })

    it('reports its backend diagnostically', async () => {
      const store = await makeStore()
      const diag = await store.diagnostics()
      expect(['idb', 'opfs', 'memory']).toContain(diag.backend)
      await store.close()
    })
  })
}

contractSuite('MemoryBlobStore', async () => new MemoryBlobStore())

// One fresh fake-indexeddb factory per store keeps tests fully isolated.
contractSuite('BytecaskBlobStore (idb)', () =>
  createBlobStore('contract-test', { indexedDB: new IDBFactory() }),
)

describe('BytecaskBlobStore (idb tier)', () => {
  it('selects the idb backend and reports the probe', async () => {
    const store = await createBlobStore('probe-test', { indexedDB: new IDBFactory() })
    const diag = await store.diagnostics()
    expect(diag.backend).toBe('idb')
    expect(diag.probe?.backend).toBe('idb')
    expect(diag.probe?.attempted.some((a) => a.backend === 'idb' && a.ok)).toBe(true)
    await store.close()
  })

  it('put/read/has survive closing and recreating the store', async () => {
    const factory = new IDBFactory()
    const first = await createBlobStore('reload-test', { indexedDB: factory })
    const checksum = await first.put(DATA_A)
    await first.close()

    const second = await createBlobStore('reload-test', { indexedDB: factory })
    expect(await second.has(checksum)).toBe(true)
    expect(await second.read(checksum)).toEqual(DATA_A)
    await second.close()
  })

  it('lifecycle survives reload: reconcile + gc across store instances', async () => {
    const factory = new IDBFactory()
    const first = await createBlobStore('reload-gc-test', { indexedDB: factory })
    const kept = await first.put(DATA_A)
    const orphan = await first.put(DATA_B) // interrupted write: no manifest ever commits
    await first.close()

    const second = await createBlobStore('reload-gc-test', { indexedDB: factory })
    const result = await second.reconcile([kept])
    expect(result.unreferenced).toEqual([orphan])
    const gc = await second.gc({ minAgeMs: 0 })
    expect(gc.collected).toBe(1)
    expect(await second.has(kept)).toBe(true)
    expect(await second.has(orphan)).toBe(false)
    await second.close()
  })

  it('namespaces are per-archive', async () => {
    const factory = new IDBFactory()
    const a = await createBlobStore('archive-a', { indexedDB: factory })
    const b = await createBlobStore('archive-b', { indexedDB: factory })
    const checksum = await a.put(DATA_A)
    expect(await b.has(checksum)).toBe(false)
    await a.close()
    await b.close()
  })
})

describe('legacy blob layout migration', () => {
  /** Seed the pre-bytecask IndexedDB layout: db `fortemi-<archive>-blobs`, store `blobs`. */
  async function seedLegacyIdb(
    factory: IDBFactory,
    archiveName: string,
    entries: Array<[string, Uint8Array]>,
  ): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(`fortemi-${archiveName}-blobs`, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('blobs')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite')
      for (const [key, bytes] of entries) tx.objectStore('blobs').put(bytes, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }

  async function legacyDbExists(factory: IDBFactory, archiveName: string): Promise<boolean> {
    const dbs = await factory.databases()
    return dbs.some((d) => d.name === `fortemi-${archiveName}-blobs`)
  }

  it('migrates blake3-keyed legacy bytes and deletes the legacy database', async () => {
    const factory = new IDBFactory()
    await seedLegacyIdb(factory, 'legacy-a', [[computeBlobHash(DATA_A), DATA_A]])

    const store = await createBlobStore('legacy-a', { indexedDB: factory })
    expect(await store.read(computeBlobHash(DATA_A))).toEqual(DATA_A)
    expect(await legacyDbExists(factory, 'legacy-a')).toBe(false)
    await store.close()
  })

  it('converges legacy sha256-keyed entries to canonical BLAKE3 keys', async () => {
    const factory = new IDBFactory()
    // Historical layout keyed by sha256:<hex> — re-put converges it (ADR-012 D3).
    await seedLegacyIdb(factory, 'legacy-b', [['sha256:' + '0'.repeat(64), DATA_B]])

    const store = await createBlobStore('legacy-b', { indexedDB: factory })
    expect(await store.read(computeBlobHash(DATA_B))).toEqual(DATA_B)
    await store.close()
  })

  it('is a no-op when no legacy database exists', async () => {
    const factory = new IDBFactory()
    const store = await createBlobStore('legacy-none', { indexedDB: factory })
    expect(await store.has(computeBlobHash(DATA_A))).toBe(false)
    await store.close()
  })
})

describe('createLazyBlobStore', () => {
  it('defers construction until the first byte operation', async () => {
    const factory = new IDBFactory()
    const store = createLazyBlobStore('lazy-test', { indexedDB: factory })
    // Nothing opened yet — closing an untouched lazy store is free.
    await store.close()
    expect((await factory.databases()).length).toBe(0)

    const checksum = await store.put(DATA_A)
    expect(await store.read(checksum)).toEqual(DATA_A)
    expect((await factory.databases()).length).toBeGreaterThan(0)
    await store.close()
  })
})
