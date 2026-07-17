# ADR-010: Portable-schema topology and schema source-of-truth

- **Status**: Accepted
- **Date**: 2026-07-05
- **Accepted**: 2026-07-09
- **Amended**: 2026-07-17
- **Issue**: #235 (audit epic)
- **Relates**: ADR-006 (public-API-first), ADR-009 (pluggable storage), `adr-backend-seam.md`; supersedes the R-002 mitigation in `SAD.md:450`

## Context

fortemi-react added two "portable schema" surfaces that were described and marketed as a single pipeline ("AIWG -> React -> server"). The 2026-07-05 audit (`.aiwg/reports/aiwg-portable-schema-audit-2026-07-05.md`) established that they were **two independent contracts on two different hops**, each with a **different owner** and **no shared source of truth**:

1. **AIWG → React** — the AIWG Fortemi *index* (`aiwg.fortemi.index.export.v1/v2`). AIWG owns the generator (`aiwg/src/artifacts/browser-export.ts`) **and** a canonical JSON Schema (`aiwg/schemas/aiwg-fortemi-index-export.json`, `$id: https://aiwg.io/…`). Critically, **AIWG re-imports `@fortemi/core`'s `validateAiwgFortemiIndexExport` to validate its own output** — so fortemi-react's validator is the de-facto enforcement point for AIWG's generator.
2. **React <-> Server** — the Knowledge *Shard* (`matric-shard` v1.0.0). The Rust server owns this authoritatively as hand-rolled `serde_json::json!` literals in `main.rs` (not derived from its own models). The server has no native AIWG-index reader.

The 2026-07-17 amendment records a material topology change: AIWG now has a
source implementation that converts its v2 static index through
`@fortemi/core/aiwg-index` into a Knowledge Shard. This is an explicit bridge,
not a merger of contract ownership. The live Fortemi MCP storage adapter is a
third, independent persistence plane.

Observed failure modes traceable to the missing topology + source-of-truth:

- The schema was hand-maintained in **three** places (AIWG generator TS, AIWG JSON Schema, fortemi-react validator TS) and diverged (title/text required-vs-optional; `input_hash`; version-string naming). AIWG now loads the published `@fortemi/core/aiwg-index` boundary for shard conversion, but the schema ownership and package-release gates remain distinct.
- fortemi-react's validator does not enforce the AIWG schema's v1/v2 field-forbiddance or enum constraints, so a real generator bug (audit A1) is invisible to both sides.
- The "100% format parity" claim had **no mechanical enforcement** — the suite now named `db-table-parity` guards PGlite table shapes, not either portable contract.
- There is no ADR or diagram explaining any of this; the SAD lists "schema drift" as an accepted risk with an ineffective mitigation.

## Decision

**1. Recognize and document three data planes explicitly.** The static index
(AIWG -> React), Knowledge Shard interchange (PGlite/RecordStore <-> server),
and live MCP persistence (AIWG storage adapter -> server) have separate owners,
versions, and evolution cadences. The index-to-shard converter is the only
approved bridge between the first two planes. Its output is not server-compatible
until it declares a server-owned shard profile and passes a real destination
import gate. The MCP adapter is not part of that proof.

**2. Establish a single source of truth per contract, with generated conformance:**

- **Index contract**: AIWG's `aiwg/schemas/aiwg-fortemi-index-export.json` is the authority. fortemi-react's validator MUST be regenerated from, or conformance-tested against, that schema — not hand-maintained independently. Concretely: vendor the schema (or a pinned copy) into `@fortemi/core`, drive validation from it (AJV or generated guards), and add a CI check that fails when the vendored schema drifts from the upstream `$id` version. This closes A1/A2/A4/A5 by construction.
- **Shard contract**: the server's shard format is the authority. Because it is hand-rolled in `main.rs`, the shared artifact must be a **committed shard JSON Schema + golden fixtures** produced from a real server export, consumed by both sides. The React copy is a receipt pinned to an upstream revision and digest, not a forked authority. See ADR-011 for profiles and release gates.
- **Converter contract**: AIWG owns v2 source-record meaning and `@fortemi/core`
  owns the index-to-shard mapping. Both the AIWG source test and a smoke test
  against the actually published package are required. A generated archive is
  only a `core-v1` candidate until the server imports it without loss.

**3. DB-table parity is re-scoped and the R-002 mitigation is replaced.** `db-table-parity` remains the DB-table-shape guard only. Two conformance gates — index-vs-AIWG-schema and shard-vs-server-fixtures — are the actual "if it breaks, nothing ships" surfaces. SAD R-002's mitigation is updated to point at these.

**4. Discovery-ranking parity gets an anchor.** `discoveryMatches` must be validated against AIWG's real `query-engine.ts` scorer via a golden cross-repo corpus test. The short-term implementation mirrors the pinned AIWG scorer semantics in `@fortemi/core`: exact-name and exact-trigger sentinels, near-name matching, stopword-stripped content phrases, the token-overlap gate, bounded 0-1 scores, and the same field weights. The preferred long-term shape remains a single shared scorer or a published ranking spec owned by AIWG and consumed by `@fortemi/core`; the local mirror is a regression gate until that package boundary exists (tracked under #240/#235).

## Consequences

**Positive:** drift becomes a CI failure instead of a production surprise; AIWG's reuse of the React validator and converter has an explicit package boundary; compatibility claims become profile-scoped and testable; future versions have a defined home.

**Negative / cost:** vendoring + codegen adds build machinery; cross-repository schema, published-package, and destination-import checks couple release cadences (mitigated by pinning and an explicit bump step); producing server-exported golden shard fixtures requires a fixture-refresh mechanism (ADR-011).

**Follow-on:** with a source of truth established, `aiwg-index.ts` (2168 LOC) can be decomposed along its natural seams (types/validation/chunked/discovery/semantic/controller/graph), extracting the schema-bound validation into the generated layer (audit D8).

## Implementation

- @packages/core/src/shard/schema-validator.ts consumes the pinned Fortemi schema receipt and validates `core-v1` archives.
- @packages/core/src/__tests__/shard/schema-validator.test.ts verifies the receipt, authoritative corpus, strict formats, file/count coherence, references, and checksums.
- @packages/core/schemas/knowledge-shard.schema.receipt.json records the immutable upstream revision and digests.

## Alternatives considered

- **Keep three hand-maintained copies** (status quo) — rejected; drift already occurred and is undetected.
- **Make fortemi-react the schema authority** — rejected; AIWG owns generation and already publishes a JSON Schema with a canonical `$id`; inverting ownership would fork the ecosystem.
- **Codegen the shard format from the server's Rust models** — attractive but the server itself hand-rolls the shard separately from its models, so model-codegen would not match the shard; a committed schema + golden fixtures is the pragmatic authority (ADR-011).

## References

- @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md - Profile and enforcement requirements.
- @packages/core/schemas/knowledge-shard.schema.receipt.json - Pinned consumer receipt.
