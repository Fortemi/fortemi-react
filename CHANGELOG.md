# Changelog

All notable changes to fortemi-react are documented here.

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
