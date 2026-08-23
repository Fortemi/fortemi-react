# Doc Sync Report - 2026-08-23 Code-to-Docs

**Direction:** code-to-docs
**Mode:** incremental release-prep
**Repository:** `/home/roctinam/dev/fortemi-suite/fortemi-react`
**Baseline:** `v2026.7.15`
**Target release:** `v2026.8.0`

## Scope

- Changed Core source import/search/purge files and receipts.
- Public package docs: `README.md`, `packages/core/README.md`.
- API docs: `docs/content/api-reference.md`.
- Release docs: `CHANGELOG.md`, `docs/content/releases/v2026.8.0.md`,
  `docs/manifest.json`, and embedded standalone project docs.

## Findings And Fixes

1. Source-addressed upsert APIs were exported but undocumented.
   Added `SourceUpsertRepository` and RecordStore source-upsert coverage.
2. Typed metadata predicates and safe evidence locators were implemented but
   absent from search docs. Added allowlisted predicate paths and locator
   behavior to API docs and package summaries.
3. Terminal purge preview/receipt APIs had no public documentation. Added
   PGlite and RecordStore lifecycle purge documentation.
4. `core-v1`/`record-v1` source identity export behavior needed an honest
   portability statement. Added typed `source-identity-outside-profile` loss
   coverage and retained the suite `NO-GO` claim boundary.
5. Release prep was still on the July line. Current month is August 2026, no
   `v2026.8.*` tags exist, so the stable target is `v2026.8.0`.

## Files Changed By Doc Sync

- `CHANGELOG.md`
- `README.md`
- `packages/core/README.md`
- `docs/content/api-reference.md`
- `docs/content/releases/v2026.8.0.md`
- `docs/manifest.json`
- `apps/standalone/src/data/project-docs.ts`
- package manifests and public `VERSION` constants for `2026.8.0`

## Validation

- `pnpm --filter @fortemi/core typecheck` - passed
- `pnpm --filter @fortemi/core verify:knowledge-shard-contract` - passed
- `pnpm typecheck` - passed
- `pnpm lint` - passed
- `pnpm test:core` - passed, 74 files / 1,261 tests
- `pnpm build` - passed
- `tools/release/test-e2e.sh` - passed, 28 tests / 2 skipped
- `git diff --check` - passed

## Human Review

- Gitea CI cannot be evaluated until a release commit is pushed.
- Release tag signing is blocked in this shell: Vault authentication succeeds
  for the Git push key, but release-signing key fetch returns HTTP 403.
