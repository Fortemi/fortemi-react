# ADR-015: Consume Fortemi's source-addressed live-persistence contract

- **Status**: Proposed (accepted on merge of the Fortemi-react #404 delivery PR)
- **Date**: 2026-09-03
- **Issue**: [Fortemi/fortemi-react#404](https://gitea.fortemi.com/Fortemi/fortemi-react/issues/404)
- **Producer issue**: [Fortemi/fortemi#1090](https://gitea.fortemi.com/Fortemi/fortemi/issues/1090)
- **Suite coordination**: [Fortemi/fortemi#1081](https://gitea.fortemi.com/Fortemi/fortemi/issues/1081)
- **Upstream authority**: `Fortemi/fortemi:contracts/source-note-upsert/contract.json`
- **Relates**: ADR-010, ADR-011, ADR-013

## Context

Browser PGlite and the canonical RecordStore already had item-centric source
metadata, but they did not consume a versioned server contract. They lacked a
batch replay journal, a shared fixture, and equivalent revision behavior. Route
presence and local tests therefore were not compatibility evidence.

This concern belongs to live persistence. The AIWG static index, Knowledge
Shard profiles, and live Fortemi persistence remain separate contracts. Source
identity is not added to `core-v1`, `full-v1`, or `record-v1` by this decision.

## Decision

`@fortemi/core` consumes `source-note-upsert/1.0.0` from the Fortemi authority.
Both PGlite and RecordStore expose the canonical request/response shape and run
the byte-identical authority fixture. The legacy item-oriented `upsertBatch`
entry point remains source-compatible; canonical `upsertRequest` responses do
not include its deprecated `outcomes` alias.

Identity is scoped by `(tenant, memory, source_namespace, external_id)`. Exact
batch replay is keyed by that scope plus `batch_id` and request digest. It
returns `duplicate`, converts material item outcomes to `unchanged`, and adds
no state or journal entries. A reused batch ID with different input is
rejected. Dry-run and validation rejection do not write.

PGlite migration 24 adds a scoped batch journal and disambiguates external run
IDs from internal scoped row IDs. Record schema 3 adds batch and revision
collections. Insert creates revision 1; `version` appends the new content;
`replace` changes original/current content without adding a revision; and
`conflict` is non-mutating. All RecordStore mutations and their journal entries
use one `applyBatch` commit.

Receipts contain content and identity digests, note IDs, counts, checkpoints,
and stable reason codes. They do not contain raw external IDs or note content.
The source identity table/collection remains the live lookup authority and may
store the raw key.

## Knowledge Shard boundary

Source identities remain outside all current Knowledge Shard profiles.
Existing PGlite and RecordStore exporters continue to emit the typed
`source-identity-outside-profile` loss when this live state is omitted. This is
not evidence of portable source identity, complete backup, full parity, or a
shared schema across planes.

## Compatibility evidence

The consumer pins the producer commit and fixture SHA-256 in
`packages/core/schemas/source-note-upsert/contract.receipt.json`. The fixture
must pass on clean PGlite and RecordStore destinations in CI. Completion
requires the Fortemi producer receipt, this consumer commit and CI run, and
linked issue evidence. The suite audit remains `NO-GO` for broader claims.

## Consequences

- Browser and server runtimes share exact request, outcome, replay, and policy
  semantics for this one named live-persistence contract.
- Record schema 3 is additive but requires IndexedDB store creation during the
  version upgrade; PGlite migration 24 is also additive.
- Consumers can resume bounded imports with checkpoints without duplicating
  notes, revisions, or journals.
- Static-index and Knowledge Shard compatibility claims remain unchanged.

## References

- @packages/core/src/repositories/source-upsert-repository.ts
- @packages/core/src/records/source-upsert.ts
- @packages/core/src/__tests__/source-upsert-contract.test.ts
- @packages/core/schemas/source-note-upsert/v1.conformance.json
- @.aiwg/architecture/SAD.md
