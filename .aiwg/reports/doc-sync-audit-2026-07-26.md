# Doc-Sync Audit — 2026-07-26 (code-to-docs)

## Scope

Files changed since `v2026.7.13` through signed React candidate
`c8e32fc74a9332451d03f529c1d0f84a46be21d7`, centered on #354, #355,
#382, #393, and #394. Lanes audited: package/API documentation, Knowledge
Shard SAD/ADR claims, immutable receipts, release metadata, package versions,
standalone documentation registration, and supply-chain controls.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | info | SAD, ADR-010, ADR-011, Core README, schemas README, and receipts already name exact profiles and bound cross-repository claims | Preserved |
| 2 | info | AIWG `core-v1` hierarchy and tombstone semantics were implemented but unpublished | Added bounded `v2026.7.14` release metadata |
| 3 | info | Current PGlite, RecordStore, and Fortemi executable cells were delivered after the prior release | Included their immutable receipt scope without claiming the two pending AIWG cells |
| 4 | medium | Git wrappers depended on a removed plaintext handoff despite healthy encrypted project credentials | Documented the fail-closed systemd-credential bootstrap delivered by #394/#396 |
| 5 | info | Workspace versions still identified the prior public release | Advanced all lockstep package versions and exported constants to `2026.7.14` |

## Claim audit

- Static AIWG index, AIWG-to-shard bridge, and live Fortemi persistence remain
  separate planes.
- Knowledge Shard claims name `core-v1`, `record-v1`, or `full-v1`.
- The release does not claim that the pending AIWG-to-PGlite or
  AIWG-to-Fortemi cells are complete.
- The release does not claim unqualified full portability, complete backup, or
  suite parity.

## Files changed

- `.aiwg/.last-doc-sync`
- `.aiwg/reports/doc-sync-audit-2026-07-26.md`
- `CHANGELOG.md`
- `docs/content/releases/v2026.7.14.md`
- `docs/manifest.json`
- `apps/standalone/src/data/project-docs.ts`
- `packages/core/scripts/generate-record-v1-self-fixture.mjs`
- root and workspace package manifests
- Core and Graph exported version constants

## Validation

- `git diff --check`
- package and documentation manifests parse successfully
- lockstep version and release-tag dry-run checks
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:portable-contract`
- `pnpm test:core`
- `pnpm build`
