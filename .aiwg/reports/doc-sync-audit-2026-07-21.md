# Doc-Sync Audit — 2026-07-21 (code-to-docs)

## Scope

Files changed since `v2026.7.11` (`v2026.7.11..main`, 17 files), centered on
#317's static AIWG index package boundary. Lanes audited: package README,
`docs/content`, release metadata, and release operations configuration.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | info | `packages/core/README.md` already documents the static and shard-converter subpaths accurately | No change |
| 2 | medium | API reference did not identify the explicit shard-converter boundary or profile | Added the `aiwg-index-shard` import and `core-v1` scope |
| 3 | medium | Integration guide did not explain how build pipelines keep shard dependencies out of static bundles | Added a build-oriented converter example and boundary guidance |
| 4 | medium | Release checklist omitted `@fortemi/graph`, used the old release-note path, and bypassed the required origin push wrapper | Corrected version targets, paths, gates, and tag push commands |
| 5 | medium | Release config named a stale origin owner and used broad raw tag pushes | Corrected the origin and restricted both pushes to the release tag |
| 6 | info | Historical release notes describe their published package boundaries | Preserved unchanged |
| 7 | info | `v2026.7.12` release metadata was required for the audited source change | Added changelog section, release note, manifest, and standalone-doc registration |
| 8 | medium | Host inotify saturation and Docker's default descriptor limit prevented the release E2E wrapper from starting Vite | Enabled container polling, set an explicit `nofile` limit, and documented the release verification |

## Auto-fixed vs human-required

- Auto-fixed: findings 2–5, 7, and 8 (high-confidence factual and operational updates).
- Human-required: none.

## Files changed

- `.aiwg/release.config`
- `CHANGELOG.md`
- `docs/content/api-reference.md`
- `docs/content/guides/integration.md`
- `docs/content/advanced/deployment.md`
- `docs/content/releases/v2026.7.12.md`
- `docs/manifest.json`
- `apps/standalone/src/data/project-docs.ts`
- `tools/release/test-e2e.sh`

## Validation

- JSON manifests and package metadata parse successfully.
- Version and release-note consistency are checked by
  `tools/release/cut-tag.sh 2026.7.12 --dry-run`.
- Repository typecheck, lint, tests, build, and release E2E gates run before the
  release tag is created.
