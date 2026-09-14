# Local Workspace Test Efficiency

Parent d2321425f92c0cd9a5006113d04148c46b0c642c is merged through PR461 after
all11exact-head CI60800 gates passed. Main CI60809 remains a separate gate.

Cycle125's literal local workspace gate timed out at825seconds during Core.
Six suites repeatedly applied all migrations for each independent database.
Their setup now clones an immutable empty migrated schema, using the established
native full-v1 fixture pattern. All294original cases and test bodies are retained;
three new native tests check migration/vector availability, data/schema isolation
and independent close ownership. Every clone checks empty native, lineage,
archival and queue state and exact applied migration versions/names.

The297focused cases passed. Combined reported duration for the six existing files
fell from463197ms to150920ms; this is not a controlled performance benchmark.
The first driver failed before tests because it resolved TypeScript from the
wrong workspace package. That NOT_PASS is preserved separately.

A fresh literal workspace attempt still timed out at825118ms:108of110Core files
had completed summaries, but create-fortemi and native-full-v1-presence did not.
No complete Core summary or later Graph/React/example stage executed. This
remains NOT_PASS, not acceptance inferred from partial passing cases.

The installed Vitest BaseSequencer orders uncached files mainly by source size.
A small but expensive presence matrix can therefore start late. The new subclass
prioritizes that matrix and native-full-v1-public within their existing project
group, preserving every other file's relative order and inherited shard ownership.
All33sequencer/partition/progress regression tests passed. The complete110-file
fixed-root CI plan remains37/37/36, with the two long suites in different shards.
The new regression tests are included in the existing required CI tools step.

No production API, dependency, version, contract schema, authority pin, fixture
archive, coverage threshold, worker cap or deadline changed. Config identity
changes are explicit and must receive new source-bound execution and CI receipts.
Historical reports, failures and published assets are not rewritten.

Release notes and deployment guidance now describe this setup/scheduling behavior.
Full workspace acceptance after scheduling changes, build/typecheck, exact-head
PR/main CI, approved release-tag authority and actual registry/assets/mirror
verification remain required. No publication, broader issue closure, human/AI
quality or released producer/platform acceptance is asserted. The suite remains
NO-GO with separate core-v1/full-v1/record-v1 evidence boundaries.

Evidence: fortemi-suite/.aiwg/working/lane-b/evidence/lane-b-delivery-20260914-cycle126/.
References: @packages/core/vitest.config.ts,
@packages/core/scripts/bounded-suite-sequencer.mjs,
@packages/core/src/__tests__/helpers/migrated-test-db.ts,
@docs/content/advanced/deployment.md, @docs/content/releases/v2026.9.6.md.
