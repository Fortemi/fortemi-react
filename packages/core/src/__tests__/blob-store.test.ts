import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryBlobStore } from '../blob-store.js'
import type { BlobStore } from '../blob-store.js'

// MemoryBlobStore is the in-process stand-in for both OpfsBlobStore and
// IdbBlobStore — it exercises the full BlobStore contract without browser APIs.

const HASH_A = 'aabbccdd1122334455667788990011223344556677889900aabbccdd11223344'
const HASH_B = '0011223344556677889900aabbccdd11223344556677889900aabbccdd001122'
const DATA_A = new Uint8Array([1, 2, 3, 4, 5])
const DATA_B = new Uint8Array([10, 20, 30])

function makeSuite(label: string, factory: () => BlobStore) {
  describe(label, () => {
    let store: BlobStore

    beforeEach(() => {
      store = factory()
    })

    // --- exists ---

    it('exists returns false for unknown hash', async () => {
      expect(await store.exists(HASH_A)).toBe(false)
    })

    it('exists returns true after write', async () => {
      await store.write(HASH_A, DATA_A)
      expect(await store.exists(HASH_A)).toBe(true)
    })

    it('exists returns false after remove', async () => {
      await store.write(HASH_A, DATA_A)
      await store.remove(HASH_A)
      expect(await store.exists(HASH_A)).toBe(false)
    })

    // --- read ---

    it('read returns null for unknown hash', async () => {
      expect(await store.read(HASH_A)).toBeNull()
    })

    it('read returns the same data that was written', async () => {
      await store.write(HASH_A, DATA_A)
      const result = await store.read(HASH_A)
      expect(result).toEqual(DATA_A)
    })

    it('read returns null after remove', async () => {
      await store.write(HASH_A, DATA_A)
      await store.remove(HASH_A)
      expect(await store.read(HASH_A)).toBeNull()
    })

    // --- write idempotency ---

    it('write is idempotent — writing same hash twice does not error', async () => {
      await expect(store.write(HASH_A, DATA_A)).resolves.toBeUndefined()
      await expect(store.write(HASH_A, DATA_A)).resolves.toBeUndefined()
    })

    it('write is idempotent — exists is still true after second write', async () => {
      await store.write(HASH_A, DATA_A)
      await store.write(HASH_A, DATA_A)
      expect(await store.exists(HASH_A)).toBe(true)
    })

    it('write is idempotent — data is intact after second write', async () => {
      await store.write(HASH_A, DATA_A)
      await store.write(HASH_A, DATA_A)
      expect(await store.read(HASH_A)).toEqual(DATA_A)
    })

    // --- remove ---

    it('remove on non-existent hash does not throw', async () => {
      await expect(store.remove(HASH_A)).resolves.toBeUndefined()
    })

    // --- multiple blobs ---

    it('two blobs with different hashes are stored independently', async () => {
      await store.write(HASH_A, DATA_A)
      await store.write(HASH_B, DATA_B)
      expect(await store.read(HASH_A)).toEqual(DATA_A)
      expect(await store.read(HASH_B)).toEqual(DATA_B)
    })

    it('removing one blob does not affect another', async () => {
      await store.write(HASH_A, DATA_A)
      await store.write(HASH_B, DATA_B)
      await store.remove(HASH_A)
      expect(await store.exists(HASH_A)).toBe(false)
      expect(await store.exists(HASH_B)).toBe(true)
      expect(await store.read(HASH_B)).toEqual(DATA_B)
    })

    // --- empty payload ---

    it('stores and retrieves an empty Uint8Array', async () => {
      const empty = new Uint8Array(0)
      await store.write(HASH_A, empty)
      const result = await store.read(HASH_A)
      expect(result).toEqual(empty)
    })

    // --- large payload ---

    it('stores and retrieves a 1 MiB payload', { timeout: 30_000 }, async () => {
      const big = new Uint8Array(1024 * 1024).fill(0xab)
      await store.write(HASH_A, big)
      const result = await store.read(HASH_A)
      expect(result).toEqual(big)
    })
  })
}

// Run the full contract suite against MemoryBlobStore
makeSuite('MemoryBlobStore (contract)', () => new MemoryBlobStore())
