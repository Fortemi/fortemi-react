# Phase Plan — Elaboration

**Project**: fortemi-browser
**Phase**: Elaboration
**Version**: 2026.3.0
**Planned Start**: 2026-03-22
**Planned End**: 2026-05-16 (8 weeks)
**Status**: READY TO START

---

## Phase Objective

Establish the architectural baseline via an executable prototype (PGlite PoC), retire the top architectural risk (R-001), elaborate architecturally significant use cases, complete the Software Architecture Document, and produce a baselined Construction iteration plan.

---

## Elaboration Iteration Plan

### Elaboration Iteration 1 — Architectural Baseline (Weeks 1–4)

**Goal**: Prove PGlite + pgvector + OPFS sync API works in target browsers. Retire R-001.

**Stories**:

| ID | Story | Points | Priority |
|---|---|---|---|
| E1-1 | PGlite initialized in Web Worker with OPFS persistence | 8 | CRITICAL |
| E1-2 | pgvector extension loaded and HNSW index created | 5 | CRITICAL |
| E1-3 | Single-writer message bus (postMessage) operational | 5 | CRITICAL |
| E1-4 | Browser migration runner (sequential SQL file execution) | 5 | CRITICAL |
| E1-5 | Migration 0001 (initial schema — note, note_original, note_revised_current) applied | 8 | CRITICAL |
| E1-6 | Service Worker registered; intercepts `localhost:3000` | 5 | HIGH |
| E1-7 | Capability module scaffold (CapabilityManager interface, registration API) | 5 | HIGH |
| E1-8 | Event bus (SSE-style) operational between Worker and UI | 3 | HIGH |
| E1-9 | BLAKE3 WASM loaded; SHA-256 fallback verified | 3 | MEDIUM |
| E1-10 | PoC report: Chrome, Firefox, Safari 17+ compatibility confirmed | 3 | CRITICAL |

**Exit Criteria**:
- PGlite opens in Chrome 102+, Firefox 111+, Safari 17+ with OPFS persistence
- pgvector HNSW index created and a vector INSERT/SELECT round-trip succeeds
- R-001 retired from active risk register

---

### Elaboration Iteration 2 — Architecture Document + Construction Readiness (Weeks 5–8)

**Goal**: Complete SAD, elaborate all 8 use cases, baseline iteration plans, pass elaboration gate.

**Stories**:

| ID | Story | Points | Priority |
|---|---|---|---|
| E2-1 | Software Architecture Document (SAD) finalized | 8 | HIGH |
| E2-2 | Use cases UC-001 through UC-008 elaborated with flows | 8 | HIGH |
| E2-3 | Supplementary requirements (NFRs) documented | 3 | HIGH |
| E2-4 | Test strategy (Vitest + Playwright) documented | 5 | HIGH |
| E2-5 | Construction iteration plans C1 and C2 baselined | 5 | HIGH |
| E2-6 | CM plan (Gitea Actions CI pipeline) documented | 3 | MEDIUM |
| E2-7 | Format parity test framework scaffolded (no tests yet) | 5 | HIGH |
| E2-8 | Elaboration gate evaluation | 3 | CRITICAL |

**Exit Criteria**:
- SAD approved
- All 8 UCs elaborated
- Construction iteration C1 plan baselined
- Elaboration gate passed

---

## Elaboration Milestones

| Milestone | Target Date | Status |
|---|---|---|
| Inception gate passed | 2026-03-21 | COMPLETE |
| Elaboration Iteration 1 start | 2026-03-22 | PENDING |
| PGlite PoC working (R-001 retired) | 2026-04-18 | PENDING |
| SAD draft complete | 2026-05-02 | PENDING |
| All UCs elaborated | 2026-05-09 | PENDING |
| Test strategy complete | 2026-05-09 | PENDING |
| Construction plan baselined | 2026-05-09 | PENDING |
| Elaboration gate | 2026-05-16 | PENDING |

---

## Risks to Retire in Elaboration

| Risk | Retirement Action | Target |
|---|---|---|
| R-001 (PGlite compatibility) | Executable PoC in browsers | Iter 1, Week 4 |
| R-002 (schema drift) | Format parity test framework scaffolded | Iter 2, Week 8 |
| R-007 (SW update disruption) | SW update lifecycle verified in PoC | Iter 1, Week 4 |

---

## Elaboration Artifacts

| Artifact | Owner | Target | Status |
|---|---|---|---|
| Executable PGlite PoC | roctinam | Week 4 | PENDING |
| `.aiwg/architecture/SAD.md` | roctinam | Week 6 | PENDING |
| `.aiwg/requirements/use-cases/UC-001..008` | roctinam | Week 7 | PENDING |
| `.aiwg/requirements/supplementary-requirements.md` | roctinam | Week 6 | PENDING |
| `.aiwg/testing/test-strategy.md` | roctinam + Test Engineer | Week 7 | PENDING |
| `.aiwg/planning/iteration-plan-construction-1.csv` | roctinam | Week 8 | PENDING |
| `.aiwg/planning/iteration-plan-construction-2.csv` | roctinam | Week 8 | PENDING |
| `.aiwg/deployment/cm-plan.md` | roctinam | Week 8 | PENDING |
| `.aiwg/gates/gate-elaboration.md` | roctinam | Week 8 | PENDING |

---

## Notes

- Elaboration Iteration 1 is the single highest-priority work item in the entire project. If R-001 materializes (PGlite/pgvector/OPFS unsupported), the architecture must pivot before any further code is written.
- The PoC should be the minimum code to prove the stack — it does not need to be production-quality. It will inform but not directly merge into Phase 1 construction code.
- Format parity test scaffold in E2-7 is a framework only (no test cases). Test cases come in Phase 1 of Construction.
