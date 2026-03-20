# Solution Profile — fortemi-browser

**Document Type**: Existing System Profile (Inception Stage)
**Generated**: 2026-03-20

---

## Current Profile

**Selected Profile**: Enterprise (aspirational target)
**Current State**: Pre-inception — no application code exists

### Why Enterprise Profile

fortemi-browser is not a prototype or MVP. It is a production-quality reimplementation of an existing production system (~85K lines, CalVer 2026.2.13) with:
- Full data model parity requirement (40+ entities)
- MCP tool parity (38+ tools — developer/agent integrations depend on this)
- Multiple compliance-adjacent requirements (AGPL-3.0, data format standards, W3C SKOS, W3C PROV)
- Offline-first reliability requirements (must work without network)
- Security-sensitive context (user notes, attachments, potentially encrypted content)

A lower profile would produce something that cannot meet the compatibility guarantees.

---

## Current State Characteristics

### Security
**Current Posture**: Not yet assessed (no code)
**Target Posture**: Strong

Required controls:
- Content Security Policy headers (Service Worker must enforce)
- IndexedDB encrypted at rest (via browser storage APIs or IDBKeyVal with AES-GCM)
- PKE infrastructure (X25519/AES-256-GCM) — data model present, UI deferred to v2
- API key storage: never in localStorage; use sessionStorage or in-memory only
- OPFS file access: scoped, no path traversal possible (browser-enforced)
- No hardcoded tokens anywhere (token-security rule enforced)

**Gaps to address before v1 launch**:
- Define CSP policy for the PWA
- Audit WASM module integrity (subresource integrity for downloaded models)
- Determine if IndexedDB encryption is in scope for v1

### Reliability
**Target SLOs** (offline-first, so availability = local availability):
- Core CRUD operations: 100% (IndexedDB, no network dependency)
- Search (BM25): 100%
- Search (vector): Available only when Semantic module loaded; graceful degradation required
- AI revision: Available only when LLM module loaded or external API configured; graceful degradation required
- Service Worker: Must not crash the tab on SW update — versioned SW with fallback

**Monitoring**:
- Browser console structured logging (mirroring server's JSON logging format)
- Job queue visibility in UI (job_queue store is the source of truth)
- Capability module load status exposed via status endpoint (`GET /api/v1/status`)

### Testing & Quality
**Target Coverage**: 80%+ for repository layer, 60%+ overall
**Test types required**:
- Unit: Repository methods (PGlite SQL queries), RRF fusion logic, UUIDv7 generation
- Integration: Service Worker REST handler end-to-end, job queue processing pipeline, PGlite migration runner
- Compatibility: JSON round-trip tests (server export → browser import → re-export, assert byte-identical)
- E2E: Playwright (offline mode via `page.setOfflineMode(true)`)

**Critical test category**: format parity tests. Every entity type must have a test that:
1. Loads a sample JSON fixture from the fortemi server (real export)
2. Imports into IndexedDB
3. Re-exports as JSON
4. Asserts deep equality

### Process Rigor
**SDLC Adoption**: Full (AIWG framework deployed)
**Code Review**: Self-review + AIWG automated review agents
**Documentation**: Comprehensive (public API = MCP tools + REST surface = must be documented)
**Versioning**: CalVer YYYY.M.PATCH — no leading zeros (matches fortemi server)

---

## Improvement Roadmap

### Phase 1 — Foundation (Weeks 1-4)
Priority: data model and infrastructure that everything else depends on.

- [ ] PGlite proof of concept (PGlite + pgvector + OPFS persistence, browser compatibility matrix)
- [ ] Browser migration v1 (adapted from server `migrations/` DDL — this IS the schema)
- [ ] TypeScript type definitions mirroring all server Rust structs (generated from migration DDL)
- [ ] PGlite worker (single-writer, message-passing coordinator)
- [ ] Event bus (SSE-style, typed events)
- [ ] Capability module system (feature flags + WASM loader — must exist before any WASM is introduced)
- [ ] Service Worker scaffold (REST interception + SW lifecycle management)
- [ ] UUIDv7 generation utility
- [ ] BLAKE3 WASM integration (or SHA-256 fallback)
- [ ] Document types seed data (131 types as static JSON, loaded via migration)
- [ ] Unit tests for all of the above

### Phase 2 — Core Feature Layer (Weeks 5-10)
Priority: working notes app with text search.

- [ ] Note CRUD (create, read, update, soft-delete, restore, purge)
- [ ] Full-text search (PostgreSQL tsvector/tsquery via PGlite — native, no library needed)
- [ ] SKOS concept model (create schemes, concepts, hierarchical relations)
- [ ] Concept tagging (manual)
- [ ] Collections (folder hierarchy)
- [ ] Links (semantic + manual)
- [ ] Provenance edges (W3C PROV)
- [ ] Job queue processing (Web Worker)
- [ ] REST API handlers in Service Worker (notes, search, tags, collections)
- [ ] Format parity tests for all core entities

### Phase 3 — Semantic Layer (Weeks 11-16)
Priority: vector search and hybrid RRF.

- [ ] transformers.js integration (nomic-embed-text, 768-dim)
- [ ] Embedding generation pipeline (via job queue)
- [ ] Vector store in IndexedDB (Float32Array chunks)
- [ ] Cosine similarity search
- [ ] RRF fusion (tsvector FTS + pgvector, k=60, implemented as SQL)
- [ ] Embedding sets (Filter + Full types)
- [ ] Semantic linking (auto-link by vector similarity)
- [ ] Search endpoint parity (all query parameters)

### Phase 4 — AI Layer (Weeks 17-24)
Priority: AI revision and concept tagging.

- [ ] WebLLM integration (Llama 3.2 / Phi-3)
- [ ] External LLM API configuration (OpenAI, Anthropic, Ollama proxy)
- [ ] AI revision pipeline (Standard, Contextual, Light, None modes)
- [ ] Automatic concept tagging (LLM-based, 8-15 concepts per note)
- [ ] Title generation
- [ ] Reference extraction

### Phase 5 — Media Layer (Weeks 25-32)
Priority: file processing capability tiers.

- [ ] PDF extraction (pdf.js)
- [ ] Office documents (mammoth.js for DOCX, SheetJS for XLSX)
- [ ] Image vision (WebLLM vision or external API)
- [ ] Audio transcription (Whisper.js or external API)
- [ ] OPFS blob storage
- [ ] Attachment CRUD + content-addressable deduplication

### Phase 6 — MCP + Polish (Weeks 33-40)
Priority: agent integration parity.

- [ ] All 38 core MCP tools implemented against IndexedDB
- [ ] MCP server via Service Worker (HTTP transport)
- [ ] Multi-memory isolation (per-archive IndexedDB databases)
- [ ] Federated search across archives
- [ ] PWA manifest + install experience
- [ ] Mobile-responsive UI
- [ ] Offline indicator + graceful degradation UX

### Post-v1 (Future)
- Sync protocol with fortemi server (delta sync, conflict resolution)
- ColBERT token re-ranking
- PKE encryption UI
- OAuth2 server integration

---

## Complexity Acknowledgment

This project is among the most technically ambitious browser applications possible:

| Complexity dimension | Assessment |
|---|---|
| Data model breadth | 40+ entities, complex relations — Enterprise-grade |
| Search complexity | Custom BM25 + WASM vector + RRF — research-grade |
| WASM integration | 3+ WASM modules, capability flags — Advanced |
| MCP parity | 38 tools via Service Worker — unique engineering challenge |
| Offline reliability | Full capability without network — Demanding |
| Format parity | 1:1 with 85K-line Rust server — Precision-critical |

**Realistic timeline to v1 (all phases)**: 6-10 months, solo developer.
**Recommended**: Ship capability-gated releases early and often. Phase 1-2 is a usable product on its own.
