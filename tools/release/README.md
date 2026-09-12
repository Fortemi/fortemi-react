# Release Artifact Reproducibility

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
