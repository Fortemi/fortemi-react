# AGENTS.override.md

## Suite Data Integration Contract

Treat `.aiwg/architecture/SAD.md` and ADR-010/011 as the integration authority
for this repository.

- Keep the AIWG static-index, Knowledge Shard, and live Fortemi MCP persistence
  planes separate. Connect planes only through an explicit, tested adapter.
- Do not claim "full", "100%", or server parity without naming a shard profile
  and its passing cross-repository evidence.
- The Fortemi server owns the Knowledge Shard schema. The vendored React schema
  is a revision-and-digest-pinned receipt, not an independent source of truth.
- Validate schema, version, profile, checksums, records, counts, and sidecars
  before any PGlite or RecordStore mutation. Unsupported required components
  fail closed.
- `full-v1`, `core-v1`, and `record-v1` have different loss
  budgets. RecordStore support is an explicit subset unless its profile says
  otherwise.
- Changes to shard or AIWG conversion behavior require source tests, the
  published-package boundary test where applicable, and real producer/consumer
  import evidence before release.
