# Doc-Sync Audit — 2026-07-16 (code-to-docs)

## Scope
Files changed since the v2026.7.6 release merge (`abeffa3..main`, 18 files): the
#344 legacy-shard importer fix (PR #346), the #345 validation gates (PR #347),
and the #338 context-doc sync. Lanes audited: project context docs
(CLAUDE.md/AIWG.md), README, docs/content.

## Findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | medium | Test-file count stale (62 → 63 after `bundled-example-shards.test.ts`) in 3 places per context file | Fixed in CLAUDE.md + AIWG.md |
| 2 | medium | New `examples/e2e/` surface (built-gallery smoke test, `examples:site:e2e`) undocumented | Added to Testing + Development Commands in both context files; README dev snippet |
| 3 | medium | Legacy React shard import compatibility (#344) — new architectural guarantee undocumented | Added to Knowledge Shard architecture bullet in both context files |
| 4 | low | `Current version: 2026.7.4` stale (released is 2026.7.6) | Fixed in both context files |
| 5 | info | New CI jobs (`examples-e2e`, portable-contract additions) | Covered implicitly by Testing section; CI jobs are not otherwise enumerated in context docs — no change |
| 6 | info | docs/content: no drifted claims; release notes are historical records | No change |

## Auto-fixed vs human-required
- Auto-fixed: findings 1–4 (high-confidence factual claims).
- Human-required: none.

## Files changed
- CLAUDE.md, AIWG.md, README.md

## Validation
- `pnpm lint` (markdown files not linted by eslint config; no code touched)
- Claims spot-verified: `find packages/core/src/__tests__ -name '*.test.ts' | wc -l` → 63
