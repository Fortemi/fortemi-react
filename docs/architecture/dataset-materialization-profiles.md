# Dataset materialization and retrieval profiles

Fortemi Core treats indexes, chunks, vectors, extracted graphs, reranked results,
and communities as derived artifacts. They never establish source availability,
freshness, or canonical ownership. The canonical archive/dataset snapshot remains
immutable across every adapter call.

The public `fortemi.dataset-materialization-profile/v1` contract makes the
execution choice explicit and portable. It defines eight composable profile
kinds: chunking, lexical, vector, hybrid, rerank, entity/relationship extraction,
graph retrieval, and community materialization. A GraphRAG implementation such
as the optional backend proposed by #212 implements these contracts; it does not
become a dependency of `@fortemi/core` or gain write access to canonical state.

## Required execution sequence

1. Discover a versioned runtime capability descriptor.
2. Negotiate the requested profile and operation with
   `negotiateDatasetMaterializationProfile`. Required capabilities fail closed;
   optional capabilities and fallback profiles produce explicit degradation.
3. Authorize every source record. Filtering occurs before any content crosses
   the chunking, model-invocation, or index-persistence adapter boundary.
4. Give the adapter a detached snapshot and accept derived artifacts only.
5. Emit a materialization receipt binding dataset revision and source digests,
   processing run, schema identity, profile/configuration, implementation/model,
   runtime, privacy decision, affected incremental inputs, output digests/counts,
   and measured resources.

`executeDatasetMaterialization` enforces this ordering. A denied record is never
passed to an adapter, so it cannot enter chunks, embeddings, model prompts,
indexes, telemetry, or diagnostics. Privacy receipts contain record digests, not
record values.

## Incremental correctness and freshness

Incremental requests identify affected source revisions, record digests, and
chunk digests. `compareDatasetIncrementalParity` compares identities, chunks,
relationships, communities, aggregate digests, and deterministic order against
a full rebuild. A caller must not publish incremental output until this parity
gate passes. Staleness is determined from source/profile/model/configuration
digests, not timestamps.

For deterministic profiles, equal scores are ordered by stable logical identity
and digest. Retrieval responses name the actual backend and selected profile and
mark fallback or optional-capability degradation. Scores are explicitly scoped
to that implementation and are never represented as comparable across engines.

## Evidence and packaging

The strict Draft 2020-12 schema is exported at
`@fortemi/core/schemas/dataset-materialization/v1`. Eight fixtures cover
supported, unsupported, degraded, deterministic, nondeterministic, browser,
server, and external-adapter cases. The external adapter fixture is a small
contract cell suitable for #212 and declares derived-only output.

Benchmark evidence binds its corpus and revision, hardware, implementation/model,
profile/configuration, correctness receipt, freshness, and measurements.
`validateDatasetBenchmarkEvidence` rejects evidence produced before correctness,
against a stale revision, or with a universal scale claim. The bundled small
corpus record is contract evidence, not a product scale limit.

## Compatibility boundary

This contract composes with `fortemi.dataset-execution-capabilities/v1` and the
processing run IDs emitted by `fortemi.dataset-ingest/v1`. It does not replace
the Knowledge Shard authority defined by ADR-010/011, alter shard profiles, or
claim live-server qualification. Browser, server, WASM, and hybrid engines may
advertise only behavior backed by their own conformance evidence.
