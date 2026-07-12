# aiwg-index.ts decomposition tasks

**Issue**: #244  
**ADR dependency**: ADR-010 accepted source-of-truth decision  
**Target module**: `packages/core/src/aiwg-index.ts` (2441 LOC on 2026-07-09)

## Goal

Split `aiwg-index.ts` along stable ownership boundaries after the portable-schema
source-of-truth decision, without changing public exports or query behavior.
Validation that is bound to the AIWG schema should move toward the generated or
schema-driven layer instead of another hand-maintained split.

## Tasks

| Task | Slice | Deliverable | Verification |
|---|---|---|---|
| D8-1 | Types | Move exported record/export/chunk/controller types to `aiwg-index/types.ts`; preserve public exports from `aiwg-index.ts` and package subpath behavior. | `pnpm --filter @fortemi/core typecheck`; existing `aiwg-index` tests unchanged |
| D8-2 | Validation | Extract `validateAiwgFortemiIndexExport` and helpers to `aiwg-index/validation.ts`; prepare the boundary for vendored-schema/AJV replacement. | `pnpm test:portable-contract`; validator conformance cases |
| D8-3 | Chunked loading | Move manifest, part resolution, detail-id encoding, and chunk fetch logic to `aiwg-index/chunked.ts`. | Chunked index tests in `aiwg-index.test.ts` |
| D8-4 | Discovery | Move `discoveryMatches`, scoring weights, tokenization, and search-profile logic to `aiwg-index/discovery.ts`. | #240 golden discovery-ranking corpus |
| D8-5 | Semantic projection | Move embedding/vector helpers and semantic result scoring to `aiwg-index/semantic.ts`. | Semantic/hybrid search tests |
| D8-6 | Controller | Move controller state, pagination, cache, load/reload, and getRecord APIs to `aiwg-index/controller.ts`. | Controller pagination/cache tests |
| D8-7 | Graph projection | Move graph/community projection helpers to `aiwg-index/graph.ts`. | Graph projection tests and React hook typecheck |

## Sequencing

1. Land D8-1 and D8-2 first, because every other slice depends on the exported
   types and validator boundary.
2. Land D8-3 through D8-7 as separate small PRs; keep `aiwg-index.ts` as a
   compatibility barrel until all imports are migrated.
3. After #255/#schema-vendoring work exists, replace hand-maintained validation
   internals behind the D8-2 boundary rather than changing callers again.

## Non-goals

- Do not change index schema semantics in the decomposition PRs.
- Do not change package public exports except by adding stable internal modules
  that are re-exported through the existing entry point.
- Do not combine this module split with the full #255 shard conformance work.
