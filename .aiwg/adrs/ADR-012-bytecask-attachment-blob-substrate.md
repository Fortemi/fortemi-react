# ADR-012: Adopt bytecask as the browser attachment-blob substrate

- **Status**: Proposed
- **Date**: 2026-07-12
- **Issue**: #282 (design child of epic #281)
- **Relates**: ADR-009 (pluggable storage backend), ADR-011 §4 (binary/attachment contract convergence), server `Fortemi/fortemi#1013` (projection contract, closed) and `Fortemi/fortemi#1046` (shard byte-sidecar proposal), `roctinam/bytecask` ADRs 0001–0004, #271 (byte round-trip residual), #280 (storage spike)

## Context

The server stores attachment bytes in a content-addressed table: `attachment_blob` keyed by a BLAKE3 `content_hash` (UNIQUE), refcounted (`reference_count` maintained by trigger), garbage-collected when orphaned, with inline `BYTEA` under 10 MB and object storage above (`migrations/20260203000000_attachment_doctype_integration.sql`). The canonical hash encoding is `blake3:{64-char lowercase hex}` (`crates/matric-db/src/file_storage.rs`).

The browser edition has only a thin `BlobStore` (`packages/core/src/blob-store.ts`: `write(hash, data)` / `read` / `remove` / `exists`) where the **caller** supplies the key, and that key comes from `computeHash()` (`packages/core/src/hash.ts`) which emits **`sha256:<hex>`** — its doc comment claims this "matches the server-side convention," which is false. There is no dedup, no refcounting, no GC, no quota handling, and no byte transport in shards: after a shard import, `AttachmentsRepository.getBlob()` returns `null` (#271).

The #280 spike evaluated reusing `@scribr/core` storage versus a purpose-built store and concluded purpose-built. That store now exists: **`roctinam/bytecask` v2026.7.1** (C1–C7 complete) provides BLAKE3 content addressing, dedup + refcount + deferred GC + quota + integrity verification, an adapter seam (IndexedDB / OPFS-worker / memory), and a portable `blobs/<hash>` carrier (`packBlobs`/`unpackBlobs`) shaped exactly for the shard sidecar proposed in `Fortemi/fortemi#1046`. Its C3 benchmark **amended the original "OPFS-first" assumption**: IndexedDB is the measured default for the blob-sized workload; OPFS remains an opt-in tier where held-handle streaming wins (bytecask ADR-0001 amendment, ADR-0003 worker boundary).

## Decision

**1. Adopt `@bytecask/core` behind the `BlobStore` seam.** `@fortemi/core` keeps a narrow, content-addressed interface and wires bytecask behind it (the ADR-009 pattern: seam in core, heavy implementation pluggable). The seam changes from caller-supplied-key (`write(hash, bytes)`) to store-computed-key (`put(bytes) → content_hash`); `AttachmentsRepository.getBlob()` resolves bytes through it by `attachment_blob.content_hash`.

**2. Tiering: IndexedDB-first, OPFS opt-in, memory fallback.** This supersedes the "OPFS-first" phrasing in #282's title, per bytecask's C3 benchmark ratification. Construction goes through `createBlobStore()` (probe IndexedDB → OPFS → memory, with `onProbe` reporting); `requestPersistence()` is called on first ingest; large ingests are gated on `estimate()` headroom; `QuotaExceededError` is handled atomically. The store is treated as a **rebuildable cache**, never the only copy — Safari's 7-day eviction of non-persisted storage is the accepted residual risk.

**3. Canonical hash: BLAKE3, with a non-destructive dual-read migration.** New writes are keyed by BLAKE3 with record encoding `blake3:<64-hex>` (matching the server) and sidecar entry names in bare hex (matching bytecask `packedBlobName` and the #1046 proposal). Existing browser archives keyed `sha256:<hex>` remain readable via dual-key lookup with lazy re-hash on access; no destructive rewrite of legacy stores. `computeHash()`'s false parity comment is removed with the migration. (Convergence policy for legacy archives — recommend read-only dual-key + lazy re-hash — is open question P3 for the operator.)

**4. Refcount/GC lifecycle is driven by the `attachment` soft-delete lifecycle.** Attach → `ref(content_hash)`; soft-delete → `unref(content_hash)`; physical removal only via deferred, age-thresholded `gc()`. The PGlite `attachment_blob.reference_count` column mirrors the server's trigger semantics so DB-table parity holds. Bytecask's refcount and the SQL column are kept consistent at the repository layer (single-writer worker serializes both).

**5. Shard byte round-trip (#271) stays server-gated.** Bytecask `packBlobs`/`unpackBlobs` is the ready carrier, but per ADR-011 §4 there will be **no react-only byte layer**: export/import of the `blobs/<hash>` sidecar ships only after the contract is ratified server-side (`Fortemi/fortemi#1046`).

**6. Optional and lazy, like every heavy capability.** `@bytecask/core` (and its OPFS worker package) load behind dynamic import on first byte operation — the PGlite/#261 pattern. Zero bundle cost for hosts that never touch attachment bytes.

## Consequences

**Positive:** attachment bytes gain dedup, refcounting, GC, quota handling, and integrity verification matching the server model; the confirmed `sha256:` parity drift is fixed rather than papered over; #271 becomes implementable the moment #1046 ratifies; the substrate is reusable by any browser app.

**Negative / cost:** a new external dependency (`@bytecask/core`, same maintainer); a hash-migration window where stores hold mixed `sha256:`/BLAKE3 keys; the seam change (`write(hash,…)` → `put(bytes)`) touches `AttachmentsRepository` and the standalone app's blob wiring; PGlite schema-parity migration work (see the companion design doc).

**Risk if deferred:** the browser edition keeps silently dropping attachment bytes on every shard exchange, and the sha256 drift compounds — every archive written today deepens the eventual migration.

## Alternatives considered

- **Reuse `@scribr/core` storage** — rejected by the #280 spike: lightning-fs's whole-file-per-inode model plus a global mutex is a poor fit at ~1 GB scale; scribr's git-object store is real but the wrong substrate.
- **Keep SHA-256 and translate at the boundary** — rejected: cross-edition dedup and `checksum` matching require the same digest; a translation layer would mean hashing every blob twice forever and could never satisfy the #1046 sidecar resolution rule.
- **Build the byte layer directly in `@fortemi/core`** — rejected: the substrate is generic (content addressing, tiered adapters, worker IO) and independently useful; keeping it a sibling package keeps `@fortemi/core` headless and the dependency optional.
