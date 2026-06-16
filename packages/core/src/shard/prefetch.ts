/**
 * Shard warm / prefetch API — pre-stage and (optionally) verify shard bytes
 * without building the index.
 *
 * Staged corpus loading (text-first, then opt-in summary vectors, then opt-in
 * full content) wants the operator's hard rule honored: **no blocking waits**.
 * The HNSW index build has to happen on the user's click (it is heavy and is
 * shown with progress — that is correct). The *download* of the shard bytes
 * does not: it can be warmed in the background on idle so the click is purely
 * the index build.
 *
 * fortemi-react is server-free and local-first — shards are **static assets**
 * (typically generated at build time and served as static files, or bundled
 * and handed in directly as bytes). `prefetchShard` warms those static bytes;
 * it does not assume any API/server. The eventual `importShard` reads the warm
 * bytes via {@link fromPrefetched}, so import is just the index build.
 *
 * Two-layer integrity:
 *  - `prefetchShard(url, { expectedSha256 })` verifies the whole-archive SHA-256
 *    against a build-time-known hash (emitted alongside the static shard).
 *  - `importShard` still validates the per-file checksums inside the manifest
 *    on import. Both layers share core's `sha256Hex`.
 *
 * @implements #181 prefetchShard / shard warm API
 */

import { sha256Hex } from './checksum.js'

/** Options for {@link prefetchShard}. */
export interface PrefetchOptions {
  /**
   * Provide the shard bytes directly instead of fetching `url` — e.g. a
   * build-time-generated `.shard` imported as a bundled asset. The `url` is
   * still used as the warm-store key. When set, no network/disk fetch happens.
   */
  bytes?: ArrayBuffer | Uint8Array
  /**
   * Compute the SHA-256 of the warmed bytes (stored on the result and in the
   * warm store). Implied when `expectedSha256` is set.
   */
  verify?: boolean
  /**
   * Build-time-known SHA-256 (hex) of the whole shard archive. When set, the
   * warmed bytes are verified against it and a mismatch throws — nothing is
   * stored. Case-insensitive.
   */
  expectedSha256?: string
  /**
   * Fetch implementation to use. Defaults to `globalThis.fetch`. Inject for
   * tests or non-standard environments.
   */
  fetchImpl?: typeof fetch
  /**
   * Also persist the warmed bytes to the Cache Storage API so warmth survives
   * a reload. Feature-detected — a no-op when `caches` is unavailable (e.g.
   * Node, or a worker without Cache access).
   */
  useCacheStorage?: boolean
  /** Cache Storage cache name. Default: `'fortemi-shards'`. */
  cacheName?: string
  /** Abort signal forwarded to the fetch. */
  signal?: AbortSignal
}

/** Result of a {@link prefetchShard} call. */
export interface PrefetchResult {
  /** The warm-store key (the `url` passed to prefetchShard). */
  url: string
  /** The warmed shard bytes (also retrievable via {@link fromPrefetched}). */
  bytes: Uint8Array
  /** Convenience: `bytes.byteLength`. */
  byteLength: number
  /** SHA-256 hex of the warmed bytes when computed (`verify` or `expectedSha256`), else `undefined`. */
  sha256?: string
  /** True when the bytes came from the Cache Storage API rather than a fresh fetch. */
  fromCache: boolean
}

interface WarmEntry {
  bytes: Uint8Array
  sha256?: string
}

const DEFAULT_CACHE_NAME = 'fortemi-shards'

/** In-memory warm store: url → bytes. Survives until cleared or page reload. */
const warmStore = new Map<string, WarmEntry>()
/** In-flight prefetches keyed by url, so concurrent warms of the same url share one fetch. */
const inFlight = new Map<string, Promise<PrefetchResult>>()

function toUint8(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function getCacheStorage(): CacheStorage | undefined {
  return (globalThis as { caches?: CacheStorage }).caches
}

async function readFromCacheStorage(url: string, cacheName: string): Promise<Uint8Array | null> {
  const caches = getCacheStorage()
  if (!caches) return null
  try {
    const cache = await caches.open(cacheName)
    const res = await cache.match(url)
    if (!res) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function writeToCacheStorage(url: string, bytes: Uint8Array, cacheName: string): Promise<void> {
  const caches = getCacheStorage()
  if (!caches) return
  try {
    const cache = await caches.open(cacheName)
    // Copy into a standalone ArrayBuffer so the stored body is independent.
    const body = bytes.slice().buffer
    await cache.put(url, new Response(body))
  } catch {
    // Best-effort: a Cache write failure must not fail the prefetch.
  }
}

async function maybeHash(
  bytes: Uint8Array,
  options: PrefetchOptions | undefined,
): Promise<string | undefined> {
  const expected = options?.expectedSha256
  if (expected !== undefined) {
    const actual = await sha256Hex(bytes)
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `Shard SHA-256 mismatch: expected ${expected.toLowerCase()}, got ${actual}`,
      )
    }
    return actual
  }
  if (options?.verify) {
    return sha256Hex(bytes)
  }
  return undefined
}

/**
 * Pre-stage shard bytes into the warm store without building the index.
 *
 * Resolution order for the bytes:
 *  1. `options.bytes` (a directly-provided / bundled asset), else
 *  2. the Cache Storage API (when `useCacheStorage` and a prior write exists), else
 *  3. `fetch(url)` of the static asset.
 *
 * Concurrent calls for the same `url` (without `options.bytes`) share a single
 * fetch. On `expectedSha256` mismatch the call throws and nothing is stored.
 *
 * @param url - Static asset URL (also the warm-store key).
 * @param options - See {@link PrefetchOptions}.
 * @returns The warm result (bytes are also retrievable via {@link fromPrefetched}).
 *
 * @example
 * ```ts
 * // Warm on idle so the user's opt-in click is just the index build.
 * requestIdleCallback(() => {
 *   void prefetchShard('/shards/research.shard', { expectedSha256: RESEARCH_SHARD_SHA256 })
 * })
 * // ...later, on click:
 * await importShard(db, fromPrefetched('/shards/research.shard'), { onProgress })
 * ```
 */
export function prefetchShard(url: string, options?: PrefetchOptions): Promise<PrefetchResult> {
  // Direct-bytes path: no fetch, no in-flight dedupe.
  if (options?.bytes !== undefined) {
    const bytes = toUint8(options.bytes)
    return (async () => {
      const sha256 = await maybeHash(bytes, options)
      warmStore.set(url, { bytes, sha256 })
      if (options.useCacheStorage) {
        await writeToCacheStorage(url, bytes, options.cacheName ?? DEFAULT_CACHE_NAME)
      }
      return { url, bytes, byteLength: bytes.byteLength, sha256, fromCache: false }
    })()
  }

  const existing = inFlight.get(url)
  if (existing) return existing

  const cacheName = options?.cacheName ?? DEFAULT_CACHE_NAME
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch

  const work = (async (): Promise<PrefetchResult> => {
    let bytes: Uint8Array | null = null
    let fromCache = false

    if (options?.useCacheStorage) {
      bytes = await readFromCacheStorage(url, cacheName)
      fromCache = bytes !== null
    }

    if (!bytes) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('prefetchShard: no fetch implementation available (pass options.fetchImpl)')
      }
      const res = await fetchImpl(url, options?.signal ? { signal: options.signal } : undefined)
      if (!res.ok) {
        throw new Error(`Failed to prefetch shard ${url}: HTTP ${res.status} ${res.statusText}`)
      }
      bytes = new Uint8Array(await res.arrayBuffer())
    }

    const sha256 = await maybeHash(bytes, options)
    warmStore.set(url, { bytes, sha256 })

    if (options?.useCacheStorage && !fromCache) {
      await writeToCacheStorage(url, bytes, cacheName)
    }

    return { url, bytes, byteLength: bytes.byteLength, sha256, fromCache }
  })()

  const tracked = work.finally(() => {
    inFlight.delete(url)
  })
  inFlight.set(url, tracked)
  return tracked
}

/**
 * Return previously-warmed shard bytes for `url`, ready to hand to `importShard`.
 *
 * @throws If the url was not prefetched (call {@link prefetchShard} first).
 *
 * @example
 * ```ts
 * await importShard(db, fromPrefetched('/shards/research.shard'), { onProgress })
 * ```
 */
export function fromPrefetched(url: string): Uint8Array {
  const entry = warmStore.get(url)
  if (!entry) {
    throw new Error(`Shard not prefetched: ${url}. Call prefetchShard(url) first.`)
  }
  return entry.bytes
}

/** Whether `url` has warm bytes in the in-memory store. */
export function isShardPrefetched(url: string): boolean {
  return warmStore.has(url)
}

/** The computed SHA-256 (hex) of a warmed shard, if it was verified/hashed. */
export function getPrefetchedSha256(url: string): string | undefined {
  return warmStore.get(url)?.sha256
}

/**
 * Evict warm bytes from the in-memory store. With no argument, clears all.
 *
 * Note: this does not delete Cache Storage entries — those persist by design
 * (that is the cross-reload warmth). Manage the Cache Storage cache directly if
 * you need to evict it.
 */
export function clearPrefetchedShard(url?: string): void {
  if (url === undefined) {
    warmStore.clear()
    return
  }
  warmStore.delete(url)
}
