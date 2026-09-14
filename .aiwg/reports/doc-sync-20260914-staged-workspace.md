# Staged Workspace Documentation Sync

Direction: code-to-docs. Resolved artifact root is this worktree's `.aiwg`.
Scope: changed local release/configuration tooling, deployment checklist,
release note, changelog and release README. No API/provider/schema audit expansion.

## Dry-Run Review

The bounded doc-sync skill was discovered and loaded. Git status, unstaged/staged
inventories and scoped command references were inspected. Implementation and its
initial documentation edits already existed before this report-only review.
No further command drift was found: the configured route and README list all
three Core partitions, global merge, consumers and final verification in order.
The original monolithic convenience command is explicitly distinguished from
the new release route. Remaining typecheck/lint/build/browser/CI/UAT/publication
requirements are retained; this is not a narrower release acceptance definition.

## Implementation And Validation

The runner reuses existing Core partition and global-coverage machinery, binds
clean source/lock/config/runtime and artifact identities, and executes consumers
with dynamic example-workspace discovery. Every native report/file/case is
validated. Missing/duplicate stages, interrupted commands, altered Core commands,
incomplete artifacts, changed consumer inventory and sub-threshold global
coverage fail closed. Each stage retains an825-second deadline; Titan runs each
stage in a separate ordinary detached900-second job with unchanged resource and
isolation limits. No new controller or host-service access was introduced.

Only the existing locked js-yaml4.1.1 package is exposed as a root development
dependency for structured configuration tests. Frozen offline installation and
structured lock comparison pass; no package resolution/integrity changed.

Current local tooling:110release-tool cases and36Core tooling cases PASS, zero
failures/skips, root lint PASS. The19new cases include a real small workspace:
three native Core partitions and merged100percent coverage, Graph/React dependency
build checks, two example test projects, and explicit rejection of tampered
coverage/receipts or omitted consumers. Two earlier fixture runs failed because
pnpm's generated binaries could not resolve the missing linked virtual store;
the fixture link was corrected without changing acceptance assertions. Failures
remain in suite Cycle128 evidence. These small fixtures are not the real full
workspace acceptance run.

## Remaining Gates

Run all real workspace stages at one clean signed source and verify the aggregate.
Then require exact-head PR/main CI and remaining release/UAT/publication/registry/
mirror verification. A failed stage is NOT_PASS and retains evidence; no identical
retry, deadline increase, shared-service use or partial acceptance follows.
Named profile/platform and human-evaluation boundaries remain unchanged.

Evidence: suite lane-b-delivery-20260914-cycle128/tools-validation.json.
Previous broader report: doc-sync-20260913-release-2026.9.6.md, preserved unchanged.
