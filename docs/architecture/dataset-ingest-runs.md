# Dataset ingest runs and checkpoint receipts

`@fortemi/core` implements `fortemi.dataset-ingest/v1` as a storage-neutral
execution contract. A processing plan binds the source revision, normalized
configuration, transformation profile, destination scope, rejection policy,
and reconciliation ceiling. Logical record IDs preserve continuity while
revision and content digests identify exact observations.

## Atomicity and idempotency

Each ordered batch is committed through `DatasetIngestStore.transact`. Record
effects, redacted rejection accounting, checkpoint advancement, and the run
receipt become visible together. The default key is derived deterministically
from the plan and batch; callers may supply a scoped key. Exact replay returns
the stored receipt. Reuse with different canonical request content fails with
`IDEMPOTENCY_CONFLICT`.

A lost response after commit is resolved with `resolveAmbiguousCommit`; callers
must not blindly retry a mutation whose outcome is unknown.

## Checkpoint and cancellation rules

Checkpoints are versioned, opaque to the executor, and scoped by tenant,
dataset, source binding, stream, and optional partition. A checkpoint advances
only after all accepted effects and the receipt have been verified. Foreign,
stale, regressing, or out-of-order checkpoints fail closed. Wall-clock time is
not used for ordering.

Cancellation is checked before and throughout batch preparation and immediately
before commit. Cancellation or a pre-commit failure exposes no partial state.
If the caller loses control after commit, the durable receipt remains the source
of truth even when the latest attempt is reported failed.

## Rejections and reconciliation

Fail-fast rejects the entire batch. Bounded-reject and DLQ modes commit accepted
records only while enforcing the configured ceiling. Receipts contain record
identity digests, optional safe locators, stable codes, and a fixed redacted
message—never validator-supplied text or raw rejected values.

Tombstones require reconciliation to be enabled, successful complete source
enumeration, and explicit approval when the planned count exceeds the plan's
threshold. Restoration is an ordinary later upsert with a newer revision.

`preview` and `connectionCheck` are pure: they calculate compatibility and
identity information but do not open a transaction, mutate records, write a
receipt, or advance state. Status can compare the last successful receipt's
source revision to the expected revision to distinguish current and stale data.
The bundled memory store is a deterministic local reference implementation;
live remote maturity remains subject to separate server qualification.
