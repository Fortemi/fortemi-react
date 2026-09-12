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

## Validation revision 1.0.1

Core remains the capability semantic authority (original #408, correction
[#422](https://git.integrolabs.net/Fortemi/fortemi-react/issues/422)).
Fortemi's MCP adapter is a consumer of those semantics and a producer of concrete
runtime descriptors; its server-owned execution/receipt envelopes remain separate.
Coordinate adoption through
[Fortemi #1128](https://git.integrolabs.net/Fortemi/fortemi/issues/1128) and the
declared AIWG consumer before claiming cross-runtime conformance.

The historical v1 schema and golden fixtures are retained unchanged. The corrected
validation schema and language-neutral negotiation vectors live in
`schemas/dataset-execution-capabilities/validation/1.0.1/`. This is a validation
revision, not a new wire contract or runtime maturity claim.

Version comparison follows [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html):
prereleases sort below their stable release, numeric identifiers compare
numerically, numeric identifiers sort below text, and build metadata is ignored.
The validation profile rejects noncanonical syntax, leading zeros in core or
numeric prerelease identifiers, versions longer than256 characters, and core
integers above Number.MAX_SAFE_INTEGER. Numeric prerelease identifiers are
compared exactly as decimal strings, without lossy Number conversion.
Stable schema major1 revisions with the accepted structure remain compatible;
schema prereleases and other majors are unsupported. Runtime/capability
prereleases remain valid when their minimum-version comparison succeeds.

`negotiateDatasetExecutionCapabilitiesFromWire(descriptor, request)` is the
public unknown-JSON boundary. It validates both objects against the corrected
JSON Schema and semantic rules before negotiation. Invalid input returns
`{ valid: false, diagnostics }` with no typed result or invented runtime.
Valid input returns `{ valid: true, result }`; check `result.accepted` separately
because a valid request can still ask for an unavailable capability.

The existing typed negotiator also validates structure and fails closed.
Callers already validating against the historical schema did not expose the
unknown-status defect; malformed unvalidated statuses no longer count as support.
Malformed optional requirements reject validation rather than being converted
into a fallback. Valid optional mismatches retain explicit degradation.
No validation or negotiation call performs network I/O or execution.

Source tests do not qualify the server, published package, AIWG consumer, or
live DatasetWorkflowApi adapter. Revision/source/digest pins and those independent
acceptance receipts remain required before issue closure or release claims.
