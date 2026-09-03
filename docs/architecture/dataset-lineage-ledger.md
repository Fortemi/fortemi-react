# Dataset lineage ledger

Status: implemented in `@fortemi/core`  
Contract: `fortemi.dataset-lineage/v1`  
Schema: `@fortemi/core/schemas/dataset-lineage/v1`

## Purpose

The dataset lineage ledger is the canonical, append-only authority for evidence-bearing relationships. Graph layouts, search indexes, communities, and interchange documents are derived projections. They may be deleted and regenerated; they must never become the sole copy of an assertion, correction, or evidence revision.

The native model is deliberately compact. W3C PROV and OpenLineage are adapter targets, not Fortemi's storage schema. This avoids silently collapsing Fortemi's record/field granularity, privacy labels, assertion kind, evidence identity, correction history, or loss accounting to the least expressive interchange format.

## Model

The v1 contract separates:

- entities: dataset, revision, distribution, record, field, chunk, index, embedding set, graph/community artifact, processing plan, and run;
- agents and processing activities;
- immutable evidence revisions, addressed by identity, revision, locator, and SHA-256 digest;
- directional assertions, including declared claims and observed execution evidence;
- append-only corrections, retractions, and supersessions; and
- bounded traversal results and regenerable projection loss receipts.

An assertion has a stable `id` and an immutable `revision`. A corrected assertion receives a new revision only after a correction record explicitly links the old and new revisions. Retraction and supersession likewise add records; no API rewrites or erases prior audit history.

Observed assertions require a producing activity and at least one evidence reference. Declared assertions remain distinguishable and cannot be presented as proof of execution. Evidence references bind the exact evidence revision and digest.

## Direction and influence

An edge is written from `sourceEntityId` to `targetEntityId`; the relationship kind preserves what that directed influence means. The validator enforces constrained endpoint pairs such as field-to-field derivation, chunk-to-record membership, and index-to-source indexing.

Direct field lineage (`field-derived-from`) is distinct from indirect effects:

- `join-influence`
- `filter-influence`
- `aggregation-influence`
- `ordering-influence`
- `similarity-influence`

Callers must not infer a Cartesian field mapping from run inputs and outputs. Emit explicit target-to-source mappings when they are known; otherwise record the narrower indirect influence that the evidence supports.

## Privacy-first traversal

`DatasetLineageLedger.traverse()` requires an authorization policy. It applies assertion and endpoint authorization before graph expansion, so a caller cannot infer a hidden node from an otherwise visible edge. Evidence is independently authorized before details are attached.

Every query must declare direction, maximum depth, total result bounds, and page size. Optional filters cover entity kind, relationship kind, assertion kind, snapshot, and evidence inclusion. Deployment ceilings default to depth 16, 10,000 results, and 500 rows per page.

Cursors bind the normalized request and snapshot. Reusing a cursor with different filters, direction, bounds, or snapshot fails. Nodes are cycle-safe and output ordering is deterministic. Callers retain `snapshot` with `nextCursor`; later writes do not change an older snapshot's result set.

The in-memory implementation is the reference semantics and conformance surface. Persistent adapters must preserve authorization-before-expansion behavior and must not claim live-server parity until the live persistence qualification gate is satisfied.

## Archive and projection

`exportArchive()` produces a deterministic canonical archive with a digest over every supported field. `importArchive()` verifies that digest before rebuilding and validating the ledger. A full-capability Knowledge Shard projection therefore produces a zero-loss receipt and round-trips all supported evidence semantically and field-for-field.

`project()` creates an explicitly non-canonical, regenerable representation. When an external target cannot represent an entity kind, relationship kind, assertion kind, evidence, or correction history, its loss receipt includes the canonical JSON pointer, reason, and digest. Consumers must not describe a projection with a non-empty receipt as lossless.

## Minimal use

```ts
import { DatasetLineageLedger } from '@fortemi/core'

const ledger = new DatasetLineageLedger({ maximumTraversalDepth: 8 })
// Append agents and entities before activities, evidence, and assertions.

const result = ledger.traverse({
  startEntityIds: ['field:customer-email'],
  direction: 'upstream',
  maximumDepth: 4,
  maximumResults: 1_000,
  pageSize: 100,
  includeEvidence: true,
}, {
  canReadEntity: entity => authorize(entity),
  canReadAssertion: assertion => authorize(assertion),
  canReadEvidence: evidence => authorize(evidence),
})
```

## Conformance expectations

Local and future live-server implementations compare identity, canonical digests, locators, assertion/relationship kinds, direction, confidence, privacy, ordering, cycles, bounds, snapshots, pagination, redaction, and projection receipts. The package suite exercises these semantics without asserting that a remote server is live or qualified.
