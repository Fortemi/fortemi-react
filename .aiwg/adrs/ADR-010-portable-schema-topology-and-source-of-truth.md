# ADR-010: Portable-schema topology and schema source-of-truth

- **Status**: Proposed (pending review)
- **Date**: 2026-07-05
- **Issue**: #235 (audit epic)
- **Relates**: ADR-006 (public-API-first), ADR-009 (pluggable storage), `adr-backend-seam.md`; supersedes the R-002 mitigation in `SAD.md:450`

## Context

fortemi-react added two "portable schema" surfaces that were described and marketed as a single pipeline ("AIWG → React → server"). The 2026-07-05 audit (`.aiwg/reports/aiwg-portable-schema-audit-2026-07-05.md`) established that they are in fact **two independent contracts on two different hops**, each with a **different owner** and **no shared source of truth**:

1. **AIWG → React** — the AIWG Fortemi *index* (`aiwg.fortemi.index.export.v1/v2`). AIWG owns the generator (`aiwg/src/artifacts/browser-export.ts`) **and** a canonical JSON Schema (`aiwg/schemas/aiwg-fortemi-index-export.json`, `$id: https://aiwg.io/…`). Critically, **AIWG re-imports `@fortemi/core`'s `validateAiwgFortemiIndexExport` to validate its own output** — so fortemi-react's validator is the de-facto enforcement point for AIWG's generator.
2. **React ↔ Server** — the Knowledge *Shard* (`matric-shard` v1.0.0). The Rust server owns this authoritatively as hand-rolled `serde_json::json!` literals in `main.rs` (not derived from its own models). **The server has no AIWG-index support whatsoever.**

Observed failure modes traceable to the missing topology + source-of-truth:

- The schema is hand-maintained in **three** places (AIWG generator TS, AIWG JSON Schema, fortemi-react validator TS) and has already diverged (title/text required-vs-optional; `input_hash`; version-string naming). AIWG declares `@fortemi/core` as a dependency but **never imports it** — it reinvents the schema.
- fortemi-react's validator does not enforce the AIWG schema's v1/v2 field-forbiddance or enum constraints, so a real generator bug (audit A1) is invisible to both sides.
- The "100% format parity" claim has **no mechanical enforcement** — the `format-parity` suite guards PGlite table shapes, not either portable contract.
- There is no ADR or diagram explaining any of this; the SAD lists "schema drift" as an accepted risk with an ineffective mitigation.

## Decision

**1. Recognize and document the two-contract topology explicitly.** The index (AIWG↔React) and the shard (React↔Server) are separate contracts with separate owners, versions, and evolution cadences. There is no index↔shard bridge; the index is not a server sync format. A data-flow diagram is added to the SAD.

**2. Establish a single source of truth per contract, with generated conformance:**

- **Index contract**: AIWG's `aiwg/schemas/aiwg-fortemi-index-export.json` is the authority. fortemi-react's validator MUST be regenerated from, or conformance-tested against, that schema — not hand-maintained independently. Concretely: vendor the schema (or a pinned copy) into `@fortemi/core`, drive validation from it (AJV or generated guards), and add a CI check that fails when the vendored schema drifts from the upstream `$id` version. This closes A1/A2/A4/A5 by construction.
- **Shard contract**: the server's shard format is the authority. Because it is hand-rolled in `main.rs`, the shared artifact must be a **committed shard JSON Schema + golden fixtures** produced from a real server export, consumed by both sides. See ADR-011 for the shard specifics; this ADR ratifies the principle.

**3. The `format-parity` test suite is re-scoped and the R-002 mitigation is replaced.** `format-parity` remains the DB-table-shape guard (rename to reflect that). Two new conformance suites are introduced — index-vs-AIWG-schema and shard-vs-server-fixtures — and become the actual "if it breaks, nothing ships" gate. SAD R-002's mitigation is updated to point at these.

**4. Discovery-ranking parity gets an anchor.** `discoveryMatches` must be validated against AIWG's real `query-engine.ts` scorer via a golden cross-repo corpus test. The short-term implementation mirrors the pinned AIWG scorer semantics in `@fortemi/core`: exact-name and exact-trigger sentinels, near-name matching, stopword-stripped content phrases, the token-overlap gate, bounded 0-1 scores, and the same field weights. The preferred long-term shape remains a single shared scorer or a published ranking spec owned by AIWG and consumed by `@fortemi/core`; the local mirror is a regression gate until that package boundary exists (tracked under #240/#235).

## Consequences

**Positive:** drift becomes a CI failure instead of a production surprise; AIWG's reuse of the react validator becomes safe; the "parity" claim becomes true-and-tested; future versions have a defined home.

**Negative / cost:** vendoring + codegen adds build machinery; a cross-repo schema-sync CI check couples release cadences (mitigated by pinning + an explicit bump step); producing server-exported golden shard fixtures requires a fixture-refresh mechanism (ADR-011).

**Follow-on:** with a source of truth established, `aiwg-index.ts` (2168 LOC) can be decomposed along its natural seams (types/validation/chunked/discovery/semantic/controller/graph), extracting the schema-bound validation into the generated layer (audit D8).

## Alternatives considered

- **Keep three hand-maintained copies** (status quo) — rejected; drift already occurred and is undetected.
- **Make fortemi-react the schema authority** — rejected; AIWG owns generation and already publishes a JSON Schema with a canonical `$id`; inverting ownership would fork the ecosystem.
- **Codegen the shard format from the server's Rust models** — attractive but the server itself hand-rolls the shard separately from its models, so model-codegen would not match the shard; a committed schema + golden fixtures is the pragmatic authority (ADR-011).
