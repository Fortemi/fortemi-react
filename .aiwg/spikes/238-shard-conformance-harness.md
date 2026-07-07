# Spike #238 — Shard↔server round-trip conformance harness

**Status:** complete · **Epic:** #235 · **Refs:** audit `.aiwg/reports/aiwg-portable-schema-audit-2026-07-05.md` (§2 coverage gap, D4), ADR-010, ADR-011

## Problem (confirmed)

`packages/core/src/__tests__/format-parity/*` is documented as the "highest priority, if it breaks nothing ships" gate, but it validates **PGlite DB table row shapes** (`archive_id`, `visibility`, `revision_mode`, `is_pinned`) against server *database* fixtures. The Knowledge Shard JSON contract (`original_content`, `revised_content`, `starred`, `binary_sources`, …) never appears. **There is zero automated coverage of the shard↔server-shard contract**, so none of the S1–S9 / E1 breaks are caught. Fixtures were committed once (2026-03-22) with no regeneration path and no live server.

## Decision: committed JSON Schema (structural authority) + golden server fixtures (fidelity), layered

The spike question was *schema* vs *golden fixture*. The answer is **both, at different layers** — they catch different failure classes and have different CI cost:

| Layer | Authority | Catches | CI cost |
|---|---|---|---|
| **Structural** | Committed `knowledge-shard.schema.json` (vendored from the server contract, single source-of-truth per ADR-010) | Field renames, missing/extra fields, wrong types, enum breaks — the **S1–S9** class | Zero — no server, no network |
| **Fidelity** | Golden `.shard` fixtures produced from a real server `GET /api/v1/backup/knowledge-shard` at a pinned version | Semantic round-trip loss (E1 attachment drop, value mangling, ordering) — things a schema can't express | Zero at run time (fixtures are committed); non-zero at **refresh** time (needs the server) |

Rationale:

- A schema alone can't prove *fidelity* (import→export→import equality); golden fixtures alone drift silently and can't run in CI without a server. Layering gets both, and both run in CI with zero server dependency.
- ADR-010 makes the **schema** the single source of truth; the server publishes it, react vendors it. Golden fixtures are *derived* evidence, refreshed against a pinned schema version (ADR-011 version negotiation).
- Matches the codebase's existing direction: `validateAiwgFortemiIndexExport` is the analogous structural gate for the *index* contract (hardened in #239). The shard side needs the same.

## Minimal working proof (this spike)

Committed and CI-green, zero-dep, no server:

- **`packages/core/schemas/knowledge-shard.schema.json`** — the structural authority for the manifest + note component (the S1–S9 surface). Draft 2020-12. `additionalProperties:false` is what turns a field-rename into a hard failure.
- **`packages/core/src/__tests__/shard/shard-conformance.spike.test.ts`** — a compact JSON-Schema-subset checker driven by the committed schema, proving it:
  - accepts a conformant note + manifest;
  - **rejects a renamed field** (`content` instead of `original_content`) — the exact class `format-parity` misses;
  - rejects a missing required field, a wrong type, a bad `format` const, and a malformed checksum.

The compact checker is proof-scope only. The full implementation swaps in **AJV** against the *same committed schema* (see below) — this also settles the schema-driven-validation direction ADR-010 sets for the index side (#239 scope note).

## Backlog (full implementation)

Filed as follow-up issues **#255** (full schema + AJV + golden fixtures) and **#256** (rename `format-parity`, wire the ship gate):

1. **Vendor + complete the shard schema.** Extend `knowledge-shard.schema.json` to all 17 shard components (collections, tags, links, embedding_sets, skos_*, provenance_edges, graph_*, communities). Source it from the server's published contract; add a `matric_version` gate. Adopt **AJV** as the runtime validator (MIT; aligns with ADR-010's schema-driven end-state and would also back the index validator).
2. **Golden-fixture pipeline.** A script that pulls `GET /api/v1/backup/knowledge-shard` from a pinned server version into committed golden `.shard` fixtures; a round-trip suite: (a) import golden `.shard` → assert full-fidelity note/collection/link/embedding round-trip (catches E1); (b) export a react `.shard` → validate against the schema. Both CI-runnable off committed artifacts; refresh is a documented, server-gated manual step.
3. **Rename `format-parity` → `db-table-parity`** (or similar) and add a header comment stating it guards **PGlite table** shapes, not the portable shard/index contract. Wire the new shard-conformance suite + the index validator as the actual "nothing ships if it breaks" gate; update CLAUDE.md.

## SAD R-002

Rewritten (this branch) to point at the real conformance surfaces: the index validator (#239), this shard schema + proof (#238), and the two follow-up suites — instead of implying `format-parity` covers the portable contract.
