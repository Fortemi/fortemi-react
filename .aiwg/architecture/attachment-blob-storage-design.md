# Attachment blob storage — BlobStore seam & PGlite schema-parity design

- **Status**: Design (companion to ADR-012) — **§2.1 refcount framing amended by ADR-013**: `reference_count` and its trigger are derived, rebuildable projection state, never lifecycle authority (#322)
- **Date**: 2026-07-12
- **Issue**: #282 (design child of epic #281)
- **Relates**: ADR-012 (substrate decision), ADR-011 (shard conformance), server `Fortemi/fortemi#1046` (byte-sidecar proposal), `roctinam/bytecask#8` (integration epic), #271 (byte round-trip)

This document covers the three deliverables ADR-012 defers to design: the content-addressed `BlobStore` seam, the PGlite schema-parity migration plan, and the bundle-cost plan. Server DDL references are to `Fortemi/fortemi` migration `20260203000000_attachment_doctype_integration.sql` at v2026.7.0.

## 1. BlobStore seam (content-addressed)

### 1.1 Current vs target

Current (`packages/core/src/blob-store.ts`) — caller-supplied key, no lifecycle:

```ts
interface BlobStore {
  write(hash: string, data: Uint8Array): Promise<void>
  read(hash: string): Promise<Uint8Array | null>
  remove(hash: string): Promise<void>
  exists(hash: string): Promise<boolean>
}
```

Target — the bytecask facade, adopted as `@fortemi/core`'s seam (store computes the key; lifecycle is first-class):

```ts
interface BlobStore {
  put(bytes: Uint8Array | Blob, opts?: PutOptions): Promise<ContentHash> // BLAKE3, dedup
  get(hash: ContentHash): Promise<Uint8Array | null>
  getBlob(hash: ContentHash, type?: string): Promise<Blob | null>
  has(hash: ContentHash): Promise<boolean>
  delete(hash: ContentHash): Promise<void>      // unref-by-one; physical removal in gc()
  ref(hash: ContentHash): Promise<number>
  unref(hash: ContentHash): Promise<number>
  estimate(): Promise<StorageEstimate>
  requestPersistence(): Promise<boolean>
  gc(opts?: GcOptions): Promise<GcResult>
  readonly backend: BackendKind                  // 'idb' | 'opfs' | 'memory'
  close(): Promise<void>
}
```

`ContentHash` is the **bare 64-char lowercase hex** BLAKE3 digest (bytecask convention). The **record/DB encoding** is `blake3:<hex>` (server convention). Two 3-line helpers own the boundary and are the only place prefixes are handled:

```ts
formatContentHash(hash: ContentHash): string   // → `blake3:${hash}`   (DB/record form)
parseContentHash(checksum: string): { algo: 'blake3' | 'sha256'; hex: string }
sidecarEntryName(hash: ContentHash): string    // → `blobs/${hash}`    (bytecask packedBlobName)
```

### 1.2 Adapter contract in `@fortemi/core`

- `createBlobStore()` (core factory) delegates to bytecask's `createBlobStore({ onProbe })` — probe order IndexedDB → OPFS → memory (ADR-012 D2). The existing `MemoryBlobStore` remains for tests, reimplemented over `createMemoryBlobStore()`.
- `AttachmentsRepository`:
  - `attach()`: `const hex = await blobStore.put(bytes)` → upsert `attachment_blob` on `content_hash = formatContentHash(hex)` (dedup at both layers) → `ref(hex)` → insert `attachment` row.
  - `getBlob()`: read `attachment_blob.content_hash` → `parseContentHash` → `blobStore.get(hex)`; on `sha256:` legacy keys, dual-read (D3): try the sha256 key in the legacy store, lazily re-hash to BLAKE3 on hit.
  - soft-delete: `unref(hex)`; never `gc()` inline — GC runs deferred/age-thresholded (repository exposes `gcBlobs()` for hosts).
- First ingest calls `requestPersistence()`; ingests larger than `estimate()` headroom fail fast with a typed quota error before any partial write.

### 1.3 Legacy-hash convergence (open question P3, recommended policy)

Read-only dual-key: legacy `sha256:`-keyed entries stay where they are and remain readable; any successful legacy read re-`put()`s the bytes (BLAKE3 key), updates `attachment_blob.content_hash`, and unrefs the legacy entry. No bulk rewrite, no destructive pass. Operator sign-off pending.

## 2. PGlite schema-parity migration plan (`0017_attachment_blob_parity`)

Additive-only (browser migrations are append-only; ADR-011 db-table-parity gates shape drift). Current browser schema: `0003_attachments` + `0010_attachment_text_metadata`.

### 2.1 `attachment_blob` — parity matrix

| Server column | Browser today | 0017 action |
|---|---|---|
| `id UUID PK gen_uuid_v7()` | `id TEXT PK` (UUIDv7 string) | keep (established browser convention) |
| `content_hash TEXT UNIQUE` | present | keep; values move to `blake3:<hex>` (D3) |
| `content_type TEXT NOT NULL` | **missing** (browser put `mime_type` on `attachment` in 0010) | **add** `content_type TEXT NOT NULL DEFAULT 'application/octet-stream'`; backfill from `attachment.mime_type`; `attachment.mime_type` becomes a deprecated read-alias |
| `size_bytes BIGINT` | `size_bytes INTEGER` | keep (PGlite INTEGER suffices in-browser; parity fixture allowlists the width) |
| `storage_type TEXT DEFAULT 'database'` | **missing** (`storage_path` instead) | **add** `storage_type TEXT NOT NULL DEFAULT 'bytecask'`; browser vocabulary `'bytecask' \| 'memory'` documented against server `'database' \| 'object_storage'`; deprecate `storage_path` (never expose — contract redaction rule) |
| `data BYTEA` / `object_key` / `object_bucket` | absent | **intentionally omitted** — bytes never live in PGlite in the browser; documented divergence in the parity fixture |
| `reference_count INTEGER DEFAULT 0` | **missing** | **add**, plus partial index `WHERE reference_count = 0` (orphan scan) and an insert/delete trigger on `attachment` mirroring the server trigger semantics |
| `created_at TIMESTAMPTZ` | present | keep |

### 2.2 `attachment` — parity additions

Add (nullable, additive): `original_filename TEXT`, `status TEXT NOT NULL DEFAULT 'uploaded'` (server enum `uploaded|queued|processing|completed|failed|quarantined` as a CHECK constraint), `processing_error TEXT`, `extraction_strategy TEXT`, `extraction_config JSONB DEFAULT '{}'`, `extracted_metadata JSONB`, `ai_description TEXT`, `has_preview BOOLEAN DEFAULT FALSE`, `preview_blob_id TEXT REFERENCES attachment_blob(id)`. Browser `position` stays (server `display_order` maps to it in the shard field-mapper, same pattern as `starred`/`is_starred`). `extracted_text` already landed in 0010.

### 2.3 `attachment_embedding` — new table

Mirror the server DDL: `id TEXT PK`, `attachment_id TEXT NOT NULL REFERENCES attachment(id)`, `embedding_set_id TEXT REFERENCES embedding_set(id)`, `chunk_index INTEGER NOT NULL DEFAULT 0`, `text TEXT NOT NULL`, `vector vector(768)`, `clip_vector vector(512)` (nullable; CLIP is out of browser scope initially), `model TEXT NOT NULL`, `embedding_type TEXT NOT NULL DEFAULT 'text'`, `created_at`, `UNIQUE(attachment_id, embedding_set_id, chunk_index)`. Soft-delete follows the parent attachment (no own `deleted_at`, matching server CASCADE semantics implemented as repository-level filtering).

### 2.4 Searchable-text parity

The server's `get_note_searchable_text()` concatenates note body + completed-attachment `extracted_text`. The browser equivalent already exists (`ATTACHMENT_TEXT_JOIN` in search/embedding-sets + `note-text.ts`); 0017 adds the `status = 'completed'` condition to those joins once `status` exists, closing the semantic gap (today the browser includes any non-deleted attachment's text).

### 2.5 Verification

- Extend the db-table-parity fixtures for all three tables with an explicit allowlist of the documented divergences (`data`/`object_key`/`object_bucket` omitted; `position` vs `display_order`; TEXT ids).
- Round-trip test: `put → attach → soft-delete → gc` asserts `reference_count` and bytecask refcount stay equal at every step.

## 3. Bundle-cost plan

| Piece | Cost posture |
|---|---|
| `@bytecask/core` | `dependency` of `@fortemi/core`, but **only reached via dynamic `import()`** inside `createBlobStore()`/first byte op — tree-shaken to zero for hosts that never touch attachment bytes (PGlite/#261 pattern) |
| `@bytecask/worker` (OPFS sync-access-handle) | loaded only when the OPFS tier is explicitly selected or probed in; ships as its own chunk (bytecask ADR-0003/0004 keep it out of the core graph) |
| BLAKE3 | `@noble/hashes` is already a `@fortemi/core` dependency — no new hashing cost |
| `MemoryBlobStore` | stays in the main bundle (tiny, test/fallback tier) |

Standalone app: wire through `apps/standalone/src/capabilities/setup.ts` like the other lazy capabilities; no eager import in `FortemiProvider`.

## 4. Rollout

1. **Phase A (unblocked now):** seam + adapter + dual-read hash helpers behind the factory; migration 0017; db-table-parity fixture updates. (`roctinam/bytecask#8`)
2. **Phase B (unblocked now):** lifecycle wiring — ref/unref on attach/soft-delete, deferred GC, quota/persistence handling; round-trip refcount tests.
3. **Phase C (gated on `Fortemi/fortemi#1046`):** shard sidecar export/import via `packBlobs`/`unpackBlobs` → closes #271. No react-only byte layer before ratification (ADR-012 D5).

## Open questions

- **P3 (operator):** legacy `sha256:` convergence policy — §1.3 recommends read-only dual-key + lazy re-hash; needs sign-off.
- `storage_type` vocabulary: keep browser-specific values (`'bytecask'`) or overload server values? Recommend browser-specific + fixture allowlist (honest about where bytes live).
- Whether `attachment.mime_type` (0010) is formally deprecated once `attachment_blob.content_type` exists, or kept as a denormalized read column for the tool JSON surface (see #291's tool-parity discussion).
