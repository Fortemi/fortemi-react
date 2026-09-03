# Documentation Sync Report - 2026-09-03

## Direction and Scope

- Direction: `code-to-docs`
- Mode: incremental stable-release preparation
- Baseline: `v2026.8.0`
- Target: `v2026.9.0`
- Scope: dataset execution/ingest/lineage/materialization contracts and React
  workflow, configured inference runtime/routing, React routing and provenance
  hooks, standalone provider settings, EX-18 provenance data and presentation,
  release/test policy, package versions, changelog, and embedded project docs

The audit used the changed-file inventory first and stayed within
`packages/**`, `apps/**`, `docs/**`, `examples/**`, `README.md`, and
`CHANGELOG.md`, matching the release configuration.

## Findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | medium | Browser, bridge-service, and discovered-local providers shared implementation but lacked one documented deployment configuration and task-routing contract. | Added runtime, route-policy, profile, event, and React-hook documentation to the integration guide and API reference. |
| 2 | medium | The document embedding path did not document when it selects a larger embedder route. | Documented `embedding.document` versus `embedding.large-document`, thresholds, and query-task selection in the search and integration guides. |
| 3 | medium | EX-18 described revision history but did not demonstrate stored W3C PROV-style source or citation metadata. | Updated the example catalog, README, seed data, timeline UI, and API reference with stored entity/activity/agent/derivation fields. |
| 4 | medium | The local release gate executed only Core tests, so React and example regressions were not release-blocking. | Added an ordered workspace test command, example unit execution in CI, and focused React, PGlite, and Playwright provenance coverage. |
| 5 | info | Package metadata and embedded docs still identified `2026.8.0`. | Advanced the lockstep package versions/constants, API header, changelog, manifest, embedded project-doc corpus, and release note to `2026.9.0`. |
| 6 | info | The release could be misread as widening suite compatibility claims. | Release documentation retains the suite `NO-GO`, separates the static-index/state-transfer/live-persistence planes, and limits Knowledge Shard language to named `core-v1`, `record-v1`, or `full-v1` evidence. |
| 7 | medium | The rebased release included new dataset capability, ingest, lineage, materialization, and React workflow APIs that were absent from the public API and release summaries. | Added bounded API and release documentation for the versioned contracts, reference implementations, React subpath, evidence requirements, and compatibility limits. |

## Files Updated by Sync

- `CHANGELOG.md`
- `apps/standalone/src/data/project-docs.ts`
- `docs/content/api-reference.md`
- `docs/content/examples/index.md`
- `docs/content/guides/integration.md`
- `docs/content/guides/search.md`
- `docs/content/releases/v2026.9.0.md`
- `docs/manifest.json`
- `examples/README.md`
- `examples/gallery.manifest.json`
- `examples/research-workbench/README.md`
- `package.json`
- `packages/core/package.json`
- `packages/core/src/index.ts`
- `packages/graph/package.json`
- `packages/graph/src/index.ts`
- `packages/react/README.md`
- `packages/react/package.json`
- `apps/standalone/package.json`

## Validation

- `pnpm typecheck` - passed in the repository workspace
- `pnpm lint` - passed in the repository workspace
- `pnpm test:workspace` - passed in an isolated clean-path copy: Core 79 files /
  1,338 tests; Graph 6 / 87; React 7 / 35; EX-18 seed 1 / 1
- `pnpm build` - passed in the isolated clean-path copy
- `pnpm examples:site:build` - built all 20 examples and the gallery index
- focused EX-18 built-gallery Playwright smoke - passed
- `tools/release/test-e2e.sh` - passed: 28 browser tests, 2 expected skips
- `git diff --check` - passed

Vitest/Vite commands at the original path encounter an unrelated empty
`/home/roctinam/package.json`; the clean-path copy removes that ancestor-file
input. The first focused Playwright invocation correctly timed out because the
static gallery prerequisite had not yet been assembled in the fresh copy; it
passed after `pnpm examples:site:build`. Gitea CI will repeat all configured
checks from a clean checkout before the release tag is cut.

## Remaining Gates

- Push the PR branch and require the complete Gitea `ci.yml` workflow to pass.
- Merge through the repository's `pr-required` delivery policy.
- Cut and verify the signed tag through `tools/release/cut-tag.sh` only.
- Verify Gitea/GitHub release assets, checksums, and npm publication.
