# ADR-011: Knowledge Shard server-conformance and version negotiation

- **Status**: Accepted
- **Date**: 2026-07-05
- **Accepted**: 2026-07-09
- **Amended**: 2026-07-26, 2026-07-29
- **Issue**: #235 (audit epic)
- **Relates**: ADR-010 (source-of-truth principle), server ADR-028 (shard archive migration system), server issue `Fortemi/fortemi#1013`

## Context

The Knowledge Shard (`shard/*`) is fortemi-react's interchange format with the Rust server, and the SAD lists "100% JSON format parity with the server" as a non-negotiable. The 2026-07-05 audit found this claim **false in both directions** and **untested**:

- The server owns `matric-shard` authoritatively through versioned schemas. Current schema `1.1.0` retains the envelope (`format:"matric-shard"`, bare-hex per-file SHA-256, `created_at_utc`→`created_at` rename) and adds the optional note tombstone field; immutable schema `1.0.0` remains readable through its registered transition.
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

The 2026-07-22 authority amendment defines identity as the exact tuple
`(manifest.version, manifest.profile)`. Schema `2.0.0` retains the `core-v1`,
`record-v1`, and `full-v1` profile names while adding direct JSON-key presence
semantics; it does not mutate any 1.x tuple. Capability reports must include
the requested schema version. A schema 2.0 profile may be advertised only when
a later immutable implementation receipt binds the originally
`specified-implementation-pending` authority to complete, independent
producer/consumer evidence. Without that receipt, local paths are callable
only to generate matrix evidence.

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

The authority-owned supported-platform gate executes the same pinned consumer
command on Linux x86_64, Linux arm64, and native macOS arm64. Windows is the
only deferred operating system because no Windows execution authority is
available. These cells prove only their receipt-bound `core-v1`, `record-v1`,
and exact `2.0.0/full-v1` behaviors; they do not widen the profile claims or
establish universal portability.

## Implementation

- @packages/core/src/shard/schema-validator.ts enforces the pinned `core-v1`, `record-v1`, and validation-only `full-v1` manifest and record schemas, archive topology, counts, references, checksums, and mandatory `full-v1` blob sidecars.
- @packages/core/src/shard/shard-import.ts runs canonical validation before PGlite mutation.
- @packages/core/src/records/record-shard.ts runs the same gate before RecordStore mutation.
- @packages/core/src/__tests__/shard/shard-import.test.ts and @packages/core/src/__tests__/records/record-shard.test.ts verify validation failures leave both destinations unchanged.
- @packages/core/src/shard/profile-registry.ts derives authority status and backend advertisements from the pinned receipt.
- @packages/core/src/shard/shard-export.ts emits and self-validates explicit PGlite `core-v1` archives with machine-readable capability/loss reports.
- @packages/core/schemas/knowledge-shard-core-v1-pglite-self.receipt.json binds
  the current `2026.7.13` PGlite `1.2.0/core-v1` self-cell to a deterministic
  live fixture. Its portable-contract suite proves clean repeated import,
  semantic re-export of every declared component, hierarchy, object and
  explicit-null metadata, tombstones, current-minus-two/current behavior,
  malformed and next-major rejection, the archive expansion cap, and zero
  mutation on each failure. This receipt does not satisfy any
  cross-repository cell.
- @packages/core/schemas/knowledge-shard-core-v1-pglite-to-fortemi.receipt.json
  binds that same signed producer fixture to delivered Fortemi commit
  `11125eb9ac97494745a834efbc0a865117d5f2b6`. Fortemi run 6057 job 101007
  passed both named consumer cases as part of 913 workspace tests. The
  receipt directly covers hierarchy, object and explicit-null metadata,
  tombstones, current-minus-two/current behavior, malformed and next-major
  rejection, configured compressed-size enforcement, repeated import,
  semantic re-export, and zero mutation after each rejection. It satisfies
  only `pglite-core-v1-to-fortemi`; the reverse direction and the AIWG and
  RecordStore cross-repository cells remain separately gated.
- @packages/core/schemas/knowledge-shard-core-v1-fortemi-to-pglite.receipt.json
  binds the current Fortemi producer fixture at
  `b53f1429e409ad02b6c9513218cb62adb9f19c71` to delivered PGlite consumer
  commit `fb570b8503eb82bcb5509b652c234c9e8582a941`. React run 1873 job 101103
  passed 281 portable-contract cases across 15 files. The dedicated consumer
  suite proves hierarchy, metadata values, explicit nulls, tombstones,
  attachment projections, current-minus-two/current behavior, malformed and
  next-major rejection, configured expansion limits, repeated import,
  semantic re-export, and zero mutation after rejection. It satisfies only
  `fortemi-core-v1-to-pglite`; the AIWG and RecordStore cross-repository cells
  remain separately gated.
- @packages/core/src/shard/full-v1-store.ts persists and re-emits every logical
  file in exact `2.0.0/full-v1`, stores all 33 validated component record sets,
  retains signatures when present, and reference-counts mandatory blob bytes.
- @packages/core/src/aiwg-index-full-shard.ts maps native AIWG note,
  relationship, SKOS, provenance, embedding, and graph records into exact
  `2.0.0/full-v1` only when the conversion is lossless. Its report-bearing
  public API returns `archive: null` plus typed losses when source information
  would be defaulted or omitted.
- @packages/core/src/aiwg-index-shard.ts maps AIWG v2 directory prefixes to
  native `1.2.0/core-v1` collections and source-authored
  `state_transfer.deleted_at` to note tombstones. Observed
  `operational_state` never implies deletion. The clean PGlite import/re-export
  test is local consumer evidence only; the AIWG-to-PGlite and
  AIWG-to-Fortemi matrix cells remain open until a released producer fixture,
  immutable receipt, and both exact consumer runs exist.
- @packages/core/src/__tests__/shard/profile-registry.test.ts verifies authority status independently from backend advertisements, strict producer output, PGlite import, and RecordStore fail-closed behavior.
- On 2026-07-17, a React-produced archive (`sha256:5444ca75a9a4d76dfff118e1a5afc05f0e33cbc66b6900d63513311608d6849c`) passed both dry-run and mutating multipart import through Fortemi commit `6f13e7ad86243f39666f8bbb0bb680b3cebab9e9`; Fortemi then re-exported the clean database (`sha256:ce42b96733fdbac18ca98a1d70afc97c6fdab92b04e87f77d56486fb2ce9df47`), and a clean PGlite import restored the note and tags. This is evidence for `core-v1` only.
- @packages/core/src/shard/schema-validator.ts selects the immutable `1.0.0` or current `1.1.0` canonical bundle from the manifest version. Named PGlite exports use `1.1.0`, include active and soft-deleted notes, emit exact `deleted_at` state, and restore that state inside the existing import transaction.
- On 2026-07-18, a schema `1.1.0` React archive containing an active note and a soft-deleted note (`sha256:c3605945c69893ba2e56091a4b1149b7ab598087d3fa2ee5c288acb506969f94`) passed isolated dry-run and repeated mutating imports through Fortemi commit `f39b01c995f10f8da4cad662ff8e86c6130ba2b0`. Dry-run left the clean destination at zero notes and zero tag rows. Fortemi re-exported the populated destination (`sha256:cac731d33f1183d73c5db958c454f22e9dfac09846e7e01c4c7486805c7b631a`); the React validator accepted that archive and a clean PGlite import restored both bodies, all three note-tag associations, active `deleted_at:null`, and tombstone instant `2026-07-18T04:30:00.000Z`. This receipt proves only the declared, byte-free `core-v1` surface.
- @packages/core/src/records/types.ts, @packages/core/src/records/idb-record-store.ts, and @packages/core/src/records/memory-record-store.ts provide a multi-collection atomic batch with journal atomicity for RecordStore import.
- @packages/core/src/shard/blob-staging.ts promotes verified sidecars before the logical transaction and removes only newly introduced hashes on synchronous failure.
- @packages/core/src/shard/shard-import.ts and @packages/core/src/records/record-shard.ts preserve representable null, tombstone, and timestamp state and reconcile imported-note relationships for legacy unprofiled replace imports. Failure-injection and repeat-import tests cover PGlite and RecordStore. The delivered schema 2.0 cross-repository receipt enables exact-tuple PGlite `full-v1` advertisement from receipt data after clean PGlite and Fortemi runs of the released React and AIWG archives. Existing schema 1.2 defaults remain unchanged, RecordStore remains `record-v1`, and suite-wide claims remain separately gated.

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
- @packages/core/schemas/knowledge-shard-v2.schema.receipt.json - Pinned schema 2.0.0 presence and full-inventory authority receipt.
