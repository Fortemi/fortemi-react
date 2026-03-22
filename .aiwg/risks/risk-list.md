# Risk Register — fortemi-browser

**Version**: 2026.3.0
**Last Updated**: 2026-03-21
**Owner**: roctinam

---

## Active Risks

| ID | Risk | Severity | Probability | Impact | Status | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| R-001 | PGlite OPFS persistence Chrome-only; Firefox uses IndexedDB; Safari in-memory only | CRITICAL | **CONFIRMED** | CRITICAL | **Discovered** | OPFS AHP is Chrome-only. Firefox: use `idb://` adapter. Safari: OPFS sync handle limit (252) below PGlite minimum (~300) — in-memory only. See Errata #1. PoC must test all three browsers. | roctinam |
| R-002 | Browser migration diverges from server migrations; schema drift breaks sync | HIGH | MEDIUM | HIGH | Mitigating | Browser migration files maintained in parallel with server; format parity test suite catches drift | roctinam |
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
| R-001 | 2026-03-21 | Identified → Monitoring → **Discovered** (2026-03-22, Errata #1: OPFS Chrome-only confirmed) |
| R-002 | 2026-03-21 | Identified → Mitigating (format parity test suite planned) |
| R-003 | 2026-03-21 | Identified → Accepted (documented limitation) |
| R-004 | 2026-03-21 | Identified → Mitigating (capability module system designed) |
| R-005–R-010 | 2026-03-21 | Identified |

---

## Retired Risks

None yet — project in Inception.

---

## Notes

- R-001 is now a **discovered limitation**, not just a risk. OPFS persistence is Chrome-only. Firefox uses IndexedDB (`idb://`), Safari is in-memory only. The PoC must validate all three browser paths. See Errata #1.
- R-002 is ongoing maintenance risk; mitigated by process (track server migrations) not technology.
- R-003 and R-008 are accepted risks with documented limitations — not worth mitigating given the product goals.
