# Progress Timer Correction

PR462 failed the unchanged real five-second Vitest interruption test in both
CI60818 and CI60821: the last recorded phase was module-start, not beforeEach-start.
Serializing tooling tests did not resolve the failure. Local Node24 with CI=true
passed, so neither file contention nor the CI flag is an established cause.

The pinned @vitest/runner4.1.1 throttle used a strict greater-than comparison at
100ms and retained an expired timer handle when the callback did not flush.
A deterministic probe of the installed function reproduced lost updates at
exactly100ms and an early99ms timer, while101ms passed. This demonstrates the
dependency defect; the remote timer's exact firing time was not instrumented.

The scoped pnpm patch accepts the exact boundary and clears the expired handle
before re-entry. Three installed-function cases verify exact/late delivery,
early re-arming, receiver/argument preservation and no duplicate trailing timer.
All33existing tooling tests and the unchanged real interruption assertion remain.

The first offline resolving install stopped on absent graphology-types metadata;
a disposable lockfile probe also stopped on stale runner metadata. Neither was
a test pass. The targeted lockfile edit was structurally compared with the old
lock: all package versions, integrity values, importers and unrelated edges are
unchanged. Only the patch identity and runner snapshot/reference differ.
Native pnpm10.6.5 accepted the patch with --offline --frozen-lockfile and skipped
resolution; no downloads or lifecycle scripts were enabled.

Bounded local validation:36/36tooling cases and root lint pass. The fixture
source is still under PR review; exact-head CI, the complete scheduled workspace
gate, release/publication and broader lane acceptance remain required.

Source: https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/runner/src/run.ts#L466
Suite evidence: lane-b-delivery-20260914-cycle127/reproduction.json and
frozen-patch-validation.json. Historical failed receipts are preserved.
