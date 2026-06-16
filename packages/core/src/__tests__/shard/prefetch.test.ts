/**
 * Shard warm / prefetch API tests (#181).
 *
 * Covers the in-memory warm store, SHA-256 verify (compute + compare against a
 * build-time-known hash), direct-bytes (bundled asset) path, concurrent
 * de-duplication, HTTP errors, and an end-to-end prefetch → fromPrefetched →
 * importShard round-trip with a real exported shard (no server involved).
 *
 * @implements #181 prefetchShard / shard warm API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { sha256Hex } from '../../shard/checksum.js'
import {
  prefetchShard,
  fromPrefetched,
  isShardPrefetched,
  getPrefetchedSha256,
  clearPrefetchedShard,
} from '../../shard/prefetch.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A small, valid shard byte blob (gzip magic header) for non-import tests. */
const SAMPLE_BYTES = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])

/** Build a Response-returning fetch that counts invocations. */
function countingFetch(bytes: Uint8Array): { fetchImpl: typeof fetch; calls: () => number } {
  let n = 0
  const fetchImpl = (async () => {
    n++
    return new Response(bytes.slice().buffer, { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls: () => n }
}

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

// Reset the module-level warm store between tests.
beforeEach(() => clearPrefetchedShard())
afterEach(() => clearPrefetchedShard())

// ---------------------------------------------------------------------------

describe('prefetchShard', () => {
  it('fetches and warms bytes; fromPrefetched returns them', async () => {
    const { fetchImpl, calls } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/a.shard'

    expect(isShardPrefetched(url)).toBe(false)
    const result = await prefetchShard(url, { fetchImpl })

    expect(calls()).toBe(1)
    expect(result.url).toBe(url)
    expect(result.byteLength).toBe(SAMPLE_BYTES.length)
    expect(result.fromCache).toBe(false)
    expect(result.sha256).toBeUndefined() // not computed unless verify/expectedSha256
    expect(isShardPrefetched(url)).toBe(true)
    expect(Array.from(fromPrefetched(url))).toEqual(Array.from(SAMPLE_BYTES))
  })

  it('computes the SHA-256 when verify is set', async () => {
    const { fetchImpl } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/v.shard'
    const result = await prefetchShard(url, { fetchImpl, verify: true })

    const expected = await sha256Hex(SAMPLE_BYTES)
    expect(result.sha256).toBe(expected)
    expect(getPrefetchedSha256(url)).toBe(expected)
  })

  it('verifies against a build-time-known expectedSha256 (match)', async () => {
    const expected = await sha256Hex(SAMPLE_BYTES)
    const { fetchImpl } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/ok.shard'

    const result = await prefetchShard(url, { fetchImpl, expectedSha256: expected.toUpperCase() })
    expect(result.sha256).toBe(expected) // case-insensitive compare, lowercase stored
    expect(isShardPrefetched(url)).toBe(true)
  })

  it('throws and stores nothing on expectedSha256 mismatch', async () => {
    const { fetchImpl } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/bad.shard'
    const wrong = '0'.repeat(64)

    await expect(prefetchShard(url, { fetchImpl, expectedSha256: wrong })).rejects.toThrow(
      /SHA-256 mismatch/,
    )
    expect(isShardPrefetched(url)).toBe(false)
    expect(() => fromPrefetched(url)).toThrow(/not prefetched/)
  })

  it('warms directly from provided bytes without fetching (bundled asset)', async () => {
    const { fetchImpl, calls } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/bundled.shard'

    const result = await prefetchShard(url, { fetchImpl, bytes: SAMPLE_BYTES, verify: true })
    expect(calls()).toBe(0) // no fetch when bytes are provided
    expect(result.sha256).toBe(await sha256Hex(SAMPLE_BYTES))
    expect(Array.from(fromPrefetched(url))).toEqual(Array.from(SAMPLE_BYTES))
  })

  it('de-duplicates concurrent prefetches of the same url to a single fetch', async () => {
    const { fetchImpl, calls } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/dedupe.shard'

    const [a, b] = await Promise.all([
      prefetchShard(url, { fetchImpl }),
      prefetchShard(url, { fetchImpl }),
    ])
    expect(calls()).toBe(1)
    expect(a.byteLength).toBe(b.byteLength)
    // A fresh prefetch after settle fetches again (in-flight map cleared).
    await prefetchShard(url, { fetchImpl })
    expect(calls()).toBe(2)
  })

  it('throws on an HTTP error response', async () => {
    const url = '/shards/missing.shard'
    const fetchImpl = (async () =>
      new Response(null, { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch
    await expect(prefetchShard(url, { fetchImpl })).rejects.toThrow(/HTTP 404/)
    expect(isShardPrefetched(url)).toBe(false)
  })

  it('useCacheStorage is a no-op (does not throw) when Cache Storage is unavailable', async () => {
    const { fetchImpl } = countingFetch(SAMPLE_BYTES)
    const url = '/shards/nocache.shard'
    // No `caches` global in Node — must still succeed via fetch.
    const result = await prefetchShard(url, { fetchImpl, useCacheStorage: true })
    expect(result.fromCache).toBe(false)
    expect(isShardPrefetched(url)).toBe(true)
  })
})

describe('fromPrefetched / clearPrefetchedShard', () => {
  it('fromPrefetched throws when the url was not prefetched', () => {
    expect(() => fromPrefetched('/never.shard')).toThrow(/not prefetched/)
  })

  it('clearPrefetchedShard(url) evicts one; clearPrefetchedShard() clears all', async () => {
    const { fetchImpl } = countingFetch(SAMPLE_BYTES)
    await prefetchShard('/s1.shard', { fetchImpl })
    await prefetchShard('/s2.shard', { fetchImpl })
    expect(isShardPrefetched('/s1.shard')).toBe(true)
    expect(isShardPrefetched('/s2.shard')).toBe(true)

    clearPrefetchedShard('/s1.shard')
    expect(isShardPrefetched('/s1.shard')).toBe(false)
    expect(isShardPrefetched('/s2.shard')).toBe(true)

    clearPrefetchedShard()
    expect(isShardPrefetched('/s2.shard')).toBe(false)
  })
})

describe('prefetch → fromPrefetched → importShard (end-to-end, no server)', { timeout: 30_000 }, () => {
  it('imports warm bytes byte-identically to a direct import', async () => {
    // Produce a real static shard (this stands in for a build-time-generated asset).
    const sourceDb = await createTestDb()
    const notes = new NotesRepository(sourceDb)
    const collections = new CollectionsRepository(sourceDb)
    const links = new LinksRepository(sourceDb)
    const n1 = await notes.create({ content: 'First note', title: 'Note 1', tags: ['alpha', 'beta'] })
    const n2 = await notes.create({ content: 'Second note', title: 'Note 2', tags: ['beta', 'gamma'] })
    await collections.create({ name: 'Research', description: 'Papers' })
    await links.create(n1.id, n2.id, 'related')
    const archive = await exportShard(sourceDb)
    await sourceDb.close()

    const archiveSha = await sha256Hex(archive)
    const url = '/shards/research.shard'
    const { fetchImpl, calls } = countingFetch(archive)

    // Warm (with build-time hash verification), then import from the warm bytes.
    const warm = await prefetchShard(url, { fetchImpl, expectedSha256: archiveSha })
    expect(warm.sha256).toBe(archiveSha)
    expect(calls()).toBe(1)

    const db = await createTestDb()
    const result = await importShard(db, fromPrefetched(url))
    expect(result.success).toBe(true)
    expect(result.counts.notes).toBe(2)
    expect(result.counts.collections).toBe(1)
    expect(result.counts.links).toBe(1)
    expect(result.errors).toEqual([])
    await db.close()
  })
})
