# doc-sync Audit — code-to-docs — 2026-06-18

## Summary

Direction: code-to-docs.

Source evidence inspected:

- `packages/react/src/index.ts`
- `packages/react/src/hooks/*.ts`
- `packages/core/src/data-backend.ts`
- `packages/core/package.json`
- `packages/react/package.json`
- `packages/graph/package.json`
- `docs/**/*.md`
- `docs/config.json`
- `docs/manifest.json`

## Findings Fixed

### DOC-DRIFT-001 — React hook count and inventory stale

Severity: high.

Evidence: `packages/react/src/index.ts` exports 30 hook functions, excluding `useFortemiContext`. Documentation and package metadata still claimed 23 hooks and omitted newer hooks.

Fixed:

- `docs/config.json` now advertises 30 hooks.
- `packages/react/package.json` now advertises 30 hooks.
- `docs/packages/react.md` and `packages/react/README.md` now list the missing hooks:
  - `useShardPrefetch`
  - `useEmbeddingWorker`
  - `useCommunities`
  - `useGraphController`
  - `useShard`
  - `useRemote`

### DOC-DRIFT-002 — API reference omitted exported React hooks

Severity: high.

Evidence: `packages/react/src/index.ts` exports hooks not present in `docs/api-reference.md`.

Fixed: `docs/api-reference.md` now includes reference entries for:

- `useExportShard`
- `useImportShard`
- `useShardPrefetch`
- `useGpuCapabilities`
- `useInferenceCapabilities`
- `useLocalDiscovery`
- `useEmbeddingPipeline`
- `useEmbeddingWorker`
- `useCapabilitySetup`
- `useAiwgIndex`
- `useShard`
- `useRemote`

### DOC-DRIFT-003 — Published dependency examples stale

Severity: medium.

Evidence: package manifests advertise `2026.6.6`; `docs/integration.md` still showed `2026.6.4` in the published-package install example.

Fixed: `docs/integration.md` now uses `2026.6.6` for `@fortemi/core` and `@fortemi/react`.

### DOC-DRIFT-004 — Release navigation missing current release files

Severity: medium.

Evidence: `docs/releases/v2026.6.4.md`, `docs/releases/v2026.6.5.md`, and `docs/releases/v2026.6.6.md` exist, but `docs/manifest.json` stopped at v2026.6.3.

Fixed: `docs/manifest.json` now includes v2026.6.4, v2026.6.5, and v2026.6.6.

### DOC-DRIFT-005 — Backend seam inline docs still described remote as future

Severity: medium.

Evidence: `packages/core/src/data-backend.ts` exports `createRemoteBackend`, while the module comment still said the remote-server adapter was future/deferred.

Fixed: the inline seam documentation now describes PGlite, static shard files, and the Fortemi server tier as current adapters.

## Remaining Non-Autofixed Finding

### DOC-DRIFT-006 — Package version metadata and exported VERSION constants disagree

Severity: medium.

Evidence:

- `packages/core/package.json`, `packages/graph/package.json`, and `packages/react/package.json` are `2026.6.6`.
- `packages/core/src/index.ts` exports `VERSION = '2026.6.4'`.
- `packages/graph/src/index.ts` exports `VERSION = '2026.6.4'`.

Resolution: not auto-fixed in code-to-docs mode because this is source/metadata drift, not a documentation-only correction. A follow-up should decide whether exported runtime constants should track package versions.

## Validation Plan

- Search for stale hook-count claims.
- Search for missing release manifest entries.
- Run markdown/package JSON syntax checks.
- Run TypeScript typecheck if source-comment/package metadata edits require it.
