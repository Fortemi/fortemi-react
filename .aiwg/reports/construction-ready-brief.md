# Construction Status Brief — fortemi-react

**Updated**: 2026-03-23
**Project**: fortemi-react
**Version**: 2026.3.0
**Status**: Construction C3 Complete — QA/UAT ready

---

## Executive Summary

fortemi-react is a browser-only reimplementation of the fortemi knowledge management system. Construction has completed through three iterations (C1 Foundation, C2 Core CRUD, C3 Semantic + AI), delivering a fully functional knowledge management application with:

- Full note CRUD with revision history
- Full-text search (PostgreSQL tsvector) and hybrid semantic search (pgvector RRF)
- SKOS taxonomy, tagging, collections, and links
- 13 MCP tool functions for AI agent integration
- Capability module system for opt-in WASM features (embedding, LLM, GPU detection)
- React 19 UI with note list, search, settings, and capability management
- 603 tests passing, 88.56% coverage, 16 E2E tests across Chromium + Firefox

---

## Project Snapshot

| Attribute | Value |
|---|---|
| Type | Browser-only knowledge management PWA |
| Tech Stack | React 19.2.4 + TypeScript strict + Vite 7.3.1 + PGlite 0.4.1 + pgvector |
| Package Manager | pnpm 10.6.5 (monorepo) |
| Packages | @fortemi/core, @fortemi/react, @fortemi/standalone |
| Testing | Vitest 4.1.0 (603 tests) + Playwright 1.58.2 (16 E2E tests) |
| Coverage | 88.56% statements, 96.89% repository, 90.24% lines |
| CI/CD | Gitea Actions (typecheck, lint, unit-test, build) |
| License | AGPL-3.0 |
| Versioning | CalVer 2026.3.0 |
| Target Browsers | Chrome 102+, Firefox 111+, Safari 17+ |
| Issues | 73 filed, 73 closed (5 errata + 10 elaboration + 20 C1 + 20 C2 + 18 C3) |

---

## Architecture Decisions

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | PGlite (PostgreSQL WASM) as storage engine | Validated |
| ADR-002 | Opt-in capability module system before any WASM | Implemented |
| ADR-003 | Single-writer PGlite Worker via postMessage | Implemented (main-thread init for now; Worker deferred) |
| ADR-004 | Service Worker intercepts localhost:3000 for MCP/REST | Implemented |
| ADR-005 | Chrome 102+ / Firefox 111+ / Safari 17+ | Validated (tiered persistence) |
| ADR-006 | Public API-first design | Implemented |
| ADR-007 | Browser-only v1, sync v2, federated v3 | v1 complete |
| ADR-008 | Agent-discoverable capabilities via MCP tool manifest | Implemented |

---

## Construction Iterations Completed

| Iteration | Focus | Stories | Points | Issues | Status |
|---|---|---|---|---|---|
| C1 | Foundation Stack | 20 | 104 | #16-#35 | COMPLETE |
| C2 | Core CRUD + FTS + SKOS + MCP basics | 20 | 112 | #36-#55 | COMPLETE |
| C3 | Semantic Search + AI + Settings UI | 13 | 80 | #61-#73 | COMPLETE |
| **Total** | | **53** | **296** | | |

### C3 Deliverables (latest iteration)

- GPU capability detection and VRAM-tier model selection
- Semantic embedding pipeline (transformers.js + pgvector HNSW)
- Hybrid BM25 + vector search with RRF fusion (k=60)
- LLM capability module (WebLLM with Llama-3.2-1B)
- AI title generation and auto-tagging via embeddings
- Attachments repository with blob deduplication
- Settings UI with capability management cards
- Note revision history with comparison
- Job queue capability gating

---

## Quality Metrics

| Metric | Target | Actual | Status |
|---|---|---|---|
| Unit test count | — | 603 (27 files) | Passing |
| E2E test count | — | 16 (2 files, Chromium + Firefox) | Passing |
| Statement coverage | 60% | 88.56% | Exceeds |
| Repository coverage | 80% | 96.89% | Exceeds |
| Line coverage | 60% | 90.24% | Exceeds |
| Branch coverage | — | 86.4% | Good |
| Format parity tables | 21 | 10 | Partial (schema-only tables deferred) |
| TypeScript strict | Clean | Clean | Passing |
| ESLint | Clean | Clean | Passing |

---

## Risk Status

| Risk | Status | Evidence |
|---|---|---|
| R-001 (PGlite compatibility) | Retired | PoC + C1-C3 shipping; tiered persistence accepted |
| R-002 (Schema drift) | Mitigated | Format parity test suite (10 tables) |
| R-003 (WebLLM quality) | Accepted | External API config available |
| R-004 (WASM downloads) | Mitigated | Capability module opt-in system |

---

## Deployment

fortemi-react is a static web application. No server required.

```bash
# Development
pnpm install
pnpm dev              # Vite dev server on :5173

# Production build
pnpm build            # Outputs to apps/standalone/dist/
pnpm --filter @fortemi/standalone preview  # Preview on :4173

# Testing
pnpm test:core        # 603 unit/integration tests
pnpm test:e2e         # 16 Playwright E2E tests
pnpm typecheck        # TypeScript strict
pnpm lint             # ESLint
```

Deploy `apps/standalone/dist/` to any static host (Gitea Pages, Netlify, Cloudflare Pages, etc.). No special headers required.

---

## Definition of Done (per story)

1. Code written and passing TypeScript strict compilation
2. ESLint clean
3. Unit tests written (Vitest)
4. Format parity test written (for repository-layer changes)
5. Integration or E2E test for primary flow
6. Coverage >= 60% overall maintained
7. No regressions in existing test suite
8. CI passes on main
