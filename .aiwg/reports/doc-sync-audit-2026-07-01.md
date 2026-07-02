# Doc Sync Audit - 2026-07-01

## Scope

- Direction: code-to-docs
- Requested scope: `packages/** apps/** docs/** README.md CHANGELOG.md`
- Changed-file inventory before doc-sync only showed existing AIWG context changes outside the requested scope.
- Audit focused on package metadata, release documentation, CI/release docs, static docs index wiring, and the recently merged AIWG index/search documentation.

## Findings

### High Confidence Fixes Applied

- `packages/core/src/index.ts` exported `VERSION = '2026.6.8'` while package metadata is `2026.6.9`.
- `docs/api-reference.md` listed API version and `VERSION` value as `2026.6.8`.
- `docs/integration.md` published-package dependency example still pinned `@fortemi/core` and `@fortemi/react` to `2026.6.8`.
- `docs/deployment.md` said E2E tests are excluded from default CI, but `.gitea/workflows/ci.yml` now runs `pnpm test:e2e`.
- `docs/manifest.json` and `apps/standalone/src/data/project-docs.ts` omitted `docs/releases/v2026.6.9.md` from the release note index.

### Already In Sync

- `docs/search.md` documents bridge semantic/hybrid/auto search with host-provided `query_embedding` and `embeddingSetId`.
- `packages/core/README.md` documents extensible AIWG record types, AIWG discovery ranking, chunked relationship traversal, and static embedding sidecar search.
- `CHANGELOG.md` contains a `v2026.6.9` section and an `Unreleased` placeholder.

## Files Changed

- `packages/core/src/index.ts`
- `docs/api-reference.md`
- `docs/integration.md`
- `docs/deployment.md`
- `docs/manifest.json`
- `apps/standalone/src/data/project-docs.ts`

## Validation

- `pnpm --filter @fortemi/core typecheck`
- `pnpm --filter @fortemi/standalone typecheck`

## Remaining Human-Review Items

- Operator confirmed target release `2026.7.0` after this audit.
- Release prep continued on `main`; unrelated AIWG context edits remain preserved in `stash@{0}` from the pre-release branch cleanup.
