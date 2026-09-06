# React 2026.9.1 release documentation audit

Direction: code-to-docs. Dry-run findings recorded before edits.
Scope: packages/**, apps/**, docs/**, README.md, CHANGELOG.md; changed-file inventory from v2026.9.0 through f64662bd, plus publication workflow implementation as supporting evidence. Working and staged diffs were empty.

Selected lane: release notes and changelog. Existing source-upsert API documentation and named-profile boundaries remain consistent with the unchanged contract implementation in this delivery.

Findings:
1. v2026.9.1 release notes omit #415 pack-once publication, registry SHA512 integrity and release-asset SHA256 verification. Auto-fix: add the implemented behavior without claiming an observed publication.
2. “Published Packages” implies publication already occurred, but origin has no v2026.9.1 tag. Auto-fix: name the intended packages and explicitly mark publication pending.
3. Historical source-upsert CI receipts remain relevant to that contract only; add current publication-workflow CI54367 without replacing their scope.

No API or schema changes proposed. No human review conflict found. Actual signed publication, registry bytes and npm provenance remain release gates.
