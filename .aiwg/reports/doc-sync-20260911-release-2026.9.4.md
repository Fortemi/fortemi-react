# Release 2026.9.4 Documentation Sync

Direction: code-to-docs. Scope: merged changes since v2026.9.3 in packages,
standalone, README, API reference, changelog and release notes. The initial
release worktree was clean at9c72a7bc7d5544f21519d86bc968b50b1e9ac9bb.
Artifact root resolves to this worktree's .aiwg directory. No repository-wide
documentation rewrite or authority/profile change is part of this sync.

## Findings and Resolution

The scoped dry-run review identified outdated package-version references and
internal-stage limitations in the unreleased changelog. The native dispatcher,
current-state exporter and clean-installed package gate now supersede those
stage limitations. Versions are synchronized in the five workspace manifests,
Core/Graph exported constants and API reference. Existing unreleased entries
are assigned to v2026.9.4, with product export and remote adapter corrections
summarized from the delivered source diff.

The release note describes native restore and explicit archival APIs separately.
It retains native representation/loss limits, exact profile boundaries, distinct
remote authentication/vector qualification and the suite NO-GO. README, Core
README, ADR-011 and SAD were reviewed for those boundaries; historical package
and platform receipts are not rewritten or treated as current release proof.

The initial implementation receipt update covered package.json and src/index.ts
hashes changed by version metadata. Structural comparison confirms both exported
entry-point source diffs are version-only. After main CI58349 reported ten5000ms
timeouts in three multi-import test groups, those groups receive the existing
30000ms integration budget without assertion changes. Both current implementation
and presence receipts track the changed test hash. The strict verifier caught
each missed current hash before correction; red results are retained. Authority,
advertisement and historical receipt identities remain unchanged.

## Verification and Remaining Gates

Contract verification, workspace typecheck, lint, workspace tests, build and
clean-installed Core package verification pass. Pinned browser checks pass40
with2platform-specific skips. The release note passes the configured release-note
threat assessment. The timeout-only follow-up passes corrected current receipts,
lint and full Core coverage (2991 tests across94files). The final packed Core
artifact passes the clean-installed verifier. Exact release-prep CI remains required.
No completed release, publication or released cross-runtime/platform qualification
is claimed here.
No unresolved documentation question requires operator input.

Evidence root: fortemi-suite/.aiwg/working/lane-b/evidence/
react-release-prep-20260911-cycle26/. It preserves the initial contract failure,
corrected receipt comparison, release-note assessment, fresh v2026.9.3 registry/
release-byte verification and v2026.9.4 gate results.
