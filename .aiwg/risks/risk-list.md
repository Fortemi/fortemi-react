# Risk Register — fortemi-react

**Version**: 2026.7.9
**Last Updated**: 2026-07-09
**Owner**: roctinam

---

## Active Risks

| ID | Risk | Severity | Probability | Impact | Status | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| R-001 | PGlite OPFS persistence Chrome-only; Firefox uses IndexedDB; Safari in-memory only | CRITICAL | **CONFIRMED** | CRITICAL | **Retired (2026-03-22)** | PoC validates: PGlite + pgvector + tsvector + transactions all work. Tiered persistence accepted (Chrome OPFS, Firefox IDB, Safari in-memory). 36 Vitest tests pass. Risk retired — limitation documented, not blocking. | roctinam |
| R-002 | Browser/server portable contract drift breaks shard exchange or sync | HIGH | MEDIUM | HIGH | Mitigating | ADR-010/011 split the old broad "format parity" guard into explicit contract gates: `test:portable-contract` validates the AIWG index contract and Knowledge Shard schema/AJV coverage; committed server-generated shard golden fixtures exercise server import/re-export; `db-table-parity` remains a storage-shape guard only. Raw attachment blob restoration remains tracked under #237/#255 and server `Fortemi/fortemi#1013`. | roctinam |
| R-003 | WebLLM quality gap vs Ollama LLM on server produces poor AI revisions | HIGH | HIGH | MEDIUM | Accepted | External LLM API config provided; documented clearly; not blocking core data model | roctinam |
| R-004 | WASM model sizes (transformers.js ~100MB, WebLLM ~1-4GB) cause poor UX | HIGH | HIGH | MEDIUM | Mitigating | Capability module system — opt-in only; no forced downloads; progress indicators | roctinam |
| R-005 | IndexedDB / OPFS storage quota limits hit by power users | MEDIUM | MEDIUM | MEDIUM | Monitoring | OPFS for blobs >10MB; warn at 80% quota; large files bypass PGlite WAL | roctinam |
| R-006 | PGlite startup latency on large databases degrades user experience | MEDIUM | LOW | MEDIUM | Monitoring | Benchmark at 10k/50k/100k notes; pre-warm in background; loading state in UI | roctinam |
| R-007 | Service Worker update cycle disrupts in-flight requests | MEDIUM | LOW | MEDIUM | Mitigating | Versioned SW with skipWaiting only after all requests complete; graceful claim | roctinam |
| R-008 | BM25 / tsvector config diverges from server (stop words, stemming) | LOW | MEDIUM | LOW | Accepted | Document divergence; rankings differ but result sets converge; RRF compensates | roctinam |
| R-009 | ~~BLAKE3 WASM unavailable in niche browsers~~ | LOW | LOW | LOW | **Retired** | Errata #2: `blake3-wasm` unmaintained since 2022. Replaced with `@noble/hashes` (pure JS, no WASM dependency). SHA-256 fallback retained. | roctinam |
| R-010 | UUIDv7 clock collision in offline multi-device scenarios | LOW | LOW | LOW | Accepted | Machine ID component in UUIDv7 generation; collision probability negligible | roctinam |

---

## Risk Lifecycle

| ID | Raised | Status Changes |
|---|---|---|
| R-001 | 2026-03-21 | Identified → Monitoring → Discovered (Errata #1) → **Retired** (2026-03-22, PoC validates PGlite stack; tiered persistence accepted) |
| R-002 | 2026-03-21 | Identified → Mitigating (format parity test suite planned) → Materialized drift found by 2026-07-05 audit → Mitigation replaced by ADR-010/011 portable-contract gates, committed shard schema/AJV, golden fixture coverage, and scoped DB-table parity |
| R-003 | 2026-03-21 | Identified → Accepted (documented limitation) |
| R-004 | 2026-03-21 | Identified → Mitigating (capability module system designed) |
| R-005–R-010 | 2026-03-21 | Identified |

---

## Retired Risks

None yet — project in Inception.

---

## Notes

- R-001 is **retired**. PGlite PoC validates the full stack (pgvector, tsvector, transactions, migrations) with 36 passing tests. Tiered persistence accepted: Chrome OPFS, Firefox IDB, Safari in-memory. See Errata #1 and E1-10 assessment.
- R-002 is an active maintenance risk. The current mitigation is mechanical rather than aspirational: `pnpm --filter @fortemi/core test:portable-contract` covers the AIWG index and Knowledge Shard contract gates, committed server-generated `.shard` fixtures validate the server archive shape, and DB-table parity is explicitly scoped to storage rows. The remaining known gap is raw attachment blob restoration, which depends on a separate byte source or future server backup/restore byte-packaging contract.
- R-003 and R-008 are accepted risks with documented limitations — not worth mitigating given the product goals.
