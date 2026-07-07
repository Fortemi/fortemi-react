# ADR-011: Knowledge Shard server-conformance and version negotiation

- **Status**: Proposed (pending review)
- **Date**: 2026-07-05
- **Issue**: #235 (audit epic)
- **Relates**: ADR-010 (source-of-truth principle), server ADR-028 (shard archive migration system), server issue `Fortemi/fortemi#1013`

## Context

The Knowledge Shard (`shard/*`) is fortemi-react's interchange format with the Rust server, and the SAD lists "100% JSON format parity with the server" as a non-negotiable. The 2026-07-05 audit found this claim **false in both directions** and **untested**:

- The server owns `matric-shard` v1.0.0 authoritatively (`format:"matric-shard"`, bare-hex per-file SHA-256, `created_at_utc`→`created_at` rename). fortemi-react matches the envelope (`.shard`, tar.gz, filenames, format/version strings, checksum format — all verified correct).
- But entity field names and coverage diverge: attachments emitted as `binary_sources` not `attachments` (S1); `note.collection_id` and `link.to_url` never serialized (S2/S5); `template` and `embedding_config` entities unimplemented (S3/S4); `embedding_set`/`embedding_set_member`/`embedding` field sets diverge (S6–S8); import never persists attachment rows at all (E1). fortemi-react also emits 9 SKOS/provenance/graph components the server excludes (S9).
- `min_reader_version` is compared with a lexicographic string `>` rather than semver (S12/E5) — it will accept an incompatible future shard once any version segment reaches double digits.
- The `format-parity` suite validates DB table shapes, not the shard contract — **zero** shard conformance coverage.
- The server has a full migration/compat harness (ADR-028) with fixtures modeling future changes (`links→documents` rename, SHA256→BLAKE3); fortemi-react has no counterpart and never reads `migration_history`.

## Decision

**1. Align the shard entity contract to the server, field-for-field.** Concretely: rename `binary_sources`→`attachments`; serialize `note.collection_id` and `link.to_url`; implement `template` and `embedding_config` export/import; align `embedding_set`/`embedding_set_member`/`embedding` to the server field sets; and make import actually persist attachment rows. React-only components (SKOS/provenance/graph) remain as a **documented, optional superset** clearly namespaced so a spec-conformant server can ignore them without error — they are not part of the parity contract.

**2. Adopt a committed shard schema + server-produced golden fixtures as the conformance authority** (per ADR-010). A round-trip conformance suite MUST: (a) import a real server-exported `.shard` and assert every entity/field survives; (b) export a react `.shard` and assert it validates against the server shard schema; (c) run in CI. This replaces the mis-scoped `format-parity` guard for the shard surface.

**3. Implement real version negotiation.** Replace lexicographic version comparison with semantic-version comparison at both sites. Honor `min_reader_version` correctly; on an unsupported major, refuse import with a clear, actionable error rather than silently proceeding. Populate `migration_history`/`migrated_from` on export. Track the server's forthcoming shard changes (ADR-028 fixtures) so a v1.1/v2.0 server shard is handled deliberately.

**4. Converge the binary/attachment contract with the server.** react #227 (shipped, byte-free) and server #1013 (open) must share one specification: attachments are attached as a data source with extracted text; **raw bytes are never inlined into search/index/export/embedding-set projections**. Coordinate the fortemi-react attachment naming/serialization fix with the server #1013 canonicalization so both land against the same spec.

## Consequences

**Positive:** the parity non-negotiable becomes real and CI-enforced; server↔react shard exchange actually round-trips; version skew fails safe; the attachment contract stops diverging.

**Negative / cost:** implementing `template`/`embedding_config` and the missing fields is real work; a golden-fixture refresh path requires either a checked-in server export or a fixture-generation step tied to a server version; the superset components need a documented ignore/namespacing convention to avoid rejecting react shards at the server.

**Risk if deferred:** every day the claim ships unqualified, users lose attachments (E1), collection membership (S2), URL links (S5), templates/configs (S3/S4), and embedding interpretability (S8) on any cross-boundary shard exchange — silently.

## Alternatives considered

- **Drop the parity claim, treat the shard as react-only backup** — viable and honest, but forecloses the stated interchange use case ("import/export pipelines using Knowledge Shards instead of app-specific backup formats"). If chosen, the SAD non-negotiable and marketing must be corrected instead. This ADR assumes interchange is intended.
- **Generate the react shard mapper from the server Rust** — the server hand-rolls the shard separately from its models, so codegen-from-models would not match; committed schema + golden fixtures is the pragmatic authority.
