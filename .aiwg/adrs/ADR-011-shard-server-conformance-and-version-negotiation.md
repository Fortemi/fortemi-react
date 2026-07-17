# ADR-011: Knowledge Shard server-conformance and version negotiation

- **Status**: Accepted
- **Date**: 2026-07-05
- **Accepted**: 2026-07-09
- **Amended**: 2026-07-17
- **Issue**: #235 (audit epic)
- **Relates**: ADR-010 (source-of-truth principle), server ADR-028 (shard archive migration system), server issue `Fortemi/fortemi#1013`

## Context

The Knowledge Shard (`shard/*`) is fortemi-react's interchange format with the Rust server, and the SAD lists "100% JSON format parity with the server" as a non-negotiable. The 2026-07-05 audit found this claim **false in both directions** and **untested**:

- The server owns `matric-shard` v1.0.0 authoritatively (`format:"matric-shard"`, bare-hex per-file SHA-256, `created_at_utc`→`created_at` rename). fortemi-react matches the envelope (`.shard`, tar.gz, filenames, format/version strings, checksum format — all verified correct).
- But entity field names and coverage diverge: attachments emitted as `binary_sources` not `attachments` (S1); `note.collection_id` and `link.to_url` never serialized (S2/S5); `template` and `embedding_config` entities unimplemented (S3/S4); `embedding_set`/`embedding_set_member`/`embedding` field sets diverge (S6–S8); import never persists attachment rows at all (E1). fortemi-react also emits 9 SKOS/provenance/graph components the server excludes (S9).
- `min_reader_version` is compared with a lexicographic string `>` rather than semver (S12/E5) — it will accept an incompatible future shard once any version segment reaches double digits.
- The suite now named `db-table-parity` validates DB table shapes, not the shard contract; shard conformance coverage must live in the portable-contract gate.
- The server has a full migration/compat harness (ADR-028) with fixtures modeling future changes (`links→documents` rename, SHA256→BLAKE3); fortemi-react has no counterpart and never reads `migration_history`.

## Decision

**1. Align the shard entity contract to a named, server-owned profile.**
Concretely: rename `binary_sources` -> `attachments`; serialize
`note.collection_id` and `link.to_url`; implement `template` and
`embedding_config` export/import; align
`embedding_set`/`embedding_set_member`/`embedding` to the server field sets;
and make import actually persist attachment rows. React-only components
(SKOS/provenance/graph) are not an implicitly ignorable superset. They are
portable only when a server-owned profile declares them optional or required;
otherwise an exporter must omit them or the importer must reject the profile
before writing.

**2. Adopt a committed shard schema receipt + server-produced golden fixtures
as the conformance authority** (per ADR-010). The receipt MUST record the
upstream Fortemi revision and schema digest. A round-trip conformance suite
MUST: (a) import a real server-exported `.shard` and assert every profile
entity/field survives; (b) export a React `.shard`, validate it against the
same schema, and import it into the real server; (c) re-export and compare
stable identities, relationships, null/tombstone/timestamp semantics, counts,
and attachment sidecars; and (d) run in CI. This replaces the mis-scoped
DB-table parity guard for the shard surface.

**3. Implement real version negotiation.** Replace lexicographic version comparison with semantic-version comparison at both sites. Honor `min_reader_version` correctly; on an unsupported major, refuse import with a clear, actionable error rather than silently proceeding. Populate `migration_history`/`migrated_from` on export. Track the server's forthcoming shard changes (ADR-028 fixtures) so a v1.1/v2.0 server shard is handled deliberately.

**4. Converge the binary/attachment contract with the server.** react #227 (shipped, byte-free) and server #1013 (open) must share one specification: attachments are attached as a data source with extracted text; **raw bytes are never inlined into search/index/export/embedding-set projections**. Coordinate the fortemi-react attachment naming/serialization fix with the server #1013 canonicalization so both land against the same spec.

**5. Use explicit portability profiles.**

| Profile | Obligation |
|---|---|
| `full-v1` | PGlite and server export/import every component declared by the profile without silent loss, including attachment references and byte sidecars. |
| `core-v1` | PGlite, server, and converter preserve the declared reduced component set. Missing required components and undeclared required files are errors, not warnings. |
| `record-v1` | RecordStore round-trips only its declared canonical-record subset and reports every unsupported or lossy projection. It cannot satisfy a full-parity claim. |

The manifest profile is normative. Producers MUST NOT infer compatibility from
the presence of familiar filenames, and consumers MUST NOT silently skip an
unknown required component.

**6. Validate before mutation and make import atomic.** Importers unpack into
staging and validate archive structure, schema, semantic versions, profile,
checksums, record shapes, component/file/count coherence, and required
attachment sidecars before the first PGlite or RecordStore write. Unsupported
profiles and validation failures leave the destination unchanged. The
application transaction covers all logical record writes; blob promotion uses
a staged commit/rollback protocol.

**7. Gate releases across repositories.** A portability release is blocked
until all applicable cells in this matrix pass against pinned revisions:

| Producer | Consumer | Required gate |
|---|---|---|
| Fortemi server | PGlite and RecordStore | Server golden shard validates, imports, and re-exports under the declared profile |
| PGlite | Fortemi server | React export validates and real server import/re-export preserves the declared profile |
| RecordStore | PGlite and server | `record-v1` loss report is empty for declared fields and explicit for every out-of-profile field |
| AIWG v2 converter | PGlite and Fortemi server | AIWG source test, published `@fortemi/core` package smoke test, and real destination import all pass |

Local source tests, self-round trips, and schema validation alone are
insufficient release evidence.

## Implementation

- @packages/core/src/shard/schema-validator.ts enforces the pinned `core-v1` manifest and record schemas, archive topology, counts, references, and checksums.
- @packages/core/src/shard/shard-import.ts runs canonical validation before PGlite mutation.
- @packages/core/src/records/record-shard.ts runs the same gate before RecordStore mutation.
- @packages/core/src/__tests__/shard/shard-import.test.ts and @packages/core/src/__tests__/records/record-shard.test.ts verify validation failures leave both destinations unchanged.
- @packages/core/src/shard/profile-registry.ts derives authority status and backend advertisements from the pinned receipt.
- @packages/core/src/shard/shard-export.ts emits and self-validates explicit PGlite `core-v1` archives with machine-readable capability/loss reports.
- @packages/core/src/__tests__/shard/profile-registry.test.ts verifies supported/reserved status, strict producer output, PGlite import, and RecordStore fail-closed behavior.
- On 2026-07-17, a React-produced archive (`sha256:5444ca75a9a4d76dfff118e1a5afc05f0e33cbc66b6900d63513311608d6849c`) passed both dry-run and mutating multipart import through Fortemi commit `6f13e7ad86243f39666f8bbb0bb680b3cebab9e9`; Fortemi then re-exported the clean database (`sha256:ce42b96733fdbac18ca98a1d70afc97c6fdab92b04e87f77d56486fb2ce9df47`), and a clean PGlite import restored the note and tags. This is evidence for `core-v1` only.
- Remaining profile convergence semantics remain tracked by issue #356; the reserved profiles are not covered by the round-trip evidence.

## Consequences

**Positive:** the parity non-negotiable becomes real and CI-enforced; server↔react shard exchange actually round-trips; version skew fails safe; the attachment contract stops diverging.

**Negative / cost:** implementing `template`/`embedding_config` and the missing
fields is real work; a golden-fixture refresh path requires either a checked-in
server export or a fixture-generation step tied to a server version; React
extension components require an explicit server-owned profile decision rather
than relying on implicit ignore behavior.

**Risk if deferred:** every day the claim ships unqualified, users lose attachments (E1), collection membership (S2), URL links (S5), templates/configs (S3/S4), and embedding interpretability (S8) on any cross-boundary shard exchange — silently.

## Alternatives considered

- **Drop the parity claim, treat the shard as react-only backup** — viable and honest, but forecloses the stated interchange use case ("import/export pipelines using Knowledge Shards instead of app-specific backup formats"). If chosen, the SAD non-negotiable and marketing must be corrected instead. This ADR assumes interchange is intended.
- **Generate the react shard mapper from the server Rust** — the server hand-rolls the shard separately from its models, so codegen-from-models would not match; committed schema + golden fixtures is the pragmatic authority.

## References

- @.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md - Contract ownership and pinned-receipt decision.
- @packages/core/schemas/knowledge-shard.schema.receipt.json - Pinned Fortemi authority receipt.
