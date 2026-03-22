# Construction Ready Brief — fortemi-browser

**Generated**: 2026-03-21
**Project**: fortemi-browser
**Version**: 2026.3.0
**Status**: Elaboration Ready (Construction begins after Elaboration gate: 2026-05-16)

---

## Executive Summary

fortemi-browser is a browser-only reimplementation of the fortemi knowledge management system (Rust/PostgreSQL server, v2026.2.13). The project is construction-ready in the sense that all design decisions have been made, all architecture decisions are documented, and the first two construction iterations are planned and estimated.

**One prerequisite remains**: The Elaboration phase must complete (8 weeks, starting 2026-03-22). The primary deliverable is an executable PGlite + pgvector + OPFS proof-of-concept that retires the highest architectural risk (R-001). All other Inception artifacts are complete.

---

## Project Snapshot

| Attribute | Value |
|---|---|
| Type | Browser-only knowledge management PWA |
| Tech Stack | React 19 + TypeScript + Vite + PGlite + pgvector |
| Testing | Vitest + Playwright |
| CI/CD | Gitea Actions |
| License | AGPL-3.0 |
| Versioning | CalVer 2026.3.0 |
| Target Browsers | Chrome 102+, Firefox 111+, Safari 17+ |
| Solo Developer | roctinam (30+ years systems engineering) |

---

## Architecture Decisions (Non-Negotiable)

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | PGlite (PostgreSQL WASM) as storage engine | Baselined |
| ADR-002 | Opt-in capability module system before any WASM | Baselined |
| ADR-003 | Single-writer PGlite Worker via postMessage | Baselined |
| ADR-004 | Service Worker intercepts localhost:3000 for MCP/REST | Baselined |
| ADR-005 | Chrome 102+ / Firefox 111+ / Safari 17+; iOS out of scope v1 | Baselined |

---

## Construction Readiness by Category

### Requirements

| Item | Status |
|---|---|
| 8 Architecturally Significant Use Cases (UC-001–UC-008) | Complete |
| Supplementary Requirements (NFRs) | Complete |
| Format Parity Requirement (JSON round-trip = server) | Documented + enforced by test strategy |
| 38 MCP Tool Surface | Documented (Phase 6; Iterations C11–C12 target) |
| Non-Negotiables (UUIDv7, soft-delete, JSON parity, AGPL) | Documented and enforced |

### Architecture

| Item | Status |
|---|---|
| Software Architecture Document (SAD) | Draft — complete for construction start |
| Data Model (21 tables mapped to server schema) | Complete |
| C4 Context + Container Diagrams | Complete |
| 8 Key Flow/Sequence Diagrams | Complete |
| PGlite Single-Writer Pattern | Specified |
| Service Worker REST Interception | Specified |
| Capability Module System | Specified |
| Hybrid Search (BM25 + pgvector RRF) | Specified |

### Planning

| Iteration | Focus | Weeks | Stories | Points |
|---|---|---|---|---|
| Elaboration Iter 1 | PGlite PoC — retire R-001 | 4 | 10 | 50 |
| Elaboration Iter 2 | SAD + UCs + plans | 4 | 8 | 42 |
| Construction C1 | Foundation stack | 8 | 20 | 104 |
| Construction C2 | Core CRUD + FTS + SKOS + MCP basics | 8 | 20 | 112 |
| C3–C6 | Semantic, AI, Media, MCP polish | 24 | TBD | TBD |

### Testing

| Item | Status |
|---|---|
| Test strategy (Vitest + Playwright) | Documented |
| Format parity test framework | Scaffold planned for C1 |
| CI pipeline (Gitea Actions) | Documented |
| Coverage targets | 60% overall; 80% repository; 100% format parity |
| Browser matrix | Chromium + Firefox in CI; Safari manual |

### Risk

| Risk | Status | Action |
|---|---|---|
| R-001 (PGlite compatibility) | Monitoring → Retire in Elab Iter 1 | **Highest priority task in entire project** |
| R-002 (Schema drift) | Mitigating | Format parity test suite |
| R-003 (WebLLM quality) | Accepted | External API config documented |
| R-004 (WASM downloads) | Mitigating | Capability module opt-in system |

---

## Immediate Next Steps

### Week 1 (Starting 2026-03-22) — Elaboration Iteration 1

The single most important action: build the PGlite PoC.

1. **C1-1 equivalent: Vite project scaffolding** — TypeScript strict, React 19, COOP/COEP headers
2. **E1-1: PGlite Worker** — Initialize with OPFS, verify persistence
3. **E1-2: pgvector** — Load extension, create HNSW index, vector round-trip
4. **E1-3: Message bus** — postMessage protocol, concurrent write safety
5. **E1-4+5: Migration runner + 0001** — First schema in browser

This PoC should be a standalone proof in a `poc/` branch — minimum code to prove the stack, not production code.

### After PoC (Weeks 3–4 of Elaboration)

If PoC succeeds (expected):
- R-001 retired
- Begin production-quality C1 implementation alongside E2 documentation work

If PoC fails (PGlite/pgvector/OPFS incompatibility found):
- Escalate immediately
- Evaluate fallback: origin-private SQLite + sqlite-vec, or IndexedDB with migration workaround
- Revise architecture before any further construction

---

## Build Phases Summary (Reminder)

| Phase | Weeks | Primary Deliverable |
|---|---|---|
| 1 — Foundation | 1–8 | PGlite Worker, migrations, capability system, Service Worker, event bus |
| 2 — Core | 9–18 | Note CRUD, FTS search, SKOS, collections, links, REST handlers |
| 3 — Semantic | 19–26 | transformers.js embeddings, pgvector search, RRF hybrid |
| 4 — AI | 27–34 | WebLLM + external API, revision pipeline, concept tagging |
| 5 — Media | 35–42 | PDF, vision, audio, OPFS blobs |
| 6 — MCP + Polish | 43–50 | 38 MCP tools complete, multi-archive, PWA, mobile |

---

## Definition of Done (per story)

1. Code written and passing TypeScript strict compilation
2. ESLint clean
3. Unit tests written (Vitest)
4. Format parity test written (for repository-layer changes)
5. Integration or E2E test for primary flow
6. Coverage ≥ 60% overall maintained
7. No regressions in existing test suite
8. Code reviewed (self-review or Code Reviewer agent)
9. CI passes on main

---

## Contact and Governance

**Owner**: roctinam (sole developer and architect)
**Decisions**: roctinam makes all architectural and implementation decisions
**Escalation**: ADR process for architectural changes; risk-list.md for risk changes
**Agent support**: 12 AIWG agents assigned (see `.aiwg/team/agent-assignments.md`)
