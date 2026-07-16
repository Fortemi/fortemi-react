# Doc-Sync Audit — 2026-07-15

**Direction**: code-to-docs (code is source of truth)
**Scope**: `CLAUDE.md`, `AIWG.md` — reconcile to the merged storage subsystem
(PRs #332/#333/#334/#335/#336/#337 → main @ `9fcd1584`, CI green).

## Scope inventory

Changed source (main vs pre-epic `b85439c`), excluding tests:

- `packages/core/src/blob-store.ts`, `blob-store-legacy.ts` (content-addressed seam, #319)
- `packages/core/src/records/*` — new subsystem (RecordStore + canonical repos + projection, #323/#320)
- `packages/core/src/migrations/0017_attachment_blob_parity.ts` + `index.ts` (#320)
- `packages/core/src/shard/shard-signature.ts`, `shard-import.ts`, `types.ts`, `checksum.ts` (#324)
- `packages/core/src/repositories/{attachments,search,embedding-sets}-repository.ts` (#319/#320)
- `packages/core/src/tools/manage-attachments.ts`, `index.ts`; `packages/react/src/FortemiProvider.tsx`

## Findings (all auto-fixable, high-confidence)

| # | Severity | Doc claim (stale) | Code truth | Resolution |
|---|----------|-------------------|-----------|------------|
| 1 | medium | "16 numbered migrations" | 17 (`0017_attachment_blob_parity`, registered in `migrations/index.ts`) | Updated count + `0017` description |
| 2 | medium | Key Files table omits `records/` | 7-file canonical record layer (ADR-013, #323) | Added `records/` row |
| 3 | medium | Key Files table omits `blob-store.ts` | Content-addressed `BlobStore` over `@bytecask/core` + legacy migration | Added `blob-store.ts` row |
| 4 | low | shard row omits signing | `shard-signature.ts` Ed25519 verify-before-persist (ADR-014, #324) | Appended to shard row + Knowledge Shard architecture bullet |
| 5 | low | Architecture lacks blob-store / RecordStore bullets | Both are first-class subsystems (ADR-013) | Added two Architecture bullets |
| 6 | low | "1,061 core tests across 58 files" (×3 refs) | 62 test files; total is volatile | Reconciled to file count (62, verifiable) + `pnpm test:core` for live count — matches the repo's existing "don't hardcode" stance |

## Verified NOT drifted

- Repositories row: "11 data access repositories" is still accurate (the `records/` canonical repos are a separate, additive layer, not new `repositories/` entries).
- `capabilities/` "14 files" unchanged.
- Hooks reference (31 hooks) unchanged.
- `FortemiProvider` already documents `blobStore` in context.

## Files changed

- `CLAUDE.md` — 5 edits
- `AIWG.md` — 5 edits (mirror)

## Validation

- Main CI green on the merged code (sha `9fcd1584`: build, lint, typecheck, portable-contract, examples, unit-test, e2e all success).
- Doc edits are prose-only; no build/test impact.

Detailed evidence: this report. Marker: `.aiwg/.last-doc-sync`.
