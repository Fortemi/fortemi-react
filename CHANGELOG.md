# Changelog

All notable changes to fortemi-react are documented here.

## Unreleased

## v2026.8.0 - 2026-08-23

### `@fortemi/core` - source-addressed import, scoped search, and purge receipts (#404, #405, #406)

- Added source-addressed batch upsert for PGlite and RecordStore. Importers can
  key records by tenant, archive, source namespace, and external id; exact
  replays return `unchanged` without duplicating notes, revisions, jobs,
  journal entries, or source import runs, while changed content is explicit
  `version`, `replace`, or `conflict`.
- Search now accepts bounded typed metadata predicates for indexed provider,
  model, role, event kind, sensitivity, and import-run fields. Tenant, archive,
  source, deletion, and metadata filters are applied before text, semantic, or
  hybrid ranking, and result locators carry safe source hashes rather than raw
  external keys.
- Added terminal graph/content purge APIs with preview counts and idempotent,
  content-free deletion receipts. Purge removes relational graph/search state,
  embeddings, source identities, provenance edges, attachments, and note rows
  atomically, while receipt replay converges on the same receipt.
- Knowledge Shard profile export reports source identity mappings as typed
  `source-identity-outside-profile` loss when `core-v1` or `record-v1` cannot
  preserve them. This preserves the AIWG static index, Knowledge Shard transfer,
  and live Fortemi persistence planes as distinct surfaces.

## v2026.7.15 - 2026-07-29

### Supported-platform contract evidence (#399)

- Added the reusable React/Core platform-contract runner and receipt verifier
  consumed by the Fortemi authority-owned suite matrix.
- Fortemi run
  [6393](https://git.integrolabs.net/Fortemi/fortemi/actions/runs/6393) passed
  the declared server-authority -> React/Core -> HotM consumer surface on Linux
  x86_64, Linux arm64, and macOS arm64. The matrix binds commit
  `ccf96fad6025025293e40e250c85f088c8999d86` and
  `@fortemi/core@2026.7.14` to exact packed-artifact digests.
- Windows remains deferred to [Fortemi
  #1096](https://git.integrolabs.net/Fortemi/fortemi/issues/1096). The evidence
  is limited to the declared profile cells, including exact
  `2.0.0/full-v1`; it does not change the parent #1081 `NO-GO` decision or
  establish suite-wide portability, complete backup, or GUI/native-dialog
  coverage.

## v2026.7.14 - 2026-07-26

### `@fortemi/core` - Receipt-backed `2.0.0/full-v1` advertisement (#382)

- Bind the released React and AIWG archives to clean repeated PGlite and
  Fortemi destinations with complete per-cell semantics, skew, corruption,
  signature, limit, and zero-mutation evidence.
- Advertise exact `2.0.0/full-v1` PGlite import/export only when the delivered
  cross-repository receipt matches every authority, archive, implementation,
  and consumer digest. RecordStore remains `record-v1`, and the receipt does
  not enable an unqualified suite claim.

### `core-v1` and `record-v1` executable matrix coverage (#354, #355)

- Added deterministic current producer fixtures and clean-destination receipts
  for PGlite self-import, PGlite-to-Fortemi, Fortemi-to-PGlite, RecordStore
  self-import, and RecordStore-to-Fortemi.
- Each passed cell binds hierarchy, metadata, explicit nulls, tombstones,
  current-minus-two/current/next-major behavior, malformed input, resource
  limits, repeated import, semantic re-export, and zero mutation on rejection.
- Historical receipt fixtures reproduce their pinned producer version even as
  the current package release advances, preventing release metadata from
  rewriting immutable evidence bytes.

### AIWG `core-v1` lifecycle projection (#393)

- Pinned AIWG authority commit
  `dbbfee78993365686f3c8283f93ba8ef7172e7d4` and its exact v2 export schema.
- AIWG source paths now project to deterministic native collection hierarchies.
  Only explicit `state_transfer.deleted_at` projects a note tombstone;
  operational issue/workflow state remains independent metadata.
- Added repeated clean PGlite import and semantic re-export coverage for the
  native hierarchy and lifecycle projection.

### Supply-chain bootstrap (#394, #396)

- Project commit signing and authoritative Gitea pushes now load the
  least-privilege React runtime AppRole from encrypted systemd credentials into
  tmpfs when an explicit development handoff is not configured.
- The project commit and release keys remain separate; release publication
  still requires the dedicated signed-tag gate.

### Claim scope

- This release publishes the current React/PGlite implementations and existing
  receipt-backed cells. It does not by itself complete the two AIWG `core-v1`
  cross-repository matrix cells or authorize unqualified suite portability,
  parity, or complete-backup claims.

## v2026.7.13 - 2026-07-23

### `@fortemi/core` - Schema 2 presence semantics and PGlite `full-v1` (#379, #380)

- Vendored the immutable Fortemi Knowledge Shard schema `2.0.0` authority and
  preserve absent, explicit `null`, empty, and value states through validation,
  PGlite, MemoryRecordStore, IndexedDB, import, export, and re-export.
- PGlite now produces and persists all 33 `full-v1` component families,
  attachment sidecars, signatures, identities, relationships, timestamps,
  tombstones, embeddings, SKOS, provenance, graph, and community data.
- Unsupported presence and non-representable production states fail before
  persistent mutation with typed, machine-readable losses.

### `@fortemi/core/aiwg-index-shard` - Native AIWG `full-v1` conversion (#381)

- The released AIWG v2 conversion boundary now emits deterministic schema
  `2.0.0/full-v1` archives with native typed components and explicit loss
  reports instead of opaque replacements or invented completeness.
- Committed source, archive, authority, PGlite convergence, package-boundary,
  and digest receipts provide the immutable inputs for downstream AIWG and
  Fortemi consumer verification.

### Claim scope

- This release provides the producer and browser-persistence implementation
  boundary. It does not claim unqualified full portability, complete backup,
  or server parity; receipt-backed cross-repository advertisement remains
  gated by React #382 and Fortemi #1084/#1087.

## v2026.7.12 - 2026-07-21

### `@fortemi/core` - Restore the vendorable static AIWG index boundary (#317)

- `@fortemi/core/aiwg-index` is dependency-free again and its minified artifact
  is package-tested for zero imports and a maximum 50 KB raw size.
- AIWG-to-Knowledge-Shard conversion moved to the explicit
  `@fortemi/core/aiwg-index-shard` build-oriented subpath; the top-level Core
  entry continues to export the conversion helpers for full-runtime consumers.

### Release operations

- The pinned Playwright release wrapper now uses polling and raises the
  container file-descriptor limit so Vite can start reliably on hosts with a
  saturated shared inotify pool or restrictive Docker defaults.

## v2026.7.11 - 2026-07-21

### `@fortemi/core` - RecordStore collection hierarchy parity (#355)

- Canonical RecordStore collections now preserve `parent_id` through memory
  and IndexedDB storage, `record-v1` import/export, and PGlite projection.
- Existing IndexedDB collection rows migrate additively to root collections,
  while missing or cyclic projection parents fail before partial projection.

### `@fortemi/core` - Reproducible Knowledge Shard archives (#355)

- Tar entries and the outer gzip header now use canonical zero mtimes, so
  identical shard inputs produce byte-identical archives across wall-clock
  times. This makes archive digests and cross-repository receipts reproducible.

## v2026.7.10 - 2026-07-20

### `@fortemi/core` - PGlite `core-v1` portability corrections (#355)

- Unscored note and URL links now emit the canonical asserted-link score `1`
  while preserving absent PGlite confidence in metadata for lossless re-import.
- Clean imports now order nested collections parent-first and reject missing or
  cyclic parents before mutating PGlite.
- This is a profile-preserving correction to the standard PGlite path. Contract
  revision 19, schema 1.2.0, and the existing `core-v1`/`record-v1` backend
  advertisements are unchanged.

## v2026.7.9 - 2026-07-18

- Added isolated Fortemi React release and commit signing keys under separate
  OpenBao paths. Release tags now pin the project release key; retired public
  authorities remain available for historical verification.

### `@fortemi/core` - Canonical Knowledge Shard package boundary (#354, #355, #362)

- Pinned Fortemi Knowledge Shard contract revision 19 and its exact
  `core-v1`, `record-v1`, and `full-v1` schema bundle. Core validates the
  authority's signed 33-component server fixture, declared files and counts,
  component checksums, signature-envelope shape, and mandatory attachment
  sidecars. Schema 1.2 additionally validates nullable embedding contract
  fingerprints as exact lowercase SHA-256 values while preserving historical
  1.1 archives with absent lineage. This adds validation authority only:
  PGlite still advertises
  `core-v1`, RecordStore still advertises `record-v1`, and neither backend
  advertises `full-v1`.
- The AIWG v2 converter now emits a deterministic, self-validating schema
  `1.2.0` `core-v1` archive directly. It preserves the complete AIWG source
  record in note/link metadata, fills the canonical manifest and count
  inventory, and rejects the former partial rich-component projection instead
  of labeling it portable.
- AIWG relationships without an optional confidence value now receive the
  canonical asserted-link score `1`; the original relationship remains
  losslessly preserved in metadata.
- This release gives the post-`2026.7.8` schema/profile commits a new immutable
  package version. It does not replace or reinterpret the already published
  `2026.7.8` artifacts.

## v2026.7.8 - 2026-07-17

### `@fortemi/core` - Knowledge Shard `record-v1` conformance (#355)

- RecordStore named Knowledge Shard export/import now advertises the supported
  `record-v1` profile pinned to Fortemi contract revision 4. Generated archives
  self-validate and report every lossy or omitted source concept; `full-v1`
  remains reserved.

### `@fortemi/core` - Writable record tier without PGlite (#323, #322)

- New `createRecordBackend` wraps the canonical RecordStore as a writable
  `DataBackend`: instant startup, read+write+merge, the full manage-note
  action surface (update / delete / restore / archive / unarchive / star /
  unstar) through the same Zod-validated input as the PGlite tool, and a
  bounded unranked text scan. Capabilities are reported honestly
  (`semantic: 'none'`; `conceptsOf`/`provenanceOf` absent rather than
  emulated), and the seam selects it as the lightest writable backend.
- New DB-free Knowledge Shard round-trip: `exportShardFromRecords` /
  `importShardToRecords` produce and consume the standard `.shard` format
  with zero PGlite. Byte sidecars hydrate through the Bytecask BlobStore,
  missing bytes stay recoverable reference-only, the ADR-014 signed-manifest
  policy runs verify-before-persist, unsupported components skip with
  explicit warnings, and `error`-strategy conflicts are pre-scanned so a
  conflicting archive writes nothing. Format parity is tested in both
  directions (record-exported shards import into PGlite and vice versa).
- New `projectNotes` / `projectRecords` complete the PGlite projection:
  the note tier (notes, originals, revisions, tags, links, collections,
  memberships) joins the attachment tier from migration 0017. The projection
  is idempotent, reconciles canonically hard-removed rows, and can be
  dropped and rebuilt with row-for-row parity — canonical records and
  Bytecask bytes are never touched. This completes the single-substrate
  storage epic (#322): PGlite is now fully optional and rebuildable.
- `CanonicalNoteUpdateInput` accepts `format` and `visibility`;
  `linkToShard` / `collectionToShard` accept canonical ISO-string records.
- Legacy unprofiled shard replacement now preserves representable nulls,
  tombstones, and timestamps, removes stale source-owned relationships, and
  rolls back record, journal, and newly promoted blob mutations atomically.
  Built-in record stores expose optional `applyBatch` / `atomicBatch`
  capabilities, and built-in blob stores expose optional `delete`; custom
  stores lacking either rollback capability fail before import mutation.
- `NoteRevisedCurrentRecord.content` is now `string | null`. Consumers reading
  current revisions must handle `null` rather than assuming a string.

## v2026.7.7 - 2026-07-16

### `@fortemi/core` - Legacy Knowledge Shard compatibility (#344)

- Shard import now accepts legacy React embedding rows that omit the server
  metadata fields (`chunk_index`, `text`, `model`), normalizing them to schema
  defaults instead of rolling back the transaction.
- `validateShardArchive` accepts exactly what the importer accepts: legacy
  link rows (no `to_url`/`metadata`), legacy `embedding_id`-only set-member
  rows, and legacy embedding-set rows are all valid archive content.
- Server-shaped rows retain their supplied metadata unchanged.

### Examples - Semantic-upgrade validation gates (#345)

- New bundled-shard conformance suite replays the knowledge-workspace demo's
  exact import sequence (notes, summaries, full content) against the
  checked-in corpus artifacts, with schema and checksum verification, as part
  of the portable-contract CI gate.
- New `examples-e2e` CI job builds the deployable gallery and drives the
  featured demo's full semantic-upgrade path in a real browser: text search,
  semantic enablement, summaries shard import, query-model load, and a hybrid
  query with rendered results.

### Dependencies

- `@bytecask/core` now resolves from public npmjs (2026.7.5) instead of the
  internal registry, unblocking installs outside the internal network —
  including the public npm publish workflow.

### Documentation

- Project context docs synced to the merged storage subsystem and the new
  validation gates.

Note: v2026.7.6 was published to the internal registry only; its changes ship
publicly in this release.

## v2026.7.6 - 2026-07-16

### `@fortemi/core` - Lossless AIWG Knowledge Shard transport

- Added `aiwgFortemiIndexToKnowledgeShard` and
  `aiwgFortemiIndexFromKnowledgeShard` on `@fortemi/core/aiwg-index`.
- Uses deterministic UUID identities and native note, tag, and relationship
  projections while retaining the complete AIWG v2 envelope and source records
  in note metadata for exact reconstruction.
- Added optional React-native SKOS and provenance component projections.
- Preserves shard note metadata through browser import/export.
- Verified against the latest AIWG Gitea export: 907 records converted and
  reconstructed exactly.

## v2026.7.4 - 2026-07-12

### `@fortemi/react/graph-3d` — 3D force-directed view (#262)

`ForceGraph3DView`, a third renderer tier backed by `react-force-graph-3d` (Three.js), on the new **`@fortemi/react/graph-3d`** subpath.

- Orbit + scroll-zoom; `zoomToFit` on engine stop; degree-derived node size and per-community tone from the shared `RenderGraph` (#264).
- Click opens the node (via `onOpenNode`/`onSelectNode`); **⌘/ctrl-click re-anchors** (pins `fx/fy/fz` and `d3ReheatSimulation()` so the graph re-settles live). `ResizeObserver` container sizing; a memoised `Scene` with referentially-stable accessors so opening/closing a reader never re-inits the renderer (orbit + zoom preserved).
- `react-force-graph-3d` and `three` are **optional peer dependencies, lazy-loaded** via `React.lazy` → dynamic `import()`; the built subpath has zero static import of them, so Three only ships when the 3D view mounts. Install with `pnpm add react-force-graph-3d three`.

### `@fortemi/react/graph-2d` — interactive Sigma 2D explorer (#263)

A heavier renderer tier alongside the static `GraphView`: `SigmaGraphView`, backed by Sigma + graphology ForceAtlas2, on the new **`@fortemi/react/graph-2d`** subpath.

- Live LinLog ForceAtlas2 settling with a `settling…` state; warm-starts from a baked-position snapshot (fast convergence) or a cold random seed.
- Hover-neighborhood dimming, click-select + animated camera focus, ⌘/ctrl-click **re-anchor** (pin at centre, re-settle around it), double-click to open, click-stage to deselect, auto soft-anchor of the highest-degree hub, and LOD label decluttering.
- `sigma`, `graphology`, `graphology-layout-forceatlas2` are **optional peer dependencies, lazy-loaded** via dynamic `import()` — the subpath's built entry carries no static import of them, so they only ship when a consumer mounts the view. Install with `pnpm add sigma graphology graphology-layout-forceatlas2`.
- Consumes a `@fortemi/graph` `RenderGraph` (#264) — pass one directly or a `CommunityGraph` it maps for you (honoring the #260 filter contract).

### `@fortemi/graph` / `@fortemi/react` — opt-in node dragging (#245)

`GraphView` gains a `draggableNodes` prop (default `false` — existing behavior unchanged). Dragging a node moves it under the pointer; on release the node is **pinned** and the rest of the graph re-settles around it (an incremental re-layout). Pins persist across layout updates; shift-click a pinned node to release its pin.

- **`@fortemi/graph` `layoutCommunityGraph`** gains `pinned` (positions held fixed during settlement) and `initialPositions` (warm-start seed so a re-layout resumes from the current arrangement instead of re-seeding). New `PositionMap` type. Fully deterministic; unpinned output is bit-for-bit identical to before.
- **`@fortemi/react` `GraphView`** wires pointer drag over the pin mechanism; the coordinate inversion is a pure, tested helper (`clientToGraphPoint`). No new dependencies; `@fortemi/graph` stays React-free.

### `@fortemi/graph` — snapshot-first load + render-prep mapping (#264)

Shared warm-start helpers so every renderer tier (JS-only SVG, React `GraphView`, the interactive 2D/3D tiers) maps and loads graphs identically.

- **`mapCommunityGraph(graph, options?)`** — pure `CommunityGraph` → render-ready `RenderGraph` mapping: labels, degree-derived node size, per-community tone, and baked positions when supplied. Palette is `'community'` (default, matches `colorForCommunity`), `'greyscale'` (`GREYSCALE_COMMUNITY_RAMP`, largest cluster = darkest), or a custom array.
- **`loadRenderSnapshot(source, options?)`** — snapshot-first loader: instantly load a precomputed graph with baked x/y from a URL, object, or thunk; returns `null` (never throws) when absent/malformed/position-less so callers fall back to a live build.
- **`bakeRenderGraph(graph, options?)`** + **`stringifyRenderGraph`** — build-time writer: run the layout once and emit a deterministic baked-position snapshot.
- Also exports `communityRanks`, `isRenderGraph`, `hasBakedPositions`. No new dependencies; `@fortemi/graph` stays React-free.

### `@fortemi/core` / `@fortemi/react` — PGlite is now optional (#261)

Non-DB consumers can ship a light, PGlite-free bundle.

- **Lazy engine load (`@fortemi/core`):** `createPGliteInstance` now loads
  `@electric-sql/pglite` (and its `vector` extension) via dynamic `import()`.
  `dist/index.js` no longer carries a static `import '@electric-sql/pglite'`, so
  bundlers keep the PGlite WASM engine out of the graph until an archive is
  actually opened. `@electric-sql/pglite` moved from `dependencies` to
  `optionalDependencies`.
- **PGlite-free graph subpath (`@fortemi/react/graph`):** new subpath export that
  re-exports only `GraphView`. It depends solely on `@fortemi/graph` + React
  (zero `@fortemi/core`/PGlite/DB-worker references), so a presentational
  consumer (e.g. a docs-map / static tenant) can render graphs without dragging
  the database in — and Vite code-split builds no longer fail on the
  `worker.format: 'iife'` / Node-FS chain. Importing `GraphView` from the package
  root still works and still pulls the full provider surface.
- **Tree-shakable barrels:** `@fortemi/core`, `@fortemi/graph`, and
  `@fortemi/react` are marked `"sideEffects": false`.
- **Pluggable persistence (unchanged seam, now documented):** `ArchiveManager`
  already accepts a `StorageBackendFactory`; PGlite is the opt-in default via
  `defaultStorageBackendFactory`. Hosts wanting a different store pass their own
  factory and never touch PGlite.

### `@fortemi/core` — Knowledge Shard blob sidecar + BLAKE3 attachment hashing (#271)

Attachment binaries now round-trip through Knowledge Shards.

- **`exportShard({ includeBlobs: true })`** writes each attachment's bytes as a
  content-addressed `blobs/<hash>` sidecar entry in the tar, keyed by BLAKE3 —
  the same hash the Fortémi server records, so a shard exported here verifies
  there and vice versa. `importShard` restores sidecar blobs into the local blob
  store and re-links them to their attachments.
- **ADR-012 (#282):** attachment blob storage design accepted — bytecask
  substrate with a `BlobStore` interface and schema parity with the server's
  attachment metadata (MIME type, extracted text; migration `0010`).

### `@fortemi/core` — AIWG index + Knowledge Shard hardening batch (#265–#294)

A sweep of correctness and security fixes across the portable-schema surface:

- **Security:** the SEC1 prototype-pollution fix is completed — the three
  remaining untrusted-key-on-`{}` sites now use null-prototype accumulators
  (#286); public index validators return structured `{ valid: false }` results
  on hostile input instead of throwing (#288).
- **Knowledge Shards:** `importShard` resolves with a structured
  `{ success: false, errors }` result on malformed manifests/components instead
  of rejecting its promise (#285); the URL reader is bounded, `openShard`
  verifies checksums, export/import size accounting and skip counts are
  consistent, and shard version comparison is numeric rather than
  lexicographic (#289); shard version gates and index traversal corrected (#244).
- **AIWG index:** chunked indexes built from v2 exports with `source.graph`
  load correctly (#284); the match cache keys on `searchProfile` and privacy
  filtering fails closed (#290); discovery ranking aligned with the server
  (#266); the vendored index schema is pinned with a provenance receipt —
  reviewed source changes only, never fetched at build time (#293).
- **Pipeline:** attaching a file re-embeds the note, tool JSON no longer
  surfaces browser-only fields without parity coverage (#291); soft-deleted
  notes are excluded from embedding, concept-tagging, and criteria
  embedding-sets (#287).
- **Quality:** `db-table-parity/` schema-parity test gate added (#256);
  dead code and duplicated shard/index types and parsers removed (#294).

### Docs — browser-edition positioning, doc-sync, and API reference (#274, #309)

- README and docs repositioned: fortemi-react is the **browser edition of the
  Fortémi intelligent-database stack** (#274).
- Full code-to-docs sync: 12 drift items fixed (test/migration/hook counters,
  stale guide links) and four missing API-reference sections authored —
  Knowledge Shards, the AIWG index (`@fortemi/core/aiwg-index`), the
  `@fortemi/graph` render pipeline/controller, and the React graph views with
  their subpath/peer-dependency matrix (#309).

### Supply chain — npm trusted publishing with provenance (#310)

Public npmjs.org publishing is now **tokenless**. The GitHub-mirror publish
workflow authenticates via OIDC trusted publishing: npmjs.org verifies the
workflow's short-lived identity claims against a per-package trusted-publisher
configuration, and every publish carries a `--provenance` attestation that the
workflow independently verifies landed before the run may succeed. The
long-lived `NPMJS_TOKEN` secret is retired. Verification (typecheck, lint,
1,061 tests, e2e) stays on Gitea CI; the GitHub leg is delivery-only. This
release is the first shipped through the OIDC pipeline.

## v2026.7.3 - 2026-07-07

Security-hardening release for the AIWG portable-schema surface (epic #235). The
AIWG index, chunk manifests, and Knowledge Shard archives are treated as
untrusted input loaded from a URL or file; this release closes a critical
prototype-pollution vector and a bundle of SSRF / decompression-bomb /
path-traversal / DoS issues, and makes index and embedding-set generation
privacy-safe by default.

### `@fortemi/core` — security hardening

- **Prototype pollution fixed (SEC1, #236):** facet aggregation
  (`getAiwgFortemiFacets` / `pushFacet`) built its counters on a prototype-bearing
  object, so an untrusted index record with a facet key of `__proto__` — or any
  inherited name such as `toString` — mutated shared built-ins during an ordinary
  `useAiwgIndex().search()`. Aggregation now uses null-prototype accumulators;
  exotic keys are counted as plain data. **Critical, zero-interaction.**
- **Untrusted index/shard hardening (SEC2–SEC5, #241):**
  - *SSRF:* the chunk/detail fetch loaders enforce same-origin against the base
    URL plus an http/https/blob/data scheme allowlist, so an absolute manifest
    `href` can no longer redirect fetches off-origin.
  - *Decompression bomb:* `unpackTarGz` rejects archives whose gzip footer
    declares more than a 256 MiB (overridable) decompressed size, before
    allocating.
  - *Path traversal:* shard component reads reject `..`, absolute, backslash,
    scheme, and null-byte paths (cluster subdirs like `notes/000.jsonl` still
    allowed).
  - *Algorithmic DoS:* the duplicate-pair scan is capped at 5000 embeddings by
    default (overridable), bounding its O(n²) cost.
- **Privacy/PII enforced at generation (SEC6, #243):**
  `buildAiwgStaticEmbeddingSet` and `buildAiwgChunkedIndex` now exclude
  `private`-classified and `pii`-flagged records by default (opt back in via
  `privacy: { includePrivate, includePii }`), so a leaked embedding set or scan
  part no longer carries private/PII-derived vectors. New export
  `filterAiwgRecordsByPrivacy`.
- **Checksum trust model documented (SEC7, #243):** in-archive checksums detect
  transport corruption, not tampering; provenance-sensitive imports should verify
  integrity out of band (a signed manifest, or `prefetchShard`'s `expectedSha256`).
- **Shard attachment data-loss surfaced (E1, #237):** shard import now emits an
  explicit warning when a note's attachment references cannot be restored —
  attachment bytes are not yet packaged in shards — instead of silently dropping
  them. The full attachment round-trip stays tracked in #237 pending the shard
  binary-packaging contract.

### `@fortemi/core` — AIWG index & shard conformance

- **Index validator hardened (A2–A6/E8, #239):** `validateAiwgFortemiIndexExport` —
  the enforcement point AIWG re-imports to validate its own generator output — now
  rejects a `record.v1` that carries v2-only fields (`search`/`chunks`/`embeddings`/
  `skos_*`/`compatibility`, v2 relationship/source fields, `privacy.locality`),
  enforces the `privacy.classification` and provenance `confidence` enums, validates
  provenance item shape, and gates `source.graph`/`compatibility` to `export.v2`. The
  `AiwgFortemiIndexExport['source']` type was corrected (dropped phantom record-level
  `origin`/`generated`/`checksum`/`updated_at`, added the v2 `graph` block), and
  chunked review-decision exports report the true source version. Stale known-type
  constant `docs.page` renamed to `aiwg.kb.page`.
- **Shard conformance harness spiked (#238):** a committed structural authority for
  the Knowledge Shard contract (`packages/core/schemas/knowledge-shard.schema.json`)
  plus a CI-runnable proof that catches the shard field-drift breaks the
  `format-parity` suite could not. Full schema + AJV + golden fixtures and the
  `format-parity` rename are backlogged (#255, #256); SAD R-002 now points at the
  real conformance surfaces.

### Documentation

- **Standalone docs index completed (#253):** the in-app docs browser bundles the
  v2026.7.3 release note (`apps/standalone/src/data/project-docs.ts`), which the
  release bump had missed.

### Compatibility

Additive and security-focused, with one deliberate default change: the index and
embedding-set *builders* now filter `private`/`pii` records by default — callers
that need those records must opt in via `privacy: { includePrivate, includePii }`.
No schema, migration, or wire-format change; existing Knowledge Shards, embedding
sets, and static indexes remain valid.

## v2026.7.2 - 2026-07-05

This release brings the browser edition's binary-attachment handling into parity
with the Fortemi server contract and adds a headless embedding path so CLI and
Node consumers can build embedding sets without a browser.

### `@fortemi/core` — binary attachment extraction and headless embeddings (#227, #228)

- Attachment rows now carry `mime_type` and `extracted_text` (migration `0010`).
  Binary attachments are represented in the search, index, export, and
  embedding-set surfaces via extracted text plus a content-addressed attachment
  reference — never raw binary bytes. Raw bytes stay in `BlobStore`.
- Extracted attachment text feeds live search, the static shard-reader search,
  embedding generation, virtual embedding-set query criteria, and concept
  tagging, so a note's attached documents are findable by their contents.
- Added `buildAiwgStaticEmbeddingSet` — a Node/headless entrypoint that generates
  `aiwg.fortemi.embedding.set.v1` sidecars from any Node-safe model backend, with
  no DOM or WebGL dependency. This unblocks CLI index building (for example
  AIWG's `index embed`).
- Notes carry server-compatible `attachments` in the Knowledge Shard export, so
  attachment metadata and extracted text travel with the note while raw bytes do
  not. Legacy React shards that used `binary_sources` remain importable.

### Documentation

- Backfilled the monthly blog reports for 2026-03 (inception), 2026-04, and
  2026-05, matching the June report structure and public-facts-only bar (#230).
- Published the June report hero image and removed a duplicate.
- Enabled Pagenary root HTML fallback and static page generation, and the open
  SEO profile (machine-readable corpus artifacts, `llms.txt` extracts,
  accessibility report). Updated the docsite to `@pagenary/publisher@2026.7.16`.
- Documented the attachment extraction contract and the CLI embedding-set
  generation path.

### Release metadata

- Synced package versions, runtime `VERSION` constants, docs references, and
  release notes for `2026.7.2`.

### Published Packages

- `@fortemi/core@2026.7.2`
- `@fortemi/graph@2026.7.2`
- `@fortemi/react@2026.7.2`

## v2026.7.1 - 2026-07-02

This release makes Fortemi's AIWG static index adapter compatible with the
AIWG #1664 v2 export contract while preserving the existing v1 consumer surface.

### `@fortemi/core` — AIWG index export v2 compatibility (#219, #220)

- `@fortemi/core/aiwg-index` now accepts both v1 and v2 AIWG static export
  envelopes and record schema versions, including v2 all-domain record types,
  source projection metadata, `search`, `chunks`, `embeddings`,
  `privacy.locality`, and compatibility metadata.
- Query helpers consume v2 `search` and `chunks` projections without requiring
  AIWG domain records to collapse back to `aiwg.artifact`.
- Relationship traversal preserves v2 `target_path` and
  `direction: upstream | downstream | related` fields, and adds
  `relationshipDirection` filtering alongside existing graph
  `direction: in | out | both` traversal.
- Added whole-index and chunked traversal coverage for dependency,
  citation/profile, KB, and memory graph cases while keeping v1 fixtures valid.

### Release metadata

- Synced package versions, runtime `VERSION` constants, docs references, and
  release notes for `2026.7.1`.

### Published Packages

- `@fortemi/core@2026.7.1`
- `@fortemi/graph@2026.7.1`
- `@fortemi/react@2026.7.1`

## v2026.7.0 - 2026-07-01

This release expands Fortemi's AIWG static index and bridge-search contracts so
AIWG discovery, graph traversal, exported embeddings, and semantic/hybrid bridge
search can share the browser-first `@fortemi/core` surface.

### `@fortemi/core` — AIWG index and search contracts (#213, #214, #215, #216, #217)

- AIWG static index record types are now extensible. Project-specific strings
  such as `aiwg.skill`, `aiwg.command`, `aiwg.rule`, `aiwg.requirement`, and
  `research.ref` validate and can be filtered directly without collapsing into
  `aiwg.artifact`.
- Added opt-in AIWG discovery ranking with hyphen/space normalization,
  stopword-stripped verbose queries, trigger/capability weighting, fallback
  matching, and match reasons for command-palette debugging.
- Added relationship traversal helpers for full and chunked AIWG indexes,
  including direction/type filters, neighbor set operations, and chunked
  community graph projection without forcing full export materialization.
- Added the `aiwg.fortemi.embedding.set.v1` static embedding sidecar contract,
  semantic/hybrid query helpers, stale-vector input hashes, and duplicate-pair
  reporting without adding a model runtime dependency to base core.
- Exposed bridge search modes `text`, `semantic`, `hybrid`, and `auto` at the
  tool boundary. Forced semantic/hybrid calls require host-provided
  `query_embedding`; `auto` falls back to deterministic text search when no
  embedding is supplied.

### Documentation and release metadata

- Synced API reference, integration docs, deployment CI wording, release note
  indexes, and runtime version constants with the current code surface.

### Published Packages

- `@fortemi/core@2026.7.0`
- `@fortemi/graph@2026.7.0`
- `@fortemi/react@2026.7.0`

## v2026.6.9 - 2026-06-24

This release upgrades the `@fortemi/graph` community layout into a real deterministic force settlement and refreshes the documentation build tooling.

### `@fortemi/graph` — deterministic force settlement for `layoutCommunityGraph` (#206)

- The `force` algorithm now runs a fixed-iteration, seeded force settlement — spring link attraction, charge repulsion, collision spacing, community cohesion, centering, and per-tick bounds clamping — instead of a closed-form radial ring. Output stays deterministic for identical `(graph, options)` and is fully synchronous and headless (no animation frames), so settled coordinates are reproducible for static SVG generation, SSR, and browser rendering.
- New optional `LayoutOptions`: `seed`, `ticks`, `nodeRadius`, `linkDistance`, `linkStrength`, `chargeStrength`, `collisionPadding`, `communityStrength`, `boundsPadding`, each with a documented default. The `radial`, `community`, and `manual` algorithms remain closed-form and now also honor `boundsPadding`.
- Positioned nodes now carry a stable render radius `r` (degree-derived by default, overrideable via `nodeRadius`), and the result exposes `communities` centroids. Both fields are additive; the public export surface is otherwise unchanged.

### Documentation

- The documentation site builds with the latest `@pagenary/publisher` (2026.6.13) and emits no build warnings.
- Synced documentation to code (graph package README layout section; `CLAUDE.md` version and count metrics).

### Published Packages

- `@fortemi/core@2026.6.9`
- `@fortemi/graph@2026.6.9`
- `@fortemi/react@2026.6.9`

## v2026.6.8 - 2026-06-20

This release extends the `aiwg-index` static export contract with optional rich SKOS and W3C PROV metadata for documentation consumers while preserving the existing v1 record schema and query behavior.

### `@fortemi/core` — richer `aiwg-index` static metadata (#204)

- Extended `aiwg.fortemi.index.record.v1` with optional rich metadata fields for static consumers: `skos_concepts`, `skos_relations`, `provenance_events`, and structured relationship metadata.
- Existing flat `facets`, `concepts`, `relationships`, and `provenance` remain required and continue to drive query/search behavior; rich metadata is detail-only unless hosts explicitly include it in chunk projections.
- Migration guidance for vendored consumers such as Pagenary: no schema-version change or breaking migration is required. Continue validating and querying existing records as before, then opt in to rendering rich metadata by reading full records and checking each optional field for presence.

### Published Packages

- `@fortemi/core@2026.6.8`
- `@fortemi/graph@2026.6.8`
- `@fortemi/react@2026.6.8`

## v2026.6.7 - 2026-06-17

This release completes the SKOS and W3C PROV read/write surfaces across the static-shard, PGlite, and remote-server backend tiers, then refreshes documentation to match the current code surface.

### `@fortemi/core` — SKOS/PROV backend and repository surfaces

- Added shard-reader accessors for `relationsOf(conceptId)` and `provenanceOf(id)`, so static shard consumers can render SKOS hierarchy and W3C PROV provenance without importing into PGlite.
- Expanded `DataBackend` with backend-neutral `linksOf`, `conceptsOf`, and `provenanceOf` accessors, and enriched full-note results with links, concepts, and provenance where available.
- Added `SkosRepository.tagNote`, `SkosRepository.untagNote`, and `SkosRepository.conceptsForNote` for first-class note-to-concept associations.
- Added `ProvenanceRepository.recordProvenance` and `ProvenanceRepository.forEntity` for first-class provenance writes and reads.
- Added `createRemoteBackend(config)` for the Fortemi server tier, advertising read/write/merge/multi-user capabilities with server-side semantic search.

### `@fortemi/react` — remote and shard hook parity

- Added `useRemote(config)` for React access to the network-backed Fortemi server `DataBackend`.
- Expanded `useShard(source, options?)` with passthrough accessors for `linksOf`, `conceptsOf`, `relationsOf`, and `provenanceOf`.

### Docs and release metadata

- Synchronized the API reference, package README, docsite config, and release manifest with the 30 exported React hooks and current backend surface.
- Updated runtime `VERSION` constants to match package metadata.

### Published Packages

- `@fortemi/core@2026.6.7`
- `@fortemi/graph@2026.6.7`
- `@fortemi/react@2026.6.7`

## v2026.6.6 - 2026-06-17

Documentation maintenance release. The published packages (`@fortemi/core`, `@fortemi/graph`, `@fortemi/react`) are unchanged in content from v2026.6.5 apart from the version number — there are no source, API, or behavior changes. Only repository documentation changed.

### Docs

- Fixed five broken **Next Steps** links in `docs/getting-started.md` that pointed at standalone pages never created (`hooks.md`, `capabilities.md`, `archives.md`, `job-queue.md`, `api-types.md`), producing five broken-link warnings in the docsite build. Each now points at the corresponding section of `api-reference.md` (Hooks, Capability Manager, Migrations and Archive, Job Queue, Types). The docsite build reports zero broken links. (#193)

## v2026.6.5 - 2026-06-16

Three interchangeable read paths for the same knowledge base — a pre-indexed PGlite snapshot, a static-file shard read in place, and the live PGlite database — now sit behind one operation interface with negotiated capabilities. All additive and opt-in; existing PGlite paths are unchanged.

### `@fortemi/core` — uniform tool-intent backend seam + capability negotiation (#191)

- New `DataBackend` interface lifts the storage seam above SQL: `listNotes` / `getNote` / `search` are the shared core, with `getNoteFull`, `semantic`, and `manageNote` present only on backends whose capabilities advertise them. The PGlite database backend and the static-file shard reader (#189) both satisfy it to their tier, so app code dispatches the same way regardless of where the data lives.
- `BackendCapabilities` describes a backend with `read` / `write` / `merge` / `multiUser`, a `semantic` tier (`none` | `cosine-small` | `ann-full` | `server`), and a `startupCost`. `createPGliteBackend(db)` wraps the repositories plus the `manageNote` tool (read+write+merge; `ann-full` semantic when embeddings exist). `createShardBackend(reader)` wraps `openShard` (#189): instant, read-only, with the semantic tier set by the attached vector provider.
- `selectBackend(request, available)` negotiates: it prefers a fully-satisfying backend with the lightest startup cost and, when none fully satisfy, returns the fewest-missing candidate so callers can degrade deliberately via `selection.missing`. Runtime upgrade/downgrade (static-file → PGlite when a visitor opts into semantic) is the same call with a stronger request. A remote-server backend is a future adapter against this same interface (deferred under epic #190). ADR: `.aiwg/architecture/adr-backend-seam.md`.

### `@fortemi/core` + `@fortemi/react` — static-file backend: in-place clusterable shard reader (#189)

- `openShard(source)` reads a `.shard` archive in place — browse, full-text + facet search (PGlite-parity AND semantics over multiple words), links/tags/concepts resolution, and lazy full content — without importing into PGlite. `source` is a packed `Uint8Array`/`Blob` or `{ baseUrl }` for lazy per-file fetch.
- Shards can be exported with a clustered note layout (`exportShard(db, { clusterNotesSize })` emits `notes/NNNNNN.jsonl` + a manifest `layout`), so an in-place reader fetches only the clusters a query needs. `importShard` and `openShard` both consume the layout transparently; monolithic shards stay valid.
- Semantic search over a shard is a pluggable provider with three tradeoff points: none (text/facets only), brute-force cosine over a small static vector set (`createCosineSemanticProvider`), or a prebuilt ANN snapshot. React adds `useShard(source, options?)`, mirroring `useAiwgIndex()`.

### `@fortemi/core` + `@fortemi/react` — physical data-dir snapshot restore (#187)

- `dumpDbSnapshot(db, options?)` captures a pre-indexed PGlite data directory image (gzip by default) plus a version stamp (schema id, migration head, PGlite version, pgvector availability). `restoreDbSnapshot(source, options?)` verifies the stamp against the running environment and loads the image — so a consumer boots a fully-indexed database without replaying migrations or rebuilding HNSW. Hard version gates (schema, exact migration head, PGlite major.minor) throw `DbSnapshotVersionError` on mismatch; pgvector availability is advisory. Source forms: inline `{ data, meta }`, a string URL (with a `<url>.meta.json` sidecar), or `{ dataUrl, metaUrl? }`.
- `ArchiveManager.adopt(backend, archiveName?)` swaps in an externally-built backend without running migrations. `FortemiProvider` gains `snapshotUrl` / `snapshotExpectations` props to restore from a static snapshot on mount (main-thread mode).

### `@fortemi/core` — aiwg-index chunked-mode fixes (#177, #178, #179)

- Path-safe base64url encoding for chunked detail ids (#177), `exportReviewDecisions` works in chunked mode (#178), and the chunked query match-set is cached across pages so re-paging a query no longer re-scans every part (#179).

## v2026.6.4 - 2026-06-15

### `@fortemi/core` + `@fortemi/react` — off-main-thread query-embedding transport (#180)

- New opt-in worker transport for the semantic embed function, so semantic search runs off the main thread end-to-end. With worker mode (#146) the PGlite DB + HNSW query are already off-thread; the embedding model load and per-query inference now move off the main thread too. `createWorkerEmbedFunction(port, options?)` wraps a `Worker`/`MessagePort` into an `EmbedFunction` with id-matched requests, a per-request timeout (default 30s, `0` disables), and `dispose()` cleanup; `handleEmbedRequests(port, embed)` is the worker-side helper that answers the message protocol. `registerSemanticCapabilityWorker(manager, port, options?)` wires it into the capability lifecycle — listener attached on `enable('semantic')`, removed on `disable`.
- Wired at the `set/getEmbedFunction` seam, so both query embedding and the job-queue embedding handler go off-thread with one registration. The host keeps full control of the model and its params, so build-time corpus embeddings stay an exact match. The existing main-thread `registerSemanticCapability(manager, embedFn)` path is unchanged — additive and opt-in.
- `@fortemi/react` adds the `useEmbeddingWorker(transport, options?)` lifecycle hook (`connect` / `disconnect`, auto-teardown on unmount). Exported message types/constants (`EmbedTransportPort`, `EmbedWorkerOptions`, `EmbedRequestMessage`, `EmbedResponseMessage`, `EMBED_REQUEST_KIND`, `EMBED_RESPONSE_KIND`) for hosts that own the wiring directly.

### `@fortemi/core` + `@fortemi/react` — `prefetchShard` / shard warm API (#181)

- New first-class warm/prefetch API that pre-stages shard bytes without building the index, so a user's opt-in click is purely the HNSW index build and the avoidable download moves to background idle. `prefetchShard(url, options?)` resolves bytes from a directly-provided bundled asset (`options.bytes`), the Cache Storage API (`useCacheStorage`, feature-detected), or `fetch(url)`; warms them in an in-memory store with concurrent de-duplication; and optionally verifies the whole-archive SHA-256 against a build-time-known hash (`expectedSha256`). `fromPrefetched(url)` hands the warm bytes to `importShard` unchanged. Helpers: `isShardPrefetched`, `getPrefetchedSha256`, `clearPrefetchedShard`.
- Server-free / local-first by design: shards are static assets (build-time-generated files or bundled bytes), so the API assumes no API/server. Two-layer integrity, both sharing core's `sha256Hex`: whole-archive `expectedSha256` at warm time + the per-file manifest checksums `importShard` already validates at import time. `importShard`'s signature is unchanged — fully additive.
- `@fortemi/react` adds `useShardPrefetch()` (per-url warming flags) and `useImportShard().importFromUrl(url, strategy?, prefetchOptions?)`, which skips the download entirely when the bytes are already warm.

### Release engineering

- The Gitea and npmjs publish workflows now create a repository **Release** for each signed tag and attach the packaged `@fortemi/core`, `@fortemi/graph`, and `@fortemi/react` tarballs (`fortemi-<pkg>-<version>.tgz`) as release assets, alongside the npm publishes — so every release carries downloadable packages on both Gitea and GitHub. Release creation is idempotent (re-runnable from `workflow_dispatch`) and driven by `tools/release/create-repo-release.mjs`. Notes come from `docs/releases/<tag>.md` when present.
- Each repository release now includes a `SHA256SUMS` manifest generated from the exact tarball bytes uploaded to that release surface. Download all four assets and run `sha256sum -c SHA256SUMS` to verify them.

## v2026.6.3 - 2026-06-15

### `@fortemi/graph` — framework-agnostic `GraphController` (#170, #171)

- Extracted the graph-source state machine out of the React `useGraphController` hook into a new `GraphController` in `@fortemi/graph`. It owns the `citations | topics | precomputed | dynamic-search | user-authored` mode dispatch, transition tracking, and load orchestration behind a plain observable surface (`getState()` / `subscribe()`) with no React — so JS-only hosts get the same capability.
- `@fortemi/graph` now depends on `@fortemi/core` (maintainer-authorized). The stack is a clean linear chain with no cycles: `@electric-sql/pglite ← @fortemi/core ← @fortemi/graph ← @fortemi/react`; `@fortemi/core` still imports nothing from `@fortemi/graph`. The pure projection helpers (layout/filter/color/degree/bounds/neighborhood/snapshot) remain database-free and tree-shakeable — only `GraphController` reaches the PGlite-backed repositories.
- `useGraphController` is now a thin `useSyncExternalStore` adapter over `GraphController`; its public return shape is unchanged (no consumer breakage). `GraphView` sources `GraphLayoutState` from `@fortemi/graph`.
- Corrected the `@fortemi/graph` package description, README, and the root dependency-direction note: it is consumed by `@fortemi/react` and JS-only hosts (not `@fortemi/core`) and depends on `@fortemi/core` — dropping the earlier "zero deps / no React / no database" wording (#171).

### `@fortemi/react` — `useAiwgIndex().counts` works in chunked mode (#173)

- `counts` now resolves identically in whole-index and chunked modes. In chunked mode (`loadChunkedIndex`, where `index` is `null`) it derives per-type counts from the manifest's pre-computed `type` facet (`chunkedManifest.facets.type`) — exact global counts from the ~2 KB manifest, no part fetch — and falls back to the item tally for whole-index mode. Consumers can drop the `chunkedManifest.facets.record_type ?? counts` workaround. No change to the hook's return shape.

### `@fortemi/core` — slim/projected chunk parts (#168)

- `AiwgFortemiChunkManifest` gains optional `projection` (the field names present in scan parts) and `detail` (`{ href }` template with `{id}`). When a manifest declares a `projection`, scan parts may omit detail-only fields (`source`, `provenance`, `relationships`, `updated_at`) — roughly half the bytes for a typical CRM index — so broad/agent `searchChunked` scans transfer only the searchable projection. Absent `projection`, parts remain whole records (fully backward compatible).
- `createAiwgIndexController()` gains `getRecord(id)` and `loadChunkedIndex` accepts `detailLoader` + `maxCachedDetails`: a projected index resolves full records on demand (bounded LRU detail cache); a whole-record index serves from loaded parts/data.
- New `createAiwgFetchDetailLoader(baseUrl)` resolves the manifest's `detail.href` `{id}` template (id URL-encoded) and fetches the full record.
- New pure builder `buildAiwgChunkedIndex(index, { partSize, projection?, detailHref? })` returns `{ manifest, parts, details }` — the generalizable writer so consumers don't hand-roll chunk emission. Manifest facets are computed from full records, so global counts stay exact even with slim parts. Exported `AIWG_SCAN_REQUIRED_FIELDS` documents the minimum projection.
- Validation is projection-aware: manifests require the scan-required fields in any `projection` and a `{id}` placeholder in `detail.href`; projected parts validate as slim records.
- `@fortemi/react` `useAiwgIndex()` exposes `getRecord(id)` (resolves chunked detail or whole-index lookup) and forwards `detailLoader` via `loadChunkedIndex` options.

### Tooling

- CI builds `@fortemi/core` before running the `@fortemi/graph` test suite. `@fortemi/graph` now imports `@fortemi/core` by its published entry point, so its tests need core's build output present — the `unit-test` job previously ran them before the build step.

### Published Packages

- `@fortemi/core@2026.6.3`
- `@fortemi/graph@2026.6.3`
- `@fortemi/react@2026.6.3`

## v2026.6.2 - 2026-06-15

### New Package: @fortemi/graph

- Extracted the graph projection logic that lived inside the React `GraphView` into a new standalone package `@fortemi/graph` with zero runtime dependencies. It provides pure, deterministic helpers for graph layout, filtering, community color assignment, degree-based node sizing, bounds/fit calculations, neighborhood expansion, and static snapshot serialization.
- The helpers operate on plain `CommunityGraph` data, so they can be shared and mixed across `@fortemi/core` consumers, `@fortemi/react`, and JS-only hosts that want to render an AIWG relationship graph without pulling in React or PGlite.
- `@fortemi/react`'s `GraphView` now delegates layout/filter/color/sizing to the add-on; rendering behavior is unchanged. `useGraphController` sources `GraphLayoutAlgorithm` from the package.
- `@fortemi/core` is unchanged and remains the base layer — it still owns graph production (`GraphRepository`, similarity/link graphs) and community detection.

### Tooling

- CI now runs the `@fortemi/graph` and `@fortemi/react` package test suites in addition to `@fortemi/core`.
- The Gitea and npmjs.org publish workflows and the signed-tag release gate verify and publish `@fortemi/graph` alongside `@fortemi/core` and `@fortemi/react` (graph publishes before react, which depends on it).

### Published Packages

- `@fortemi/core@2026.6.2`
- `@fortemi/graph@2026.6.2`
- `@fortemi/react@2026.6.2`

### Upgrade Notes

Additive release. Consumers upgrading from `2026.6.1` need no source changes; `GraphView` behavior is unchanged. Hosts that want the raw graph helpers directly can now `pnpm add @fortemi/graph`. No archive schema migration is included.

## v2026.6.1 - 2026-06-14

### Provider Configuration and Standalone UX

- Added bridge-safe provider configuration in the standalone app with preloaded browser-local, OpenAI, OpenRouter, Ollama, LM Studio, Jan, llama.cpp, and vLLM options.
- Kept API keys out of normal browser storage by requiring secure browser or machine-backed secret storage before persisting provider credentials.
- Seeded the standalone app with the project documentation corpus so the default UX can search and review `/docs` content immediately after initialization.

### PGlite and Shard Scalability

- Added worker-mode PGlite support in `FortemiProvider` for UI-safe database startup and heavy archive work.
- Added chunked Knowledge Shard import with progress callbacks and event-loop yielding.
- Added set-scoped Knowledge Shard export and lazy/paged vector handling for large embedding archives.

### Graph and AIWG Review

- Added `GraphView` and AIWG index graph projection so loaded AIWG exports can be inspected as relationship graphs.
- Exported bridge helpers and tests for the new provider, AIWG graph, shard, and worker-mode surfaces.

### Published Packages

- `@fortemi/core@2026.6.1`
- `@fortemi/react@2026.6.1`

### Upgrade Notes

Consumers upgrading from `2026.6.0` get additive React props, shard options, AIWG graph projection helpers, and standalone provider configuration. Existing archives do not require a schema migration.

## v2026.6.0 - 2026-06-12

### AIWG CRM Integration

- Added the AIWG Fortemi index import and validation surface for sanitized CRM/task exports.
- Added review-decision export helpers and React `useAiwgIndex()` support so host apps can ingest, inspect, and act on AIWG index records.
- Added API documentation and a dedicated AIWG CRM integration guide.

### Job Queue Capability Gating

- Deferred jobs with unavailable `required_capability` values before handler dispatch instead of letting LLM-dependent handlers run and fail with misleading provider errors.
- Kept deferred jobs in `pending` without retry increments while storing a clear `requires capability '<name>' - not ready` message.
- Added `job.blocked` and `capability.required` events so host apps can prompt users to enable missing capabilities on demand.

### Release Infrastructure

- Fixed internal publish credentials so the Gitea package workflow uses the Gitea publish token.
- Passed the selected release tag through the publish verifier for manual publish reruns.

### Published Packages

- `@fortemi/core@2026.6.0`
- `@fortemi/react@2026.6.0`

### Upgrade Notes

Consumers upgrading from `2026.5.4` get additive AIWG index APIs and improved job queue gating. Existing archives do not require a schema migration for this release.

## v2026.5.4 - 2026-05-27

### Graph and Embedding Workflows

- Added virtual embedding-set selectors and durable virtual embedding-set definitions for default, criteria, set-operation, fallback, latest-compatible, and snapshot workflows.
- Added persisted graph/community artifact tables and Knowledge Shard import/export support for graph sources, graph edges, community sets, communities, and community assignments.
- Added cached similarity graph APIs with freshness tracking, cache-only/live-only modes, stale marking, and threshold alias validation.
- Added dynamic and user-authored community APIs plus React hooks for embedding sets, similarity graphs, communities, and graph-source controller state.

### Release and Supply Chain

- Split public npmjs.org distribution to the GitHub mirror workflow using `NPMJS_TOKEN` and npm provenance while keeping Gitea package publication for the internal registry.
- Added the release-tag helper that forces the project release-signing key before publishing workflows run.
- Fixed migration-count tests so future schema migrations do not require hard-coded test rewrites.

### Published Packages

- `@fortemi/core@2026.5.4`
- `@fortemi/react@2026.5.4`

### Upgrade Notes

Consumers upgrading from `2026.5.3` get two new migrations: `0007_virtual_embedding_sets` and `0008_graph_community_artifacts`. Existing archives migrate on open. React consumers can keep existing hooks unchanged; the new graph/community hooks are additive.

## v2026.5.3 - 2026-05-24

### Package Documentation

- Expanded the `@fortemi/core` README with the project value proposition, architecture overview, use cases, search/knowledge model, tool surface details, and storage/privacy positioning for npm readers.
- Expanded the `@fortemi/react` README so React consumers can understand the local-first archive, retrieval, Knowledge Shard, capability, and bridge-tool value without needing to read the core README first.
- Updated getting-started and integration documentation to use host-neutral Fortemi language.

### Host-Neutral API Cleanup

- Removed legacy downstream host references from docs, ADRs, code comments, and tests.
- Standardized bridge-visible tool IDs on the `fortemi.*` namespace.
- Standardized bridge projection naming on `BridgeCapability` and `toBridgeCapabilities()`.

### Release Infrastructure

- Fixed Gitea release publishing by sending a versioned release `name` field so repository release lists show a proper release title instead of an empty title with only the Latest badge.
- Kept repository release `tag_name` tied to the signed `v*` tag for both Gitea and GitHub.

### Published Packages

- `@fortemi/core@2026.5.3`
- `@fortemi/react@2026.5.3`

### Upgrade Notes

Most consumers can upgrade directly from `2026.5.2`. Integrations that inspect bridge tool IDs should use the `fortemi.<tool>` namespace. Integrations using the bridge projection helper should use `toBridgeCapabilities()` and `BridgeCapability`.

## v2026.5.2 - 2026-05-24

### Release Infrastructure

- Split repository release credentials so Gitea release publishing uses `GT_PUBLISH_TOKEN` and GitHub release publishing uses `GH_PUBLISH_TOKEN`.
- Fixed manual publish reruns by passing the selected release tag into signed-tag verification.
- Added release-note driven repository release bodies so GitHub and Gitea releases can publish the prepared announcement instead of generic generated copy.

### Published Packages

- `@fortemi/core@2026.5.2`
- `@fortemi/react@2026.5.2`

### Upgrade Notes

No runtime API changes are included in this release. Existing `@fortemi/core` and `@fortemi/react` consumers can upgrade from `2026.5.1` without code changes.

## v2026.5.1 - 2026-05-24

### Release Infrastructure

- Verified the full npm, Gitea release, and GitHub release path for signed Fortemi releases.
- Published `@fortemi/core@2026.5.1` and `@fortemi/react@2026.5.1` to npm.
- Created matching Gitea and GitHub repository releases for the signed `v2026.5.1` tag.

## v2026.5.0 - 2026-05-23

### Initial Published Packages

- Added the npm publish workflow for `@fortemi/core` and `@fortemi/react`.
- Added signed release-tag verification using the project release key.
- Published the first coordinated package release for the Fortemi browser packages.
