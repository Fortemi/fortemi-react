# Doc-Sync Audit — 2026-07-23 (code-to-docs)

## Scope

Files changed since `v2026.7.12` through authoritative React `main`
`a51dc7ce85056ee159c645b1c34ede32511d9733`, centered on #379–#381.
Lanes audited: package/API documentation, SAD/ADR claims, release metadata,
package versions, and standalone documentation registration.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | info | Core README and SAD describe exact `2.0.0/full-v1` producer/persistence behavior with bounded cross-repository claims | Preserved |
| 2 | medium | API reference still said the authority receipt was pending and described only snapshot re-export | Documented delivered live production and the separate #382 advertisement gate |
| 3 | medium | ADR-011 still said schema-2 paths existed only for matrix testing while the delivered implementation receipt enables producer use | Corrected the implementation state without claiming external parity |
| 4 | info | Release metadata for the unpublished implementation boundary was absent | Added `v2026.7.13` changelog, release note, manifest registration, and standalone-doc registration |
| 5 | info | Workspace versions still identified the last published release | Advanced all lockstep package versions and exported constants to `2026.7.13` |

## Auto-fixed vs human-required

- Auto-fixed: findings 2–5; all are high-confidence factual release-boundary
  updates derived from delivered source and receipts.
- Human-required: none.

## Files changed

- `.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md`
- `.aiwg/.last-doc-sync`
- `CHANGELOG.md`
- `docs/content/api-reference.md`
- `docs/content/releases/v2026.7.13.md`
- `docs/manifest.json`
- `apps/standalone/src/data/project-docs.ts`
- root and workspace package manifests
- Core and Graph exported version constants

## Validation

- `git diff --check`
- JSON package and documentation manifests parse successfully.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:portable-contract` — 242/242
- `pnpm test:core` — 1,243/1,243
- `pnpm build`
- `tools/release/test-e2e.sh`
