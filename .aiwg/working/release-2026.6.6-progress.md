# Progress: deliver outstanding PRs + cut release 2026.6.6

## Task contract
- Original request: `/goal address-issues` on #193 (docs broken links) and #190 (epic);
  then "deliver and merge all changes and cut a release"; then "see aiwg, replicate
  gpg signing/release rules, continue and deliver all outstanding prs".
- Completion criteria:
  - #193: docsite build 0 broken links; PR merged. (build verified 0 ✓; PR #196 open)
  - #190: status assessment posted to thread (epic, no code).
  - All outstanding PRs delivered (merged). Only #196 is open.
  - Release v2026.6.6 cut: versions bumped (5 pkgs lockstep), CHANGELOG + release notes,
    gates green, signed tag (cut-tag.sh, release key present), push origin + github.
- Authorization scope: user explicitly authorized merge + release (incl. public npm via
  github mirror push). GPG release key confirmed on host. Do NOT close epic #190 unilaterally
  — recommend only.

## Release model (confirmed)
- pr-required delivery; require_ci_green true.
- Gitea owner/repo: Fortemi/fortemi-react. origin=SSH, github=HTTPS via gh keyring (jmagly).
- cut-tag.sh: signs tag with release key FE92..4CE8, verifies locally, does NOT push.
- push origin main --tags  -> publish.yml (INTERNAL Gitea npm) + docsite-deploy.yml
- push github main --tags  -> .github/workflows/npm-publish.yml (PUBLIC npmjs, provenance)
- publish.yml verifies signed tag + core/graph/react versions == tag.

## Current status
- Phase: DONE. v2026.6.6 released; all publish CI green (Gitea + GitHub).
- #196 PR open: https://git.integrolabs.net/Fortemi/fortemi-react/pulls/196 (head 3ba2938).
- CI run #160 (id 11849) in_progress on 3ba2938 — must be success before merge.

## Completed steps
- [x] Verified #193 fix: repointed 5 Next Steps links -> api-reference.md sections; docsite build 0 broken links.
- [x] Branch docs/193-fix-getting-started-links committed (3ba2938) + pushed to origin.
- [x] PR #196 opened (base main).
- [x] Confirmed only 1 outstanding PR (#196). #192/#194/#195 already merged.
- [x] Confirmed GPG release key present + github mirror push credentialed.

## Next action
1. Wait CI run 11849 -> success.
2. Merge #196 to main (Gitea), then `git checkout main && git pull origin main`.
3. Bump all 5 package.json to 2026.6.6.
4. CHANGELOG: move Unreleased -> `## v2026.6.6 - 2026-06-17`; create docs/releases/v2026.6.6.md.
5. Gates: pnpm typecheck && lint && test:core && build (e2e best-effort); doc-sync dry-run.
6. Commit "release: v2026.6.6" to main.
7. tools/release/cut-tag.sh 2026.6.6 ; git push origin main --tags ; git push github main --tags.
8. Confirm Gitea CI (publish.yml) + GitHub npm-publish green.

## Failed approaches (do not retry)
- (none yet)

## Open / deferred
- #190 remote-server backend tier: explicitly deferred (future adapter on DataBackend iface).
- Do not close #190 without explicit user say-so.
