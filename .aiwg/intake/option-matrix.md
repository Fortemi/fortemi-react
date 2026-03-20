# Option Matrix — fortemi-browser

**Purpose**: Capture what this project IS — its nature, audience, constraints, and intent — to determine appropriate SDLC framework application.
**Generated**: 2026-03-20

---

## Step 1: Project Reality

### What IS This Project?

**Project Description**:

fortemi-browser is a browser-only reimplementation of the Fortemi intelligent memory server — a production Rust/PostgreSQL system at v2026.2.13 with ~85K lines of code. The browser version targets 100% data model parity (JSON import/export compatibility, mirrored IndexedDB schema, identical REST API surface via Service Worker) while running entirely client-side using IndexedDB and opt-in WASM capability modules (transformers.js for embeddings, WebLLM for AI revision, Whisper.js for audio, pdf.js for documents). No server required for any feature. AGPL-3.0, solo developer.

### Audience & Scale

**Who uses this?**
- [x] Just me / small team (initial audience — developer-first)
- [x] External users (100-10k) — once published, anyone who wants Fortemi without a server
- [x] Developer/agent integrations — MCP tool consumers targeting the API surface

**Audience Characteristics**:
- Technical sophistication: Mixed (knowledge workers + developers + AI agent integrations)
- User risk tolerance: Expects stability (format parity is a hard guarantee — breakage destroys synced data)
- Support expectations: Self-service (AGPL, open source)

**Usage Scale** (initial):
- Active users: 0 (pre-launch)
- Request volume: In-process, not networked (Service Worker intercepts)
- Data volume: User-dependent; large power users may have GB+ of attachments
- Geographic distribution: Single user, local browser

### Deployment & Infrastructure

**Expected Deployment Model**:
- [x] Client-only (PWA, browser application)
- [x] Static site (served from GitHub Pages, Gitea Pages, Netlify, or self-hosted)
- No backend server required for any v1 feature

**Where does this run?**
- [x] Browser (PWA, installable)
- [x] Local only (OPFS data never leaves the device unless user exports)
- Optional: Self-hosted static file server

**Infrastructure Complexity**:
- Deployment: Static HTML/JS/CSS + Service Worker (zero server infrastructure)
- Data persistence: PGlite/OPFS (structured data, PostgreSQL WASM) + OPFS raw files (blobs >10MB)
- External dependencies: 0 required; transformers.js models (CDN or bundled), WebLLM (CDN), optional LLM API
- Network topology: Standalone (offline-first); optional outbound API calls for LLM/embedding if user configures

### Technical Complexity

**Codebase Characteristics**:
- Size: Target ~30-50K LoC TypeScript (estimated at full scope)
- Languages: TypeScript (primary), CSS (secondary), WASM (third-party modules)
- Architecture: Modular browser application — PGlite (PostgreSQL WASM), Repository layer, Event bus, Capability modules, Service Worker
- Team familiarity: Brownfield (implementing against a known spec: the Rust server)

**Technical Risk Factors** (all apply):
- [x] Performance-sensitive: PGlite tsvector + pgvector search must be fast enough for interactive use
- [x] Security-sensitive: User notes, attachments, potential PII; API key handling
- [x] Data integrity-critical: Format parity breakage = data corruption on sync
- [x] High concurrency: Service Worker handles requests while Web Workers process jobs
- [x] Complex business logic: SKOS hierarchy, RRF fusion, capability module flags, job queue
- [x] Integration-heavy: PGlite WASM, WASM models (transformers.js, WebLLM, Whisper.js), Service Worker, MCP protocol

---

## Step 2: Constraints & Context

### Resources

**Team**:
- Size: 1 developer (solo)
- Experience: Senior (30+ years system engineering per project context)
- Availability: Full-time (primary project)

**Budget**:
- Development: Unconstrained (personal project)
- Infrastructure: Zero — static files only
- Timeline: No fixed deadline; capability-gated releases preferred

### Regulatory & Compliance

**Data Sensitivity**:
- [x] User-provided content (notes, attachments)
- [x] PII possible (user stores what they want)
- No payment information, no PHI requirements

**Regulatory Requirements**:
- [ ] GDPR (user's own data, stored locally — no processor relationship)
- AGPL-3.0 license compliance (source disclosure requirements for modifications)

**Contractual Obligations**:
- [x] Format compatibility guarantee (implicit: users trusting browser↔server round-trip integrity)

### Technical Context

**Current State**:
- Stage: Inception (zero application code)
- Test coverage: N/A
- Documentation: README only (1 line)
- Deployment automation: None yet

**Technical Debt**:
- Severity: None (greenfield)
- Constraint: Browser migration files must stay synchronized with server migration files. A server migration that adds a column must have a corresponding browser migration. Drift here = sync breakage.

---

## Step 3: Priorities & Trade-offs

### What Matters Most?

**Priority ranking** (stated by developer):
1. **Quality / format parity** — non-negotiable. A note that breaks on import/export is a bug, always.
2. **Reliability / offline-first** — the whole point is no-server. Degradation must be graceful and clearly communicated.
3. **Delivery speed** — full scope in parallel, early capability-gated releases
4. **Cost efficiency** — zero infrastructure cost is a hard constraint

**Priority Weights**:

| Criterion | Weight | Rationale |
|---|---|---|
| Quality / parity | 0.40 | Format breakage = trust destruction; JSON round-trip is a first-class test suite |
| Reliability / offline | 0.30 | Offline-first is the core value proposition; must work without network |
| Delivery speed | 0.20 | Parallel tracks; ship text-only layer fast, add WASM tiers iteratively |
| Cost efficiency | 0.10 | Zero infrastructure cost is non-negotiable; WASM downloads must be opt-in |
| **TOTAL** | **1.00** | |

### Trade-off Context

**What you're optimizing for**:
```
Full compatibility with the fortemi server's data model, even when that means
deferring features. A clean schema that supports future sync is worth more than
a quick implementation that requires a breaking migration later.
```

**What you're willing to sacrifice**:
```
Feature completeness at any given release. It's fine to ship with capability
modules inactive or deferred (audio, video, 3D rendering). It's not fine to
ship with schema differences that break round-trip compatibility.
```

**What is non-negotiable**:
```
1. UUIDv7 primary keys from day one (sync dependency)
2. Soft-delete pattern (deleted_at nullable) on all mutable entities
3. JSON field names identical to server serializations
4. Capability module system — users must never be forced to download WASM they don't need
5. AGPL-3.0 license (no proprietary dependencies)
```

---

## Step 4: Intent & Decision Context

### Why This Intake Now?

**What triggered this intake**: Beginning a new project — establishing architecture baseline before writing any code. The server already exists and is the canonical reference. This intake captures the design intent and hard constraints before they can be forgotten or violated.

**What decisions need making before coding starts**:
```
1. Exact TypeScript type definitions for all 20+ entities (must match server JSON exactly)
2. Browser migration v1 SQL file (adapted from server DDL — this IS the schema definition, reviewed before any application code)
3. Capability module loading API (how UI code requests and waits for WASM)
4. Service Worker versioning strategy (how to update SW without data loss)
5. Event bus API (what events, what payloads, what subscription model)
```

**What's uncertain or controversial**:
```
- PGlite uses the same tsvector/tsquery engine as the server, so FTS ranking parity is achievable.
  Minor divergence possible if the server uses custom text search configurations (language dictionaries,
  stop word lists). Decision: compare server FTS config; replicate in PGlite migration if needed.

- PGlite requires the synchronous OPFS API (`createSyncAccessHandle()`) in a Worker.
  Chrome 102+ and Firefox 111+ support this fully. Safari's WebKit engine is the only
  concern — Safari 17+ works; earlier versions do not. Mac/Windows/Linux users on
  Chrome or Firefox have no issues. Decision: require Safari 17+ if supporting Safari;
  document clearly. iOS Safari (WebKit-only on iOS regardless of browser label) is out
  of scope for v1.

- IndexedDB performance for vector search (full scan of Float32Array embeddings).
  May need a WASM HNSW index (hnswlib-wasm) for collections >10k notes.
  Decision: implement naive scan first, add HNSW in Phase 3 if benchmarks show need.
```

**Success criteria for this intake**:
```
Clear shared understanding (even for a solo developer) of:
1. Where the hard constraints live (schema, UUIDs, JSON format)
2. What can flex (search ranking, capability ordering, UI design)
3. What the phased build plan looks like
4. What "done" looks like for format parity (the test suite)
```

---

## Step 5: Framework Application

### Relevant SDLC Components

**Templates**:
- [x] Intake (this document set) — **Active**
- [x] Architecture (SAD, ADRs) — **Active** — Data model decisions have long-lived consequences; must be documented
- [x] Test (test-strategy, test-cases) — **Active** — Format parity tests are the critical path
- [ ] Requirements (user stories) — Skip — Solo developer with clear spec (the server is the spec)
- [ ] Security templates — Defer to Phase 6 (no PII in transit for v1 offline use)
- [ ] Governance — Skip — Solo developer, no stakeholders
- [ ] Deployment plan — Lightweight (static site deploy is trivial)

**Commands**:
- [x] `intake-from-codebase` — used (this session)
- [x] `flow-iteration-dual-track` — for ongoing development iterations
- [x] `pr-review` — self-review via AIWG
- [x] `architecture-evolution` — when schema changes are needed
- [x] `test-coverage` — to track format parity test completeness
- [ ] Quality gates — Add in Phase 3+ when there's enough code to gate
- [ ] `flow-concept-to-inception` — skip (already past this)

**Agents**:
- [x] Architecture Designer — Schema design decisions
- [x] Test Engineer — Format parity test suite
- [x] Code Reviewer — TypeScript quality review
- [x] Technical Writer — MCP tool documentation
- [x] Software Implementer — Core implementation
- [ ] Security Architect — Defer to Phase 6
- [ ] DevOps Engineer — Minimal (static site only)
- [ ] Enterprise specialists — Not applicable

**Process Rigor Level**: Full — justified by:
- Data model decisions that cannot be changed without breaking sync compatibility
- MCP tool surface that external agents depend on
- Solo developer who benefits from the discipline of documented decisions

### Rationale for Framework Choices

```
This is a solo project but with enterprise-grade compatibility requirements.
The SDLC framework is useful not for coordination overhead but for:

1. Architecture records (ADRs for key schema decisions — these are permanent)
2. Format parity test strategy (test cases before implementation, not after)
3. Iteration structure (prevents thrashing — build in phases, complete each phase)

Skipping: requirements templates (server is the spec), governance (solo),
security templates (offline-first, no PII in v1 transit), deployment plans (trivial).

Keeping: architecture docs, test strategy, iteration flow, code review.
```

**Explicitly skipping and why**:
- Requirements docs: The fortemi server's OpenAPI spec, Rust models, and PostgreSQL schema ARE the requirements. No translation needed — just implement them.
- Governance templates: No team, no approval process needed.
- Security templates v1: User's own data, stored locally, no transmission. Will revisit for sync phase.

---

## Step 6: Evolution & Adaptation

### Expected Changes

- [x] Feature expansion (capability tiers unlock over phases)
- [x] Technical pivot (sync protocol addition — after core is stable)
- [x] User base growth (once published, open source adoption)
- [ ] Team expansion (possible — solo for now)
- [ ] Compliance requirements (GDPR may apply if hosted as a service)

### Adaptation Triggers

```
Add sync documentation when: sync protocol design begins (post-v1)
Add security templates when: user data is transmitted (sync phase begins)
Add governance when: second developer joins
Add compliance review when: hosted as a service (not just a static file)
Add team onboarding when: first external contributor opens a PR
```

### Planned Framework Evolution

- **Now (Inception)**: Intake documents, Architecture SAD, Test strategy
- **Phase 1-2**: Iteration flow (dual-track), ADRs for each key schema decision
- **Phase 3-5**: Test coverage tracking, code review gates
- **Phase 6 (sync)**: Security review, compliance check, full documentation pass
- **Post-sync**: Governance if team grows, SOC2 if commercial hosting

---

## The Hardest Questions (Answered)

These were the make-or-break questions surfaced during intake:

**Q: Does "100% format parity" mean feature parity or data parity?**
A: Data parity. JSON round-trip integrity is the hard requirement. Feature parity (search ranking quality, AI output quality) is best-effort, documented honestly.

**Q: How do vector embeddings work without Ollama?**
A: transformers.js (nomic-embed-text or equivalent). Same 768-dim vectors, same Float32Array format. Opt-in module, ~100MB download cached after first use.

**Q: What happens to AI revision features (the server's core value) without a local LLM?**
A: WebLLM for fully offline capability (smaller model, acceptable quality); OR external LLM API (OpenAI, Anthropic, local Ollama proxy) via user configuration. Both supported. Notes stored with `revision_mode: none` when neither is configured — format-compatible, revisable later.

**Q: Is this project actually achievable by a solo developer?**
A: In phases, yes. Text-only + search + SKOS (Phases 1-2) is a complete, useful, shippable product. Each subsequent phase adds a capability tier without breaking the prior one. The key discipline is: never break schema compatibility, and ship early.
