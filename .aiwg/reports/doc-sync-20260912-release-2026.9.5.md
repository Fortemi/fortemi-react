# Release 2026.9.5 Documentation Reconciliation

The five lockstep release manifests (root, Core, Graph, React, standalone) and
both exported VERSION constants target2026.9.5. Private example/docsite scaffolds
retain their existing0.0.0 versions. The API reference, changelog and release
note agree. No dependency, lockfile, wire-schema, fixture or authority-pin change.
The current implementation receipt refreshes only the Core package manifest and
export-module hashes affected by the version bump; historical receipts remain.

The release base is PR449 merge7d8a28e56fbceb80ffdbed2b6ae65df08c71843e.
CI58989 passed all11 gates,98 Core files/3126 tests and89.25-percent statements,
plus87 Graph and43 React tests, browser acceptance and installed package checks.
These base-source results do not replace final release-source CI and main gates.

Release content includes capability wire/SemVer validation, pinned producer
replay fixtures, deterministic packing, immutable publication checks and bounded
coverage orchestration. It excludes the uncommitted1091/405 search candidate.
No published-server tag-exclusion repair, hosted authorization, vLLM, ingestion,
cross-runtime full parity or broader issue closure is claimed.

Final-source tests, clean-installed artifacts, separate release-tag authority,
internal/public registry and release/mirror byte verification remain required.
The local Docker-based release browser helper is not invoked on the workstation;
the designated CI browser gate remains required. Named profiles and suite NO-GO
are unchanged. Existing published2026.9.4 assets must not be replaced.

References: @docs/content/releases/v2026.9.5.md, @CHANGELOG.md,
@docs/content/advanced/deployment.md, @.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md.
