# Dataset execution capability contract

Status: implemented contract v1; runtime claims require implementation-specific
evidence.

`@fortemi/core` exposes a language-neutral descriptor and pure negotiation API
for dataset execution. A descriptor applies to one concrete runtime version. It
is never inferred from a backend name, method presence, process health, or the
Fortemi product family.

## Planes and authority

The contract distinguishes browser-local archives, static caches, portable
shards, server processes, and live remote persistence. It independently labels
their data as canonical, regenerable index, static cache, portable projection,
or remote persistence. Query success against a cache or shard is not evidence
that canonical data is current, available, authorized, or durably stored.

Live remote persistence remains alpha until a version-pinned live qualification
proves its advertised behavior. Fixture or mocked evidence cannot promote it to
stable.

## Negotiation

Callers supply required capabilities and optional capabilities. Requirements
may include a minimum semantic version and numeric limits. Required mismatches
return `accepted: false` with stable diagnostics before execution. Optional
mismatches return an explicit degradation naming any selected fallback and its
changed guarantees.

```ts
const result = negotiateDatasetExecutionCapabilities(descriptor, {
  contract: DATASET_EXECUTION_CONTRACT,
  required: [
    { id: 'ingest.full', minimumVersion: '1.0.0', minimumLimits: { maxBatchRecords: 100 } },
    { id: 'identity.record' },
  ],
  optional: [{ id: 'ingest.incremental', fallback: ['ingest.full'] }],
})
```

Negotiation is a pure function. It performs no connection probe, network load,
data mutation, checkpoint advancement, or fallback execution. Its result is
intended to be digest-bound into a separately approved processing plan.

## Evidence and consistency

Every supported or experimental capability references evidence declared by the
descriptor. The semantic validator rejects invalid evidence references,
duplicate capabilities, unsafe numeric limits, and inconsistent combinations.
For example, incremental ingest requires stable revisions and checkpoint
read/write; field lineage requires evidence-bearing relationships; hybrid
indexing requires lexical and vector indexing.

The JSON Schema, golden plane fixtures, and intentionally inconsistent semantic
fixtures are published under
`packages/core/schemas/dataset-execution-capabilities/`. Cross-repository
consumers should validate the same wire objects without renaming capabilities
or translating backend-specific aliases.

## Compatibility

Contract major `v1` and descriptor schema major `1` are the only accepted
majors. Additive capability identifiers or fields require a compatible schema
revision. Removing or changing an identifier, diagnostic, guarantee, or field
meaning requires a new contract major and explicit migration.
