/**
 * Content-addressed attachment-byte storage — the Fortemi `BlobStore` seam.
 *
 * The store computes the key: `put(bytes)` BLAKE3-hashes the payload and
 * returns the canonical checksum encoding `blake3:<64-char lowercase hex>`
 * (server convention; ADR-012 D1/D3). Every method at this seam speaks that
 * canonical encoding — the bare-hex ⇄ prefixed conversions live in
 * `shard/blob-sidecar.ts` helpers and inside the bytecask adapter here, and
 * nowhere else.
 *
 * Lifecycle authority (ADR-013 D2): canonical attachment manifests decide
 * which bytes are live. `reconcile(liveChecksums)` hands that authoritative
 * set to the store; `gc()` physically removes only unreferenced,
 * age-thresholded objects. Internal refcounts are an implementation detail,
 * never a source of truth.
 *
 * Implementations:
 *   - `createBlobStore()`  — `@bytecask/core` behind a dynamic import
 *     (IndexedDB tier by default, OPFS opt-in, memory fallback). Zero bundle
 *     cost until the first byte operation (ADR-012 D6).
 *   - `createLazyBlobStore()` — synchronous facade that defers the dynamic
 *     import until the first method call (what `FortemiProvider` wires).
 *   - `MemoryBlobStore`    — dependency-free in-process implementation for
 *     tests and the no-persistence tier.
 */

import { computeBlobHash } from './hash.js'
import { blobChecksumToHex } from './shard/blob-sidecar.js'
import type {
  BlobStore as BytecaskFacade,
  ContentHash,
  IndexStore,
  ProbeReport,
  StorageAdapter,
} from '@bytecask/core'
import { migrateLegacyBlobStore } from './blob-store-legacy.js'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type BlobBackendKind = 'idb' | 'opfs' | 'memory'

export interface BlobStoreDiagnostics {
  /** The storage tier actually serving bytes. */
  backend: BlobBackendKind
  /** Tier-probe outcome from `@bytecask/core` (null for memory/test stores). */
  probe: ProbeReport | null
}

export interface BlobReconcileOptions {
  /** Physically remove unreferenced objects now instead of leaving them for gc(). */
  removeUnreferenced?: boolean
}

export interface BlobReconcileResult {
  /** Live checksums whose bytes are present. */
  referenced: number
  /** Live checksums whose bytes are absent — the reference-only set. */
  missing: string[]
  /** Stored checksums not in the live set — GC candidates. */
  unreferenced: string[]
  /** Objects physically removed (only when `removeUnreferenced`). */
  removed: number
  bytesFreed: number
}

export interface BlobGcOptions {
  /** Collect only unreferenced objects at least this old (ms). Default 0. */
  minAgeMs?: number
}

export interface BlobGcResult {
  collected: number
  bytesFreed: number
}

/**
 * The Fortemi attachment-byte seam. All checksums are the canonical
 * `blake3:<hex>` encoding stored in `attachment_blob.content_hash` and shard
 * projection records.
 */
export interface BlobStore {
  /** Store bytes, return their canonical checksum. Idempotent (content-addressed). */
  put(bytes: Uint8Array): Promise<string>
  /** Fetch bytes by canonical checksum; null when absent (reference-only). */
  read(checksum: string): Promise<Uint8Array | null>
  /** True when the bytes for this checksum are physically present. */
  has(checksum: string): Promise<boolean>
  /**
   * Reconcile stored bytes against the authoritative live-checksum set
   * derived from canonical attachment manifests (ADR-013 D4).
   */
  reconcile(
    liveChecksums: Iterable<string>,
    opts?: BlobReconcileOptions,
  ): Promise<BlobReconcileResult>
  /** Physically remove unreferenced, age-thresholded objects. */
  gc(opts?: BlobGcOptions): Promise<BlobGcResult>
  /** Selected backend + probe report, for capability/diagnostic surfaces. */
  diagnostics(): Promise<BlobStoreDiagnostics>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests, no-persistence tier)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  bytes: Uint8Array
  createdAt: number
  refcount: number
}

export class MemoryBlobStore implements BlobStore {
  private entries = new Map<string, MemoryEntry>()
  constructor(private now: () => number = Date.now) {}

  async put(bytes: Uint8Array): Promise<string> {
    const checksum = computeBlobHash(bytes)
    const existing = this.entries.get(checksum)
    if (existing) {
      existing.refcount += 1
    } else {
      this.entries.set(checksum, { bytes, createdAt: this.now(), refcount: 1 })
    }
    return checksum
  }

  async read(checksum: string): Promise<Uint8Array | null> {
    return this.entries.get(checksum)?.bytes ?? null
  }

  async has(checksum: string): Promise<boolean> {
    return this.entries.has(checksum)
  }

  async reconcile(
    liveChecksums: Iterable<string>,
    opts?: BlobReconcileOptions,
  ): Promise<BlobReconcileResult> {
    const live = new Map<string, number>()
    for (const checksum of liveChecksums) {
      live.set(checksum, (live.get(checksum) ?? 0) + 1)
    }

    const missing = [...live.keys()].filter((c) => !this.entries.has(c)).sort()
    const unreferenced: string[] = []
    let referenced = 0
    let removed = 0
    let bytesFreed = 0

    for (const [checksum, entry] of [...this.entries].sort()) {
      const refcount = live.get(checksum) ?? 0
      entry.refcount = refcount
      if (refcount > 0) {
        referenced += 1
        continue
      }
      unreferenced.push(checksum)
      if (opts?.removeUnreferenced) {
        this.entries.delete(checksum)
        removed += 1
        bytesFreed += entry.bytes.byteLength
      }
    }

    return { referenced, missing, unreferenced, removed, bytesFreed }
  }

  async gc(opts?: BlobGcOptions): Promise<BlobGcResult> {
    const minAgeMs = opts?.minAgeMs ?? 0
    const cutoff = this.now() - minAgeMs
    let collected = 0
    let bytesFreed = 0
    for (const [checksum, entry] of this.entries) {
      if (entry.refcount === 0 && entry.createdAt <= cutoff) {
        this.entries.delete(checksum)
        collected += 1
        bytesFreed += entry.bytes.byteLength
      }
    }
    return { collected, bytesFreed }
  }

  async diagnostics(): Promise<BlobStoreDiagnostics> {
    return { backend: 'memory', probe: null }
  }

  async close(): Promise<void> {
    // In-memory store holds no external resources.
  }
}

// ---------------------------------------------------------------------------
// Bytecask adapter
// ---------------------------------------------------------------------------

const CHECKSUM_PREFIX = 'blake3:'

function toChecksum(hex: string): string {
  return CHECKSUM_PREFIX + hex
}

/**
 * Fortemi adapter over the bytecask facade.
 *
 * `reconcile()` is implemented host-side against the adapter + index seams:
 * the published `@bytecask/core` 2026.7.1 facade predates the upstream
 * `reconcile()` (lands in 2026.7.2). The algorithm mirrors upstream exactly —
 * rebuild index refcounts from the authoritative live set, report
 * missing/unreferenced, optionally sweep — so switching to the native call is
 * a mechanical follow-up with identical byte data on disk.
 *
 * Durability note (interim, until the 2026.7.2 factory switch): bytes are
 * durable in the IdbAdapter; lifecycle *metadata* (refcounts, createdAt) is
 * in-session and rebuilt by `reconcile()` from canonical manifests + physical
 * bytes at open — the ADR-013 D4 startup flow. Across a reload, orphan ages
 * reset to the reconcile time, so age-thresholded `gc()` errs conservative
 * (never sweeps sooner than intended).
 */
class BytecaskBlobStore implements BlobStore {
  constructor(
    private facade: BytecaskFacade,
    private adapter: StorageAdapter,
    private index: IndexStore,
    private probe: ProbeReport | null,
    private now: () => number = Date.now,
  ) {}

  async put(bytes: Uint8Array): Promise<string> {
    return toChecksum(await this.facade.put(bytes))
  }

  async read(checksum: string): Promise<Uint8Array | null> {
    return this.facade.get(blobChecksumToHex(checksum))
  }

  async has(checksum: string): Promise<boolean> {
    // Adapter-direct: the 2026.7.1 facade's has() consults the in-session
    // index, which is empty right after a reload; physical presence is what
    // the seam promises.
    return this.adapter.exists(blobChecksumToHex(checksum))
  }

  async reconcile(
    liveChecksums: Iterable<string>,
    opts?: BlobReconcileOptions,
  ): Promise<BlobReconcileResult> {
    const live = new Set<ContentHash>()
    for (const checksum of liveChecksums) live.add(blobChecksumToHex(checksum))

    const physical = new Set<ContentHash>()
    for await (const hash of this.adapter.list()) physical.add(hash)

    // Spread handles both the 2026.7.1 sync iterator and the future async array.
    const entryList = [...(await this.index.values())]
    const entries = new Map(entryList.map((e) => [e.hash, e] as const))
    // Stale metadata whose physical bytes vanished (eviction, interrupted write).
    for (const hash of [...entries.keys()]) {
      if (!physical.has(hash)) {
        await this.index.delete(hash)
        entries.delete(hash)
      }
    }

    const missing = [...live].filter((hash) => !physical.has(hash)).sort().map(toChecksum)
    const unreferenced: string[] = []
    let referenced = 0
    let removed = 0
    let bytesFreed = 0

    for (const hash of [...physical].sort()) {
      const existing = entries.get(hash)
      const size =
        existing?.size ?? (await this.adapter.read(hash))?.byteLength ?? 0
      if (live.has(hash)) {
        await this.index.set({
          hash,
          size,
          createdAt: existing?.createdAt ?? this.now(),
          refcount: 1,
        })
        referenced += 1
        continue
      }
      unreferenced.push(toChecksum(hash))
      if (opts?.removeUnreferenced) {
        await this.adapter.remove(hash)
        await this.index.delete(hash)
        removed += 1
        bytesFreed += size
      } else {
        await this.index.set({
          hash,
          size,
          createdAt: existing?.createdAt ?? this.now(),
          refcount: 0,
        })
      }
    }

    return { referenced, missing, unreferenced, removed, bytesFreed }
  }

  async gc(opts?: BlobGcOptions): Promise<BlobGcResult> {
    const result = await this.facade.gc({ minAgeMs: opts?.minAgeMs })
    return { collected: result.collected, bytesFreed: result.bytesFreed }
  }

  async diagnostics(): Promise<BlobStoreDiagnostics> {
    return { backend: this.adapter.kind, probe: this.probe }
  }

  async close(): Promise<void> {
    await this.facade.close()
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface CreateBlobStoreOptions {
  /** Force a tier; omit to probe IndexedDB → OPFS → memory (measured default). */
  backend?: BlobBackendKind
  /** Injectable IDBFactory for tests (fake-indexeddb). Defaults to the global. */
  indexedDB?: IDBFactory
  /** Skip the one-shot migration of the pre-bytecask blob layout. */
  migrateLegacy?: boolean
}

/**
 * Construct the bytecask-backed BlobStore for one archive namespace.
 *
 * `@bytecask/core` is reached only through a dynamic `import()` here, so
 * hosts that never touch attachment bytes never load it. The namespace is a
 * function of `archiveName` alone — identical in DB-free and PGlite modes.
 *
 * Tiering: IndexedDB by default (measured default per bytecask's C3
 * benchmark), memory fallback when IndexedDB is unavailable. The OPFS opt-in
 * tier arrives with the upstream `createBlobStore()` factory switch
 * (`@bytecask/core` 2026.7.2); requesting it now fails loudly rather than
 * silently falling back.
 */
export async function createBlobStore(
  archiveName: string,
  options?: CreateBlobStoreOptions,
): Promise<BlobStore> {
  const bytecask = await import('@bytecask/core')

  if (options?.backend === 'opfs') {
    throw new Error(
      'BlobStore: the OPFS tier requires @bytecask/core >= 2026.7.2 (worker-backed adapter); ' +
        'use the default IndexedDB tier until the upstream factory switch lands.',
    )
  }

  const idbFactory = options?.indexedDB ?? globalThis.indexedDB
  const attempted: ProbeReport['attempted'] = []
  let adapter: StorageAdapter

  const wantsIdb = options?.backend !== 'memory'
  if (wantsIdb && idbFactory) {
    adapter = new bytecask.IdbAdapter({
      databaseName: `fortemi-${archiveName}-bytecask`,
      factory: idbFactory,
    })
    attempted.push({ backend: 'idb', ok: true })
  } else {
    if (wantsIdb) {
      attempted.push({ backend: 'idb', ok: false, reason: 'indexedDB unavailable' })
      if (options?.backend === 'idb') {
        throw new Error('BlobStore: IndexedDB tier requested but indexedDB is unavailable')
      }
    }
    adapter = new bytecask.MemoryAdapter()
    attempted.push({ backend: 'memory', ok: true })
  }

  // Shared between the facade (put/gc bookkeeping) and the host-side
  // reconcile. In-session only until the 2026.7.2 durable index lands.
  const index: IndexStore = new bytecask.MemoryIndexStore()
  const facade = bytecask.createMemoryBlobStore({ adapter, index })
  const probe: ProbeReport = { backend: adapter.kind, attempted }
  const wrapped = new BytecaskBlobStore(facade, adapter, index, probe)

  if (options?.migrateLegacy !== false) {
    // One-shot, non-destructive-on-failure migration of the pre-bytecask
    // OPFS/IDB blob layout. Bytes are re-put (re-hashed to BLAKE3), which also
    // converges any legacy `sha256:`-keyed entries (ADR-012 D3).
    await migrateLegacyBlobStore(archiveName, wrapped, options?.indexedDB)
  }

  return wrapped
}

/**
 * Synchronous facade over {@link createBlobStore}: construction is free, the
 * dynamic import happens on the first byte operation. This is what
 * `FortemiProvider` wires so hosts that never touch attachment bytes never
 * pay for the substrate (ADR-012 D6).
 */
export function createLazyBlobStore(
  archiveName: string,
  options?: CreateBlobStoreOptions,
): BlobStore {
  let inner: Promise<BlobStore> | null = null
  const open = (): Promise<BlobStore> => {
    inner ??= createBlobStore(archiveName, options)
    return inner
  }
  return {
    put: async (bytes) => (await open()).put(bytes),
    read: async (checksum) => (await open()).read(checksum),
    has: async (checksum) => (await open()).has(checksum),
    reconcile: async (live, opts) => (await open()).reconcile(live, opts),
    gc: async (opts) => (await open()).gc(opts),
    diagnostics: async () => (await open()).diagnostics(),
    close: async () => {
      // Never opened → nothing to close (and nothing to pay for).
      if (inner) await (await inner).close()
      inner = null
    },
  }
}
