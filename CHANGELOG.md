# Changelog

All notable changes to fortemi-react are documented here.

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
