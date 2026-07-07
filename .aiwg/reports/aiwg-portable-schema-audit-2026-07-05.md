# Technical Audit — AIWG Portable-Schema Features (fortemi-react)

- **Date**: 2026-07-05
- **Scope**: The AIWG portable-schema layer added to `@fortemi/core` — the AIWG Fortemi *index* ingestion (`packages/core/src/aiwg-index.ts`) and the Knowledge *Shard* import/export (`packages/core/src/shard/*`), plus the React hooks (`useAiwgIndex`, `useShard`) and the `format-parity` test suite. Shipped across #204, #213–#221, #227, #228.
- **Audit dimensions**: (1) server compatibility, (2) AIWG integration + use correctness, (3) implementation/design gaps, (4) errors/errata, (5) security.
- **Method**: Multi-agent audit. Two reconnaissance passes established the authoritative external contracts (the Rust server `matric-shard` format read from `fortemi/…/main.rs`; the AIWG index generator + canonical JSON Schema read from `roctinam/aiwg`). Five specialist agents (Security Auditor, Debugger, Code Reviewer, and two Technical Researchers) then audited fortemi-react against those contracts. Findings below are cross-corroborated; per-finding evidence lives in `.aiwg/reports/` working notes and the security appendix.
- **Tracking**: Epic **#235**. Child issues are linked from the epic. Upstream generator bug filed on `roctinam/aiwg`.
- **Supersedes**: The R-002 ("Schema drift from server") mitigation in `.aiwg/architecture/SAD.md:450`, which this audit shows to be ineffective.

---

## 1. Executive Summary

**The central architectural finding: "AIWG → React → server" is not one portable schema — it is two independent contracts, and neither has a shared source of truth.**

| Hop | Format | Owner / authority | fortemi-react's role | State |
|---|---|---|---|---|
| **AIWG → React** | AIWG Fortemi *index* (`aiwg.fortemi.index.export.v1/v2`) | AIWG owns the generator (`aiwg/src/artifacts/browser-export.ts`) **and** the canonical JSON Schema (`aiwg/schemas/aiwg-fortemi-index-export.json`) | Runtime **validator/parser** (`aiwg-index.ts`) — which AIWG *re-imports to validate its own output* | Co-evolving; parser drifted **ahead** of the generator and is **looser** than the schema |
| **React ↔ Server** | Knowledge *Shard* (`matric-shard` v1.0.0) | The Rust server owns it authoritatively (hand-rolled JSON in `main.rs`) | Export/import (`shard/*`) claiming "100% parity" | **Parity is broken in both directions** |

Two consequences dominate:

1. **The "100% JSON format parity with the server" non-negotiable (SAD §Non-Negotiables) does not hold for the Knowledge Shard.** There are field-name mismatches, missing entities, and unimplemented import paths in both directions. Worse, the suite named `format-parity` **does not test this contract at all** — it validates PGlite table-row shapes against server *database* fixtures, a completely different surface. There is **zero** automated coverage of the shard-vs-server-shard contract.
2. **The AIWG index is not a server format** — the server neither emits nor ingests it. It is an AIWG-corpus → browser feed. fortemi-react's validator is the de-facto contract enforcer for AIWG's own output, yet it enforces *neither* the v1/v2 field-forbiddance rules *nor* the enum constraints of AIWG's schema — so a real generator bug (below) sails through undetected.

**Severity headline:** 2 CRITICAL (1 security, 1 data-loss), 1 CRITICAL upstream generator bug in AIWG, plus multiple HIGH interop/correctness/security findings. None are blocked on architecture; all are fixable. The most valuable structural fix is establishing a single schema source of truth (JSON Schema + codegen/conformance tests) on both hops — see ADR-010 / ADR-011.

**Calibration note:** the audit also *cleared* several suspected issues. fortemi-react's client-side binary handling (#227) is correct — raw bytes are structurally impossible in the record type; only a privacy gate is missing. The `binary_sources` / chunk-manifest / embedding-set / SKOS-PROV surfaces are **intentional, legitimate react-only extensions** ahead of the generator, not bugs. Tar extraction has **no** filesystem zip-slip; the service worker is same-origin gated; the plugin loader enforces CSP + SRI; caches are LRU-bounded; imports run in a single transaction. Findings are scoped to real defects.

---

## 2. Dimension 1 — Server Compatibility (Knowledge Shard ↔ `matric-shard`)

Authoritative server contract (from `fortemi/crates/matric-api/src/main.rs`): archive `tar.gz` / `.shard`, `format:"matric-shard"`, `version:"1.0.0"`, per-file SHA-256 (bare hex), timestamps renamed `created_at_utc`→`created_at`, UUIDv7.

**Verified correct** (do not re-open): `.shard` ext, tar.gz, component filenames + JSONL/JSON split, `format:"matric-shard"` + `version:"1.0.0"` (`shard/types.ts:8-9`), **checksums are bare hex with no `sha256:` prefix** (`checksum.ts:10-18` — this was a suspected break, it is correct), `tag`/`collection` field names, the `created_at_utc`→`created_at` rename.

**Breaks interop (both directions):**

| ID | Finding | Location | Severity |
|---|---|---|---|
| S1 | Note attachments emitted under key `binary_sources`; server uses `attachments` (inner shape matches). Server shard attachments silently dropped on react import & vice-versa. | `shard/types.ts:172`, `field-mapper.ts:73-75`, `shard-export.ts` | HIGH |
| S2 | `note.collection_id` never exported (membership modeled via a junction never serialized; only aggregated into `collection.note_count`). Data loss. | `shard/types.ts:167-181`, `shard-export.ts:203-220` | HIGH |
| S3 | `template` entity unimplemented — no type, no `templates.json`; import drops with a warning. | `shard-import.ts:236-238` | HIGH |
| S4 | `embedding_config` entity unimplemented — dropped **silently** (in `knownFiles`, no parse/insert). | `shard-import.ts:218` | HIGH |
| S5 | `link.to_url` never read/written — URL-only links cannot round-trip. | `field-mapper.ts:86-114` | MED-HIGH |
| S6 | `embedding_set` field divergence — missing `slug/description/document_count/embedding_count/is_system/keywords`; carries 8 react-only fields instead. | `shard/types.ts:211-227` | HIGH |
| S7 | `embedding_set_member` divergence — spec `{…,membership_type,added_at,added_by}` vs react `{…,embedding_id}`; import requires `embedding_id` → spec payload fails/nulls. | `shard/types.ts:230-234`, `shard-import.ts:613-624` | HIGH |
| S8 | `embedding` divergence — missing `chunk_index/text/model`; import requires react-only `embedding_set_id`. Vectors become uninterpretable / import fails. | `shard/types.ts:237-243`, `shard-import.ts:504-523` | HIGH |
| S9 | 9 react-only components (skos/provenance/graph/community) the server format excludes — react shard is a superset the server ignores/rejects. | `shard-export.ts:257-596` | MED (asymmetry) |

**Degrades:** manifest `counts` keys mismatch (S10); `migration_history` never written (S11); `min_reader_version` compared with lexicographic string `>` not semver — breaks at double-digit segments (S12, `shard-import.ts:152`, `shard-reader.ts:534`); `note.deleted_at` emitted though server omits it (S13, harmless today).

**Coverage gap (critical):** `__tests__/format-parity/*` validates DB table row shapes (`archive_id`, `visibility`, `revision_mode`, `is_pinned`) against server *database* fixtures — **the shard JSON fields never appear**. None of S1–S13 would be caught. → **spike: build a real shard round-trip conformance harness against server-produced fixtures.**

---

## 3. Dimension 2 — AIWG Integration Correctness (index parser ↔ AIWG schema)

| ID | Finding | Location | Severity |
|---|---|---|---|
| A1 | **Upstream AIWG generator bug**: `aiwg index export --format fortemi` (documented default → v1) emits `target_path`/`direction`/`metadata` on relationships, which the AIWG schema **forbids on v1** records. AJV validation never runs on the default v1 build; fortemi-react's validator (A2) doesn't catch it. The documented default command produces schema-invalid JSON for any artifact with a dependency edge. | `aiwg/src/artifacts/browser-export.ts:325-356,579`; schema `aiwg-fortemi-index-export.json:191-216` | **CRITICAL** (filed on `roctinam/aiwg`) |
| A2 | fortemi-react validator has **zero v1/v2 field-forbiddance**: never branches on `schema_version` to reject fields that must be *absent* for the declared version. A v1 record carrying v2 fields validates `true`. This is exactly why A1 is undetected. Parser strictly **looser** than schema. | `aiwg-index.ts:595-755` | HIGH |
| A3 | **Discovery-ranking drift**: `discoveryMatches` is an *unbounded additive* scorer (weights 80/48/34/22/18/8/2, no min-overlap gate, no exact-match short-circuit). AIWG's real `aiwg discover` (`aiwg/src/artifacts/query-engine.ts:279-412`) is *bounded 0–1.001* with Damerau-Levenshtein near-match, sentinel short-circuits, and weighted multipliers. Fundamentally incompatible scales; no shared code; the only test is self-referential (`aiwg-index.test.ts:390`). Silent parity drift with no anchor. | `aiwg-index.ts:1239-1303` | HIGH |
| A4 | Enum values unvalidated (except `relationships[].direction`): `privacy.classification`, provenance `confidence` accept any non-empty string; `provenance[]` item shape unchecked beyond "non-empty array". | `aiwg-index.ts:595-755` | MEDIUM |
| A5 | Export-level v1/v2 gating unenforced **and the TS type is wrong** — `AiwgFortemiIndexExport['source']` omits v2's `graph`, and carries phantom record-level fields (`origin/generated/checksum/updated_at`). `source.graph`/`compatibility` presence-iff-v2 never validated. | `aiwg-index.ts:165-172` | MEDIUM |
| A6 | Stale record-type constant `docs.page`; AIWG emits `aiwg.kb.page`. Inert at runtime (catch-all `\`aiwg.${string}\`` \| `string`) but misleading and can miss type-keyed facet/discovery paths. | `aiwg-index.ts:9` | LOW |

**Test fixture is non-representative:** `packages/core/test/fixtures/sanitized-aiwg-fortemi-index.json` is a synthetic v1 **CRM-domain** sample that the shipped `browser-export.ts` generator (which emits only `aiwg.artifact` in v1) would never produce. The primary index fixture demonstrates the *hypothetical contract*, not real generator output. **Confirmed clean:** SKOS/provenance-event validation matches the AIWG schema field-for-field (forward-looking, correct); react-only extensions (`binary_sources`, chunk-manifest, embedding-set) are legitimately out of the AIWG schema's scope.

---

## 4. Dimension 3 — Implementation / Design Gaps

| ID | Gap | Recommended artifact |
|---|---|---|
| D1 | Schema **duplicated across two repos, already diverged** (title/text required-vs-optional, input_hash, version-string naming). AIWG declares `@fortemi/core` as a dep but **never imports it** (grep-zero) — it reinvents the schema in `browser-export.ts`. SAD R-002 mitigation is ineffective. | **ADR-010** |
| D2 | **No version-negotiation / deprecation contract.** `isSupportedIndex/RecordSchemaVersion` hardcode a v1/v2 allow-list; a v3 export fails for all current consumers. No "additive" definition, no capability handshake, no `min_reader_version` semantics on the index side. | **ADR-010 / ADR-011** |
| D3 | Discovery-ranking has no cross-repo parity test (see A3). | spike + dev task |
| D4 | The `format-parity` suite is misnamed for the portable-schema contract and its fixtures are stale (committed once 2026-03-22, no regeneration script, no live server). CLAUDE.md calls it "highest priority — if it breaks nothing ships," yet it guards the wrong surface. | dev task / spike |
| D5 | Binary/attachment client↔server contract has no shared spec (server #1013 open; react #227 shipped) — same no-source-of-truth problem. | spike (converge with server #1013) |
| D6 | graphrag-rs (#212) has no extension seam analogous to `adr-backend-seam`; `useRemote.ts` is an early stub relative to the surface. | spike (low urgency) |
| D7 | No ADR/diagram for schema ownership or the two-contract data flow. | ADR-010 (this audit) |
| D8 | `aiwg-index.ts` is **2168 LOC — 4× the repo's own `agent-friendly-code` 500-LOC error threshold**. Clean seams exist (types/validation/chunked/discovery/semantic/controller/graph). | chore (sequence after ADR-010) |

---

## 5. Dimension 4 — Errors / Errata

| ID | Bug | Location | Severity |
|---|---|---|---|
| E1 | **Shard import silently drops all attachments** — `noteFromShard` reconstructs `binary_sources` but the import loop never inserts into `attachment`/`attachment_blob` (grep-zero). Round-trip data loss even react→react; untested. | `shard-import.ts:~268-347` | **CRITICAL** |
| E2 | `neighbors()`/relationship `limit` **applied before sort** (non-deterministic top-N) **and** the default `direction:'both'` is unscoped — every graph edge matches before `limit` truncates, so real neighbors can be dropped while the result still reports `complete:true`. | `aiwg-index.ts:1738,1755-1762` | HIGH |
| E3 | `queryAiwgHybridIndex` blends the semantic pool (untruncated) against a **pagination-truncated lexical pool**; `maxLexical` normalizes the wrong subset. | `aiwg-index.ts:1488-1520` | MODERATE |
| E4 | Chunked `matchSetCacheKey` **omits `searchProfile`** — same query text under `default` vs `aiwg-discovery` collides and returns the wrong profile's matches. | `aiwg-index.ts:1582-1593` | MODERATE |
| E5 | Version gate uses string `>` not semver (two sites; same root as S12). | `shard-import.ts:152`, `shard-reader.ts:534` | MODERATE |
| E6 | Two cosine implementations disagree on dimension mismatch (returns 0 vs silently truncates to a misleading partial). | `aiwg-index.ts:1421-1435`, `shard/semantic-providers.ts` | MINOR |
| E7 | `parseVector("[]")` → `[0]` not `[]` (`''.split(',')` → `['']`, `Number('')===0`). | `field-mapper.ts:397-400` | MINOR |
| E8 | `createReviewDecisionExport` reports `source_export_schema_version: v1` even for a true-v2 chunked source — root cause: `buildAiwgChunkedIndex` never copies `schema_version` into the manifest. | `aiwg-index.ts:~2100` | MINOR |

**Calibration:** the earlier-suspected "v1 hardcoding" at `getChunkRecord`/`toCommunityGraphChunked` is **not** a bug — the wrapper `schema_version` is validated then discarded, never read for behavior. Only E8 is a genuine (minor) defect. Chunked pagination slice math, manifest/part validation (id sort/dedup, offset sums, `{id}` href check), and LRU eviction are **verified correct**.

---

## 6. Dimension 5 — Security

| ID | Finding | Location | Severity |
|---|---|---|---|
| SEC1 | **Prototype pollution** — loading an untrusted index with `facets:{"__proto__":[…]}` and calling ordinary `.search()` executes `counts["__proto__"][v]=1`, writing onto `Object.prototype`. Zero interaction beyond normal use. | `aiwg-index.ts:556-559,959-971` (via `:1393`) | **CRITICAL** |
| SEC2 | **SSRF** via manifest-controlled `fetch()` — `part.href`/`detail.href` passed to `fetch(new URL(href, baseUrl))` with no scheme/origin allowlist; an absolute href ignores `baseUrl` → any-origin fetch. | `aiwg-index.ts:917-924,948-957` | HIGH |
| SEC3 | **Decompression bomb** — `gunzipSync` with no output cap, run *before* checksum validation, on both import and open. | `shard-tar.ts:163-166` | HIGH |
| SEC4 | **Path traversal (confidentiality)** — `UrlComponentStore.read` does `${baseUrl}/${filename}` with manifest-controlled `href`; `../` escapes the shard directory (same-origin, multi-tenant static hosting). | `shard-reader.ts:156-166` | HIGH |
| SEC5 | **Algorithmic DoS** — `findAiwgStaticDuplicatePairs` is unbounded O(n²) over attacker-suppliable embedding sets. | `aiwg-index.ts:1522-1541` | HIGH |
| SEC6 | **Privacy/PII not enforced at generation** — `buildAiwgStaticEmbeddingSet`/`buildAiwgChunkedIndex` never filter `privacy.classification`/`pii`; enforcement is query-time only. (Raw *bytes* are structurally impossible — that half of #227/#1013 is satisfied; only the classification gate is missing.) | `aiwg-index.ts:1004-1041,1095+` | MEDIUM |
| SEC7 | Shard checksums are self-referential (integrity-of-transport, not tamper-evidence) — attacker controls content + hash. `prefetchShard`'s out-of-band `expectedSha256` *is* real verification. Document + recommend signed manifests. | `checksum.ts:25-44` vs `prefetch.ts:125-143` | MEDIUM |

**Verified-correct controls (do not re-flag):** no filesystem zip-slip (tar contents stay in an in-memory `Map`); blob-store keys always internally computed; base64url detail-id encoding is path-safe (#177); service worker strictly same-origin gated with inert 503 route stubs; `plugin-content.ts` enforces an origin allowlist + mandatory SRI + `credentials:'omit'`; chunk caches LRU-bounded; `importShard` wraps writes in one transaction (clean rollback); checksum runs before parse.

---

## 7. Cross-Agent Corroboration (confidence)

- **`format-parity` guards the wrong surface** — independently found by the server-compat and design-gap audits.
- **Client-side binary handling is byte-free/correct** — independently found by the security and design-gap audits.
- **Schema drift / no shared source** — found by both recon passes (server + AIWG) and the design-gap audit (AIWG never imports `@fortemi/core`).
- **Semver-vs-string version gate** — found by the server-compat and errata audits (two code sites).
- **`embedding_config` silently dropped** — found by the server-compat and errata audits.

---

## 8. Roadmap Grounding

- **fortemi-react** open: only #212 (graphrag-rs backend). The AIWG portable-schema work (#204, #213–#221, #227, #228) is complete — this audit is the follow-through.
- **fortemi server** open **#1013** ("never inline raw bytes into search/index/export projections") is the server-side counterpart to react's shipped **#227** — a live divergence with no shared spec (D5). Also relevant: server #1011 (extraction DoS), #995/#979/#976/#975 (embedding provider/config/cache-key), #1007 (provenance→ROKO/CustodyCore).
- **AIWG** has an active migration workstream (`aiwg/.aiwg/planning/fortemi-core-index-migration/`, ADR `adr-fortemi-core-indexing-substrate.md`) whose own listed future-gap triggers (chunked-traversal failures, semantic/hybrid divergence, missing package exports) map directly onto A2/A3/E2/E3 here. The A1 generator bug is filed upstream against that workstream.

---

## 9. Remediation Plan

All work is tracked under **epic #235**; child issues are linked there. Priority order:

1. **CRITICAL now** — SEC1 (prototype pollution), E1 (import drops attachments), and upstream A1 (AIWG generator).
2. **Parity** — S1–S9 (shard field conformance) + a real conformance harness (D4).
3. **Validator correctness** — A2/A4/A5/A6 + E8.
4. **Discovery parity** — A3/D3 (golden cross-repo test; ideally a shared scorer).
5. **Security hardening** — SEC2–SEC5 + SEC6/SEC7.
6. **Correctness bugs** — E2/E3/E4/E5.
7. **Structure** — ADR-010/011 (source of truth + version negotiation), then D8 (decompose `aiwg-index.ts`).

## 10. Related Artifacts

- ADR-010 (proposed): `.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md`
- ADR-011 (proposed): `.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md`
- Security appendix: `.aiwg/security/aiwg-portable-schema-security-2026-07-05.md`
- SAD risk to update: `.aiwg/architecture/SAD.md:450` (R-002)
