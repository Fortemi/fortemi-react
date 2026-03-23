# Supplementary Requirements (NFRs) — fortemi-react

**Version**: 2026.3.0
**Author**: roctinam
**Status**: Baselined

---

## 1. Format Parity (FR-critical)

These are functional requirements masquerading as NFRs — format parity is the single most important correctness property of the system.

| ID | Requirement | Verification |
|---|---|---|
| FP-001 | All JSON serializations must match the fortemi server OpenAPI response shapes field-for-field | Round-trip format parity tests (Vitest) |
| FP-002 | All primary keys must be UUIDv7 format (not v4, not sequential integers) | Unit tests on all INSERT paths |
| FP-003 | All mutable entities must have `deleted_at` nullable timestamptz; no hard DELETE without explicit purge | Schema inspection test + DELETE path audit |
| FP-004 | `tsvector` FTS configuration must use `'english'` dictionary (matching server) | Query result comparison with server fixtures |
| FP-005 | Vector dimensions must be 768 (Float32) — matching nomic-embed-text and bge-m3 | Embedding insertion test |
| FP-006 | RRF k parameter must be 60 (matching server) | Search fusion algorithm unit test |
| FP-007 | Date fields must serialize as ISO 8601 UTC (`2026-03-21T14:00:00Z`) | Serialization unit tests |

---

## 2. Performance (NFR-PERF)

| ID | Requirement | Priority | Target | Verification |
|---|---|---|---|---|
| PERF-001 | Note create (no AI, no attachments) | HIGH | < 200ms p95 | Vitest benchmark |
| PERF-002 | FTS search (10k notes, top 20 results) | HIGH | < 500ms p95 | Playwright perf test |
| PERF-003 | Hybrid search with vector (10k embeddings) | MEDIUM | < 1s p95 | Playwright perf test |
| PERF-004 | PGlite Worker startup (50k notes database) | HIGH | < 5s | Startup benchmark |
| PERF-005 | Embedding generation (single ~500 word chunk) | MEDIUM | < 2s | Capability unit test |
| PERF-006 | Migration run (0001 → current, empty DB) | HIGH | < 3s | Migration benchmark |
| PERF-007 | Initial bundle size (no WASM capabilities) | HIGH | < 500KB gzip | Vite bundle analyzer |
| PERF-008 | HNSW index build (10k vectors) | MEDIUM | < 30s (one-time) | Index benchmark |

---

## 3. Reliability (NFR-REL)

| ID | Requirement | Priority | Target | Verification |
|---|---|---|---|---|
| REL-001 | No data loss on browser tab close mid-transaction | CRITICAL | 0 occurrences | OPFS sync-after-commit tested |
| REL-002 | Migration failures must leave database at previous version | CRITICAL | Atomic per migration | Migration rollback test |
| REL-003 | Service Worker update must not drop in-flight requests | HIGH | 0 dropped requests | SW lifecycle E2E test |
| REL-004 | Job queue jobs must be idempotent (safe to re-run) | HIGH | No duplicate side effects | Job idempotency unit tests |
| REL-005 | Blob GC must not delete referenced blobs | HIGH | reference_count correct | GC unit test with shared blobs |
| REL-006 | Offline operation: all core features must work with no network | CRITICAL | 100% core features offline | Playwright offline mode tests |

---

## 4. Browser Compatibility (NFR-COMPAT)

| ID | Requirement | Priority | Specification | Verification |
|---|---|---|---|---|
| COMPAT-001 | Chrome / Chromium minimum version | CRITICAL | 102+ | Playwright matrix |
| COMPAT-002 | Firefox minimum version | CRITICAL | 111+ | Playwright matrix |
| COMPAT-003 | Safari minimum version | HIGH | 17+ (in-memory only — no persistent storage; see Errata #1) | Manual + Playwright if available |
| COMPAT-004 | ~~SharedArrayBuffer required (COOP/COEP headers)~~ | ~~CRITICAL~~ **REMOVED** | PGlite 0.4.1 does NOT require SharedArrayBuffer. COOP/COEP headers not needed. See Errata #5. | N/A |
| COMPAT-005 | OPFS or IndexedDB persistence (browser-specific) | CRITICAL | Chrome: `opfs-ahp://`, Firefox: `idb://`, Safari: in-memory. See ADR-005 persistence matrix. | Feature detection + adapter selection at startup |
| COMPAT-006 | Web Workers required | CRITICAL | Worker API available | Feature detection at startup |
| COMPAT-007 | Mobile Safari / iOS | OUT OF SCOPE v1 | Not supported | Documented in ADR-005 |

---

## 5. Security (NFR-SEC)

| ID | Requirement | Priority | Specification | Verification |
|---|---|---|---|---|
| SEC-001 | No API keys stored in plain text | CRITICAL | AES-256-GCM via Web Crypto for external LLM keys | Security audit |
| SEC-002 | Content Security Policy enforced | HIGH | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'` | CSP header test |
| SEC-003 | CORS restricted to same-origin for Service Worker | HIGH | Service Worker only serves same-origin | SW CORS test |
| SEC-004 | `api_key.key_hash` never stores plain key | CRITICAL | SHA-256 hash only | Schema + code review |
| SEC-005 | No XSS via note content rendering | HIGH | Note content sanitized before render | Playwright XSS test |
| SEC-006 | OPFS data not accessible cross-origin | HIGH | Browser-enforced by OPFS spec | Compatibility verified |

---

## 6. Maintainability (NFR-MAINT)

| ID | Requirement | Priority | Specification |
|---|---|---|---|
| MAINT-001 | Test coverage ≥ 60% for repository layer (unit) | HIGH | Measured by Vitest coverage |
| MAINT-002 | Format parity tests must cover all 21 tables | CRITICAL | One round-trip test per table |
| MAINT-003 | Browser migrations maintain numeric naming convention | HIGH | `0001_`, `0002_`, etc. — no gaps, no reuse |
| MAINT-004 | TypeScript strict mode enabled | HIGH | `"strict": true` in tsconfig.json |
| MAINT-005 | No `any` type in repository layer | HIGH | ESLint `@typescript-eslint/no-explicit-any` rule |
| MAINT-006 | ADR required for all new architectural decisions | MEDIUM | Reviewed before merging |
| MAINT-007 | CalVer `YYYY.M.PATCH` enforced in package.json | HIGH | CI version format check |

---

## 7. Usability (NFR-UX)

| ID | Requirement | Priority | Specification |
|---|---|---|---|
| UX-001 | Capability module download progress visible to user | HIGH | Progress bar with bytes/total, cancellation |
| UX-002 | PGlite startup state visible | HIGH | Loading indicator while Worker initializes |
| UX-003 | Storage quota warning at 80% | MEDIUM | Toast notification with cleanup guidance |
| UX-004 | Offline/online status visible | HIGH | Indicator in header; features degrade gracefully |
| UX-005 | Migration progress visible for long migrations | MEDIUM | Progress bar per migration file |
| UX-006 | AI job queue progress visible | MEDIUM | Per-note job status indicator |

---

## 8. Capability Module NFRs (NFR-CAP)

| ID | Requirement | Priority | Specification |
|---|---|---|---|
| CAP-001 | No WASM beyond PGlite loaded without user consent | CRITICAL | CapabilityManager gate enforced |
| CAP-002 | Model weights cached in OPFS after first download | HIGH | Prevents re-download on each session |
| CAP-003 | Pending jobs re-run when capability becomes available | HIGH | Job queue polls for capability-gated jobs on READY event |
| CAP-004 | Capability unload frees WASM heap memory | MEDIUM | Module.dispose() called on disable |
| CAP-005 | Semantic module download cancellable | HIGH | AbortController passed to transformers.js |

---

## 9. Licensing (NFR-LEGAL)

| ID | Requirement | Priority | Specification |
|---|---|---|---|
| LEG-001 | All production dependencies must be AGPL-3.0 compatible | CRITICAL | License audit in CI |
| LEG-002 | No MIT/Apache dependencies with patent clauses incompatible with AGPL | HIGH | Manual review of key deps |
| LEG-003 | SPDX license headers in all source files | MEDIUM | Optional for v1 |

---

## 10. Internationalization (NFR-I18N)

| ID | Requirement | Priority | Specification |
|---|---|---|---|
| I18N-001 | FTS uses `'english'` text search configuration | HIGH | Matches server; documented limitation for non-English content |
| I18N-002 | UI strings must be extractable for i18n in v2 | LOW | No hardcoded strings in JSX; use string constants |
