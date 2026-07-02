# Changelog

All notable changes to fortemi-react are documented here.

## Unreleased

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
