# Documentation-Code Sync Audit

**Date:** 2026-07-29
**Direction:** code-to-docs
**Mode:** incremental, dry-run first
**Repository:** `/home/roctinam/dev/fortemi-suite/fortemi-react`
**Baseline:** `v2026.7.14` (`a08df8a6ece098d8bd5b2d27f3fbb7734b39e331`)
**Audited head:** `ccf96fad6025025293e40e250c85f088c8999d86`

## Scope

Audited changed files since the latest stable tag, current worktree/index
diffs, package metadata, platform-contract scripts, Knowledge Shard receipts,
README/changelog/release material, SAD, ADR-010/011, repository release
configuration, and the suite authority documents named by the suite
integration instructions. Runtime code, package versions, receipt bytes,
release artifacts, tags, and provenance were read as evidence only.

## Dry-run findings

1. The SAD described only revision 20 lineage and omitted the current revision
   21 advertisement and supported-platform aggregate.
2. ADR-011 stated the three required Unix cells but did not bind the passing
   aggregate, exact participants, Core package identity, or Windows story.
3. The schema README documented the reusable command but not run 6393, the
   packed Core digests, or Fortemi #1096.
4. Root README and overview text implied one normalized schema across server,
   browser, and HotM, contrary to the three-plane authority model.
5. The Core README did not expose the supported-platform evidence or explicit
   authority/consumer roles.
6. `CHANGELOG.md` had no entry for the post-tag platform-contract delivery.
7. v2026.7.14 release notes did not distinguish the published release from the
   later receipt-bound run using the same package version.

All seven findings were high-confidence and auto-fixable from executable
authority metadata and Gitea state.

## Applied reconciliation

- Named Fortemi as schema/API/runtime authority, React/Core as reusable
  conformance consumer, and HotM as application consumer.
- Bound supported evidence to Fortemi run 6393, exact participant revisions,
  `@fortemi/core@2026.7.14`, and both packed-artifact SHA-256 values.
- Limited the Knowledge Shard claim to exact `2.0.0/full-v1` and the three
  required cells: Linux x86_64, Linux arm64, and macOS arm64.
- Routed Windows validation to open deferred authority issue
  `Fortemi/fortemi#1096`.
- Preserved the `Fortemi/fortemi#1081` `NO-GO` decision and excluded
  suite-wide portability, complete backup, every platform/architecture,
  launched GUI/native-dialog coverage, and one universal schema.

## Changed files

- `.aiwg/architecture/SAD.md`
- `.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md`
- `.aiwg/reports/doc-sync-20260729-code-to-docs.md`
- `.aiwg/reports/doc-sync-last-run.json`
- `CHANGELOG.md`
- `README.md`
- `docs/content/overview.md`
- `docs/content/releases/v2026.7.14.md`
- `packages/core/README.md`
- `packages/core/schemas/README.md`

## Validation

- `pnpm --filter @fortemi/core verify:knowledge-shard-contract` — passed;
  confirmed revision 21 authority and immutable revision 20 lineage.
- `pnpm test:platform-contract-tools` — passed; 12 tests covered authenticated
  live consumption, supported-platform acceptance, receipt drift, broad-claim
  rejection, credential preflight, and receipt emission ordering.
- Targeted Python identity/claim validator — passed; matched the authority
  matrix, Core package identity and digests, exact required/deferred platforms,
  claim boundary, release manifest entry, and edited-doc evidence tokens.
- JSON syntax, finding/report bounds, and `git diff --check` — passed.

## Human review

- Confirm whether the next release should carry this post-v2026.7.14 evidence
  forward as a dedicated release-note section rather than retaining it only in
  `Unreleased`.
- Independent audit acceptance for Fortemi #1081 remains outside doc-sync and
  is intentionally unchanged.
