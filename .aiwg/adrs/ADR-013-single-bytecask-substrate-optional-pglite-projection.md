# ADR-013: Single Bytecask byte substrate, canonical RecordStore, PGlite as optional projection

- **Status**: Proposed (accepted on merge of the #322 delivery PR)
- **Date**: 2026-07-15
- **Issue**: #322 (epic; children #319, #320, #323, #324; validation companion #312)
- **Relates**: ADR-012 (bytecask substrate — **amended by this ADR**, see §Amendments), `attachment-blob-storage-design.md` (#282 design — §2.1 refcount framing amended), `adr-backend-seam.md` (#191 — write-tier constraint amended), ADR-009 (pluggable storage), ADR-011 (shard conformance), `roctinam/bytecask#8`
- **References**: `packages/core/src/blob-store.ts`, `packages/core/src/hash.ts`, `packages/core/src/shard/checksum.ts` (SEC7 trust note), `packages/core/src/data-backend.ts`

## Context

ADR-012 adopted `@bytecask/core` behind the `BlobStore` seam, but three assumptions in the accepted record set have proven wrong or incomplete as the design matured:

1. **Dual refcount authority.** ADR-012 D4 keeps bytecask's refcount and a PGlite `attachment_blob.reference_count` column "consistent at the repository layer," and the #282 design doc adds triggers mirroring server semantics. That creates two mutable lifecycle authorities that must never diverge — a synchronization obligation with no recovery story when they do diverge (interrupted writes, quota-evicted stores, projection rebuilds). Bytecask itself defaults to an in-memory metadata index even over a persistent byte adapter, so its refcounts are not durably trustworthy across reloads without host help.
2. **PGlite as a byte-correctness dependency.** The 0017 migration plan treated the PGlite `attachment_blob` row as a load-bearing part of blob lifecycle. That makes a relational engine mandatory for basic offline correctness, which contradicts the static/shard backend direction and the goal of DB-free operation on constrained hosts.
3. **No writable path without PGlite.** `adr-backend-seam.md` explicitly scoped write/merge to "PGlite/remote only." The non-PGlite tiers are read-only, so a host that opts out of the ~13 MB PGlite WASM cannot even create a note.

Separately, shard in-archive checksums provide consistency, not authenticity (`checksum.ts` SEC7): nothing today stops a tampered shard from writing attacker-controlled records and bytes into local stores. The verification order has to be pinned down architecturally before the byte substrate and DB-free import paths land (#324).

This ADR establishes the target topology for all four child issues so they land against one authority model instead of re-litigating it per PR.

## Decision

### D1. One shipped attachment-byte implementation: `@bytecask/core`, IndexedDB tier by default

The initial configuration ships exactly one attachment-byte substrate: `@bytecask/core` (Gitea npm registry, `@noble/hashes` its only runtime dependency — already a `@fortemi/core` dependency). No parallel LightningFS blob path ships. LightningFS remains a *future adapter option* only if a measured requirement (e.g., held-handle streaming at a scale bytecask's OPFS tier cannot serve) justifies it.

Bundle measurements (2026-07-15, local `tsup` ESM dist of `@bytecask/core@2026.7.1`; lightning-fs `npm pack @isomorphic-git/lightning-fs@4.6.0`; gzip -6):

| Artifact | Raw | Gzip | Runtime deps |
|---|---|---|---|
| `@bytecask/core` entry (`index.js` + eager chunk) | 23,027 B | 5,243 B | 1 (`@noble/hashes`, already present) |
| `@bytecask/core` lazy OPFS adapter chunk | 1,803 B | 740 B | — |
| `lightning-fs.min.js` 4.6.0 | 22,057 B | 6,707 B | 4 (`just-once`, `just-debounce-it`, `isomorphic-textencoder`, `@isomorphic-git/idb-keyval`) |

The entry sizes are **comparable** — size is not the deciding factor (the earlier ~15.9 KB figure in #322 predates bytecask 2026.7.x growth; recorded honestly here). The deciding factors are contract shape and dependency surface: bytecask *is* a content-addressed store (BLAKE3 keys, dedup, refcount hints, GC, quota, integrity verify) while LightningFS is a POSIX-fs emulation on which a CAS would still have to be built; and bytecask adds zero new transitive dependencies. The **production Fortemi bundle delta** is a CI obligation of #319: the lazy-boundary check must show 0 B main-bundle growth for hosts that never touch attachment bytes, and record the deferred-chunk size.

### D2. Authority model: canonical attachment manifests are the sole lifecycle truth

**This amends ADR-012 D4 and design-doc §2.1.**

- **Fortemi canonical records** (notes, links, tags, collections, **attachment manifests**) determine blob reachability. A blob hash is *live* iff at least one non-deleted attachment manifest references it.
- **Bytecask refcounts are not a source of truth.** They may be used as an internal optimization hint, but every lifecycle decision (GC, orphan detection, missing-byte reporting) derives from a walk of canonical manifests. Bytecask is operated in host-managed-lifecycle mode: Fortemi supplies the live-hash set; bytecask stores, verifies, and enumerates content-addressed bytes.
- **PGlite `attachment_blob.reference_count`, if retained by 0017, is derived projection state** — rebuildable from canonical records at any time, never consulted for lifecycle decisions, and no trigger/transaction machinery may attempt to keep two "authoritative" refcounts synchronized (#320).

### D3. Layer boundaries: RecordStore (canonical, required) / BlobStore (bytes) / PGlite (optional projection)

```text
Fortemi repositories
  -> canonical RecordStore (required)             — notes, links, tags, collections,
       durable browser primitive (IndexedDB)         attachment manifests, change journal
  -> Bytecask BlobStore (required when bytes on)  — immutable BLAKE3-addressed bytes
  -> PGlite projection (optional, rebuildable)    — SQL, FTS, vectors, large-corpus scale
```

- The **RecordStore** is a writable canonical structured-record contract independent of `DatabaseClient` (#323). It uses a lightweight durable browser primitive for mutable records; it must **not** encode mutable records as bytecask refcounted blobs merely to reuse one library — bytecask's contract is immutable content-addressed bytes.
- The **BlobStore** seam keeps the ADR-012 shape (`put(bytes) → ContentHash`, store-computed BLAKE3 keys; `blake3:<hex>` record encoding; bare hex in `blobs/<hex>` sidecar names).
- The **PGlite projection** consumes canonical mutations through the change journal (or a generation boundary) and can be built, dropped, and rebuilt without touching canonical records or bytes. Enabling, rebuilding, or deleting PGlite never changes canonical bytes. Activation is capability/measurement-driven, not a hard-coded record count.
- **This amends `adr-backend-seam.md`**: write/merge is no longer "PGlite/remote only." The `DataBackend` capability matrix gains a canonical writable tier backed by RecordStore + BlobStore, reporting its supported query capabilities explicitly (basic ID/recent/tag/link/bounded-text without PGlite; FTS/vector/complex joins may require the projection). Unsupported advanced capabilities are reported, not emulated badly.

### D4. Startup reconciliation and mark-and-sweep from canonical manifests

On store open (and on demand after quota events):

1. Walk canonical attachment manifests → build the **live-hash set**.
2. **Mark**: every live hash is checked against the BlobStore (`has`). Missing bytes → the attachment enters **reference-only recoverable state** (metadata intact; bytes re-hydratable from a future shard sidecar or re-upload). This is the same state a no-sidecar shard import produces today, so UI/repository handling is shared.
3. **Sweep**: bytes present in the BlobStore but absent from the live-hash set are GC candidates. Physical removal is deferred and age-thresholded (protects against sweeping bytes whose manifest commit is in flight), executed via `gc()` with the canonical live set — never via bytecask-internal refcounts alone.

### D5. Crash recovery: bytes-first commit ordering

Write ordering for attach is **bytes → manifest**:

1. `put(bytes)` into the BlobStore (idempotent — content addressing makes replays safe).
2. Commit the attachment manifest (and journal entry) in the RecordStore.

Crash between 1 and 2 leaves an unreferenced blob — cleaned by D4's sweep; no dangling manifest. A manifest without bytes therefore only arises from external causes (storage eviction, reference-only import) and is always represented as the recoverable reference-only state, never an error that blocks the record path. The RecordStore itself commits through an append-safe change journal (or equivalent recoverable commit protocol) so a torn record write is detectable and re-playable (#323).

### D6. Signed-shard verification order: verify before any persistence

Shard trust lives in the Fortemi shard layer (#324); bytecask never learns about signing keys or shard identity — it receives only verified content-addressed bytes. The pipeline is fixed as:

```text
untrusted shard bytes
  -> parse bounded envelope (no allocation blowup on hostile input)
  -> verify trusted signature / caller-supplied expected archive digest
  -> validate signed manifest
  -> validate component SHA-256 + blob BLAKE3 hashes
  -> commit canonical records (RecordStore)
  -> hydrate verified bytes (BlobStore)
  -> update optional PGlite projection
```

**No unverified shard bytes may be written to canonical records, the BlobStore, or PGlite.** In-archive checksums remain a consistency check only (SEC7); authenticity comes from the signature or an out-of-band expected digest. Unsigned-shard policy (reject / warn / trusted-local-only) is defined in #324's ADR; the ordering above is invariant regardless of that policy. The flow is identical with and without PGlite.

### D7. Demonstration obligations (child-issue acceptance)

- **DB-free**: attach → read → reload → export → import works with PGlite absent (#323 conformance tests; #319 reload/dedupe tests).
- **Projection rebuild**: dropping and rebuilding PGlite from canonical records yields equivalent query results without rewriting a single byte in the BlobStore (#320, #323).
- **Full-suite stability**: the shard sidecar suite is a release-gate validation companion; its timeout budget must reflect multi-PGlite setup cost (#312, fixed by PR #332).

## Consequences

**Positive**: one lifecycle authority (walk-the-manifests) with a recovery story instead of a synchronization obligation; PGlite becomes genuinely optional — deletable and rebuildable; DB-free hosts get a full write path; the security boundary for shard import is pinned before implementation lands; honest bundle numbers recorded with methodology.

**Negative / cost**: RecordStore is a new durable-storage subsystem with its own migration/versioning story; repositories refactor from `DatabaseClient`-coupled to canonical-first (#323 is the largest child); reconciliation walks cost O(manifests) at startup (mitigated: manifest counts are small relative to bytes, and the walk is also the integrity check we want anyway).

**Risk if deferred**: every artifact written under the dual-authority model deepens the eventual migration; the read-only non-PGlite tier keeps blocking embedded/lightweight hosts; unverified shard import remains an open write path into local stores.

## Amendments to prior records

| Prior record | What changes |
|---|---|
| ADR-012 D4 | Refcount/GC lifecycle authority moves from "bytecask refcount + SQL column kept consistent" to canonical-manifest reachability (D2, D4 here). ADR-012 D1–D3, D5, D6 stand. |
| `attachment-blob-storage-design.md` §2.1 | `reference_count` column + trigger become **derived projection state** (rebuildable, non-authoritative); the round-trip test asserting bytecask refcount == SQL refcount at every step is replaced by projection-rebuild equivalence tests (#320). |
| `adr-backend-seam.md` (Out of scope) | "Write/merge over static files — stays PGlite/remote only" is superseded: the canonical RecordStore tier is writable without PGlite (#323). The seam itself (operation-shaped `DataBackend`, capability negotiation) stands and gains the new tier. |

## Alternatives considered

- **Keep dual refcount authority (status quo ADR-012 D4)** — rejected: two mutable truths with trigger synchronization and no divergence-recovery story; fails the "PGlite can be absent/rebuilt" invariant by construction.
- **Bytecask-managed durable index as lifecycle authority** — rejected for authority (accepted as optimization): even with a durable index, blob liveness is a function of Fortemi manifests; making bytecask authoritative would push Fortemi semantics into the byte layer and recreate the two-truths problem one level down.
- **Ship LightningFS alongside bytecask behind the same seam** — rejected initially: two implementations double the conformance surface for zero present requirement; entry sizes are comparable but LightningFS adds four dependencies and the wrong contract shape (POSIX fs, whole-file inodes, global mutex).
- **Encode canonical records as bytecask blobs ("one library for everything")** — rejected: records are mutable and small; content addressing gives them nothing but churn (every edit re-keys), and GC semantics for record-blobs would conflict with attachment lifecycle.

## References

- @.aiwg/adrs/ADR-012-bytecask-attachment-blob-substrate.md — substrate decision (amended)
- @.aiwg/architecture/attachment-blob-storage-design.md — seam/migration design (§2.1 amended)
- @.aiwg/architecture/adr-backend-seam.md — DataBackend seam (write-tier constraint amended)
- @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md — shard conformance
- @packages/core/src/shard/checksum.ts — SEC7 consistency-vs-authenticity note (#324 context)
- Issues: #322 (this epic), #319, #320, #323, #324, #312; `roctinam/bytecask#8`
