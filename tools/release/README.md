# Release Artifact Reproducibility

## Staged Local Workspace Acceptance

The local release gate executes these commands as separate bounded jobs, in this
order, in one clean committed owned worktree with the pinned package manager:

```bash
node tools/release/workspace-stages.mjs core-1
node tools/release/workspace-stages.mjs core-2
node tools/release/workspace-stages.mjs core-3
node tools/release/workspace-stages.mjs core-merge
node tools/release/workspace-stages.mjs consumers
node tools/release/workspace-stages.mjs verify
```

On Titan, launch each through the suite's detached local-test runner, one job at
a time. Keep its2CPU,8GiB,zero-swap,256-task,network/device/Docker restrictions and
900-second bound. The stage itself has an825-second deadline including discovery.
Do not run this sequence as a foreground bulk command or combine it into one
runner job. Other hosts must use their approved bounded execution environment.

The stages reuse the existing Core partition/merge implementation. Native reports,
blobs, progress and global coverage remain required. `consumers` builds Core,
tests/builds Graph, tests React and runs every example workspace with a test script.
Discovery and native JSON reports must match. Unsupported test-script changes
require review instead of being silently skipped. The original monolithic
`pnpm test:workspace` convenience command remains, but does not fit Titan's normal
job budget and is no longer the configured local release execution route.

Receipts under `test-results/local-workspace/` bind clean source, lock/config,
runtime, command sequence and native artifacts. `verify` requires every stage,
the unchanged79percent global statement threshold and all consumer reports.
Only its `complete.json` is aggregate workspace acceptance. Failed stages retain
their logs/failure records and prevent later acceptance. Do not overwrite or
delete them to force a retry: preserve the owned worktree/evidence, diagnose the
failure, and prepare a fresh owned run. A missing receipt is not a passing stage.

This is only the workspace gate. Typecheck, lint, full build, bounded release
browser acceptance, exact-head CI, stable UAT and publication verification remain
separate requirements. No test case, profile/platform requirement, shared service
or resource limit is removed by the staged route.

## Packed Artifacts

Both registry workflows build with the pinned toolchain, run `pnpm pack`, then
run `normalize-packed-manifest.mjs` on all three unpublished tarballs before
inspection, checksum creation, upload or publication. Publication consumes those
exact inspected files. Never normalize a published asset in place or overwrite
an immutable version to repair an older release.

pnpm 10.6.5 resolves workspace versions asynchronously when creating its exportable
manifest. The dependency object's insertion order can vary with completion order.
The [upstream manifest implementation](https://github.com/pnpm/pnpm/blob/v10.6.5/pkg-manifest/exportable-manifest/src/index.ts)
uses asynchronous dependency mapping before
[packing the serialized result](https://github.com/pnpm/pnpm/blob/v10.6.5/releasing/plugin-commands-publishing/src/pack.ts).
React2026.9.4 had identical JS/declarations/maps but differently ordered dependency
keys between the independently packed Gitea and public npm/GitHub artifacts.

The normalizer sorts only dependency/devDependency/optionalDependency/peerDependency
maps. It preserves values, array order and conditional `exports` order. The existing
locked `tar@7.5.13` parser is now an explicit development dependency; no runtime
package dependency changes. Repacking uses sorted file paths, portable headers,
fixed timestamps and gzip level9. Regular-file modes644/755 are preserved.
Input budgets are32MiB compressed,128MiB expanded,10000 files and1MiB manifest.
Unsafe paths, links, duplicates, unexpected modes/names and wrong versions fail
without replacing the original. Only a fully prepared owned temporary tarball is
renamed over the unpublished input; temporary extraction is removed on failure.

```bash
node --test tools/release/*.test.mjs
node tools/release/normalize-packed-manifest.mjs /owned/unpublished.tgz 2026.9.5
```

Tests cover opposite dependency orders, different entry order/timestamps,
idempotence, preservation of executable modes and payload, rejection without
mutation, and both workflow call sites before inspection. Use bounded hash/size
diagnostics for binary mismatches; raw Buffer assertion diffs can be expensive.

This fixes the observed packaging variation, not arbitrary compiler/toolchain
nondeterminism. Actual independently published registry/release bytes must still
pass `verify-published-artifacts.mjs` and the coordinated release readback. Semantic
metadata equality is not exact artifact equality. Package reproducibility is not
native restore/runtime/platform conformance; named-profile evidence and suite
NO-GO remain unchanged. A new qualified release is required for changed artifacts.

## Immutable Release Assets

`create-repo-release.mjs` validates local packages before creating a release.
For an existing release, it checks every same-named asset before uploading any
missing asset. Identical bytes are preserved; mismatches, duplicate asset names,
failed downloads and oversized responses abort without remote mutation. Neither
publisher deletes or replaces an asset. A conflict requires a new version, not
an overwrite of a previously published package or checksum manifest.

Existing-asset comparisons use a20-second request deadline, enforce the expected
byte length while reading, and emit bounded SHA-256/size diagnostics. Local
packages must be regular files no larger than32MiB. The subsequent publication
verifier remains required, including after resuming an incomplete upload.
Regression tests exercise both GitHub and Gitea create/reuse/resume paths and
fail-before-mutation behavior; they do not perform live publication.
