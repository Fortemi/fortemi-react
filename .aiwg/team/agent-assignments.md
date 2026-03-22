# Team Profile & Agent Assignments — fortemi-browser

**Version**: 2026.3.0
**Updated**: 2026-03-21

---

## Human Team

| Name | Role | Availability | Responsibilities |
|---|---|---|---|
| roctinam | Lead Developer / Architect | Full-time | All implementation, architecture decisions, code review, releases |

**Team context**: Solo developer, 30+ years systems engineering experience. Deep backend expertise; browser/PWA work is the primary new domain.

---

## AIWG Agent Assignments

Agents activated for this project from `.claude/agents/`:

| Agent | Role | When Used |
|---|---|---|
| Architecture Designer | Schema and system design decisions | ADR drafting, schema review, design questions |
| Software Implementer | Production-quality code delivery | Feature implementation with tests |
| Test Engineer | Test suite design and implementation | Format parity tests, unit/integration/E2E |
| Code Reviewer | TypeScript quality, security, patterns | PR self-review, post-implementation review |
| Technical Writer | Documentation, API docs, MCP tool docs | MCP tool documentation, README updates |
| React Expert | React 19 patterns, component design | UI component architecture, hooks design |
| Frontend Specialist | PWA, Service Worker, accessibility | SW lifecycle, OPFS patterns, PWA manifest |
| Database Optimizer | PGlite query optimization | Query performance, index design, HNSW tuning |
| Migration Planner | Schema migration strategy | Browser migration file authoring |
| Security Auditor | OWASP, CSP, secrets handling | Security review of SW intercept layer, API key storage |
| Debugger | Systematic failure diagnosis | When PGlite/WASM issues arise |
| Performance Engineer | Bundle size, query latency, WASM load time | Capability module profiling, search benchmarks |

---

## Responsibility Matrix

| Artifact | Author | Reviewer |
|---|---|---|
| Browser migration SQL files | roctinam | Architecture Designer (agent) |
| PGlite Worker implementation | roctinam | Database Optimizer (agent) |
| Service Worker REST handlers | roctinam | Security Auditor (agent) |
| Capability module system | roctinam | Code Reviewer (agent) |
| React UI components | roctinam | React Expert (agent) |
| Format parity tests | roctinam + Test Engineer (agent) | Code Reviewer (agent) |
| MCP tool implementations | roctinam | Technical Writer (agent) |
| ADRs | roctinam | Architecture Designer (agent) |
