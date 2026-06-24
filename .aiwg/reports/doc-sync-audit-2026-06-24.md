# Doc-Sync Audit — 2026-06-24

**Direction:** `code-to-docs` (code is source of truth)
**Scope:** canonical project doc (`CLAUDE.md`) + published package docs (`packages/graph/README.md`)
**Mode:** applied (fixes committed on branch `docs/pagenary-latest-and-code2doc`)

## Executive summary

8 drift items found, all auto-fixable from source-of-truth counts/code. 0 human-required.
`AIWG.md` carries a generated mirror of the same `CLAUDE.md` block and has pending tooling
edits — left for `aiwg regenerate` to propagate rather than hand-edited (see Deferred).

## Findings & resolutions

### Graph API (release-relevant — from #206)

| ID | Drift | Resolution |
|----|-------|------------|
| DOC-DRIFT-001 | `packages/graph/README.md` described `layoutCommunityGraph` as "closed-form … no randomness" — stale after the `force` algorithm became a seeded force settlement | Reworded to "seeded `force` settlement plus closed-form `radial`/`community`/`manual`" |
| DOC-DRIFT-002 | API table entry omitted settlement, per-node `r`, and community centroids | Updated entry + added a "Layout options (`force`)" subsection documenting `seed, ticks, nodeRadius, linkDistance, linkStrength, chargeStrength, collisionPadding, communityStrength, boundsPadding`, defaults, and the `r` / `communities` outputs |

### Numeric / version claims (`CLAUDE.md`)

| ID | Claim | Was | Now (verified) | Source of truth |
|----|-------|-----|----------------|-----------------|
| DOC-DRIFT-003 | Current version | 2026.6.4 | 2026.6.8 | all `packages/*/package.json` + `VERSION` const |
| DOC-DRIFT-004 | Migrations | 5 | 9 | `packages/core/src/migrations/0001…0009` |
| DOC-DRIFT-005 | Repositories | 7 | 11 | `repositories/*` (added communities, graph, provenance, embedding-sets) |
| DOC-DRIFT-006 | Capability files | 13 | 14 | `capabilities/*` (added embed-worker-transport) |
| DOC-DRIFT-007 | React hooks | 21 | 31 | `use*` exports in `packages/react/src/index.ts` |
| DOC-DRIFT-008 | Core test files / tests | 40 / 813+ | 53 / 949 | `packages/core/src/__tests__/**/*.test.ts`; vitest run |

Hooks table extended with the 10 missing hooks: `useFortemiContext, useGraphController,
useCommunities, useSimilarityGraph, useEmbeddingSets, useEmbeddingWorker, useShard,
useShardPrefetch, useRemote, useAiwgIndex` (descriptions derived from each hook's source).

### Verified accurate (no change)

- MCP tool functions = **11** (`tools/` minus `manifest.ts`, `schemas.ts`) — matches CLAUDE.md.

## Deferred

- `AIWG.md` (generated companion) mirrors the corrected `CLAUDE.md` block and currently shows
  the same stale numbers plus unrelated pending tooling edits. Propagate via `aiwg regenerate`
  (preserves team directives, refreshes the companion) rather than hand-editing.

## Validation

- Re-counted all metrics against source after edits — match.
- `pnpm --filter @fortemi/graph test` green (graph code unchanged; README-only doc edit).
- `docsite` rebuild green — `docs/packages/graph.md` regenerates from the updated README and
  `dist/fortemi-react/index.html` is produced.
