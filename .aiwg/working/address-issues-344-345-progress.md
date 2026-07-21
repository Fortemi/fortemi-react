# Progress: address-issues #344 #345

## Task contract
- Original request: `/goal address-issues` for Fortemi/fortemi-react #344 (legacy embedding shard compatibility) and #345 (knowledge-workspace semantic-upgrade browser + artifact validation).
- Completion criteria: each issue addressed — implementation, AL CYCLE comment, PR per issue (delivery: pr-required, CI green), or honest escalation. Merges are operator actions (self-merge harness-denied).

## Current status
- COMPLETE. PR #346 merged as `43dbb52`, followed by stacked PR #347
  as `fb891e1`; both issue-closing paths completed.
- Post-merge main CI at `9828c63` passed all 8 jobs, including the first
  examples E2E gate.
- No implementation, CI, merge, or tracker action remains.

## Completed steps
- [x] Threat preflight: both issues safe.
- [x] #344 fix: mapper defaults (chunk_index 0 / text '' / model NULL), optional ShardEmbedding fields, null-model set resolver, relaxed embedding schema. 3 regression tests. Bundled corpus.summaries.shard verified importing cleanly.
- [x] #345: bundled-shard conformance gate (7 tests, in test:portable-contract; job timeout 10→15), gallery browser smoke test (examples/playwright.config.ts + examples/e2e/knowledge-workspace.test.ts, new examples-e2e CI job), root @playwright/test devDep + examples:site:e2e script.
- [x] #345 side-finding fixed: schema drift for legacy links (to_url/metadata), members (embedding_id-only), embedding sets (slug/counts/etc.) — schema aligned to importer acceptance; importer unchanged.
- [x] Negative control: smoke test vs stale pre-fix site fails with the exact chunk_index banner; passes on branch.
- [x] Local verification: shard suite 163/163; typecheck + lint clean.

## Failed approaches (do not retry)
- `pnpm vitest run --root packages/core` — use `pnpm --filter @fortemi/core exec vitest run <files>`.
- Port 4321 locally is held by a stale serve-site process (pid 679993) serving /tmp/fortemi-premium (OLD code) — always run local examples e2e with EXAMPLES_E2E_PORT=4399. Do not kill the process (another session's).
- (carried) `git checkout main` — held by sibling worktree; merges/publishes — operator only.

## Key facts / decisions
- pnpm install prompts to recreate node_modules — run with CI=true and --no-frozen-lockfile when adding deps.
- @playwright/test at root resolved 1.58.2 = CI container v1.58.2-noble.
- Browser smoke test downloads ~23MB MiniLM from HuggingFace in CI (inherent to the semantic path).
- Schema principle established: validateShardArchive requires exactly what the importer requires.

## State references
- PRs: #346 (Closes #344), #347 (Closes #345, stacked on #346, merge order 346→347).
- Issue comments: #344/86313, #345/86393.
- Branches: fix/344-legacy-embedding-shard-import, test/345-knowledge-workspace-semantic-validation.

## Merge delivery (operator-authorized 2026-07-16)
- Merged: #346 (43dbb52) → #347 (fb891e1) → #338 (9828c63); branches deleted on remote.
- Issues #344 and #345 auto-closed via Closes keywords. bytecask#28 was already merged.
- DONE: main CI @ 9828c63 fully green (8/8 jobs). Goal complete — nothing outstanding.
- Port 5173 locally is held by an unrelated 'my-docs' dev server — run standalone e2e with E2E_PORT=5199.

## Release flow v2026.7.7 (goal 2: doc-sync + release)
- doc-sync code2doc: done, audit .aiwg/reports/doc-sync-audit-2026-07-16.md (merged in PR #348).
- Release prep PR #348 merged (15e99d0). v2026.7.6 tag cut at abeffa3, pushed both remotes; Gitea publish/demo/docsite all green. GitHub npm-publish for 7.6 FAILED (internal-registry bytecask dep, ENOTFOUND) — unrecoverable from that tag; 7.6 is internal-only, documented in changelog/notes.
- Recovery PR #349 merged (5013e09): @bytecask scope → public npmjs, core ^2026.7.5 (integrity verified identical, same maintainer). Full suite 1,139 green.
- v2026.7.7 tag re-cut at 5013e09, pushed origin + github (mirror main synced c207a9a→5013e09).
- DONE: v2026.7.7 fully released. Gitea 8/8 CI + publish + demo/docsite deploys green; GitHub npm-publish success; npmjs latest=2026.7.7 (all 3 pkgs); release entries on Gitea + GitHub. Goal complete.
- Key: local v2026.7.7 tag deletion was safe (never pushed); "never delete pushed tags" not violated.
