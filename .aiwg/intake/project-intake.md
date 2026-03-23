# Project Intake Form — fortemi-react

**Document Type**: Brownfield Inception (blank repo, spec-driven)
**Generated**: 2026-03-20
**Source**: Codebase analysis + interactive clarification
**Companion system**: `fortemi` (Rust server, v2026.2.13) at `~/dev/fortemi/fortemi`

---

## Metadata

- **Project name**: fortemi-react
- **Repository**: fortemi/fortemi-react (Gitea)
- **License**: AGPL-3.0
- **Current version**: 0.0.0 (pre-inception, no source code yet)
- **Companion version**: fortemi server v2026.2.13
- **Tech stack**: React 19+, TypeScript, Vite, idb (raw IndexedDB), transformers.js, WebLLM
- **Primary author**: roctinam

---

## System Overview

**Purpose**: A browser-only implementation of the Fortemi intelligent memory system — full feature capability (notes, SKOS knowledge graph, hybrid search, AI revision, file processing, MCP tools) backed entirely by IndexedDB and WASM models. No server required. Optionally syncs with a Fortemi server.

**Design philosophy**: Modular capability tiers. Users opt into WASM model downloads (embeddings, LLM, audio, vision) based on their needs. A text-only user never downloads a 200MB model. An offline-first power user can run the full stack in a browser tab.

**Current status**: Inception — blank repo, AIWG scaffolding only, no application code.

**Drivers** (all are equally valid):
1. Offline / air-gapped use — Fortemi features without a server
2. Lower barrier to entry — no PostgreSQL + Ollama setup required
3. Mobile / tablet PWA experience
4. Lightweight target for MCP tool/agent development and testing

---

## Problem and Outcomes

**Problem Statement**: The Fortemi server (~85K lines of Rust, PostgreSQL 18 + pgvector, Ollama) is powerful but high-friction to deploy. Users who want intelligent memory features — SKOS tagging, semantic search, AI-enhanced notes, knowledge graph linking — currently must run the full server stack. fortemi-react removes that barrier entirely by running the complete system in a browser tab.

**Target Personas**:
1. **Power user, offline** — researcher, writer, or developer who wants full Fortemi capability while traveling, in restricted networks, or air-gapped environments
2. **Newcomer** — someone who wants to try Fortemi without spinning up Docker/PostgreSQL/Ollama
3. **Mobile user** — tablet or phone user who wants a responsive PWA
4. **Agent developer** — developer building MCP-integrated AI tools who needs a lightweight local Fortemi instance

**Success Metrics**:
- Full data model parity: every entity from the server has a 1:1 IndexedDB object store
- JSON interchange: notes exported from server import cleanly into browser and vice versa
- MCP parity: all 38 core MCP tools work against the browser backend
- Capability flags: user can run text-only with <5MB JS, or full stack with opt-in WASM downloads
- Offline-first: all core operations work with no network

---

## Compatibility Requirements (Critical)

This is the defining constraint of the entire project.

### Data Model Parity

The storage engine is **PGlite** (`@electric-sql/pglite`) — PostgreSQL compiled to WASM, running entirely in-browser with OPFS persistence. This means:

- **All server tables map 1:1 with no type translation** — same column names, same PostgreSQL types, same constraints
- **pgvector extension** (`@electric-sql/pglite/vector`) provides the `vector(768)` column type and HNSW indexing — identical to the server
- **tsvector / FTS** is native PostgreSQL — `tsv` column, same `tsvector` type, same query syntax
- **Schema migrations** are standard SQL files — the server's `migrations/` directory is the reference; browser migrations adapt the same DDL
- **ALTER TABLE works** — schema evolution is a first-class, solved problem

Every server table has a 1:1 equivalent in PGlite with zero type adaptation required:

| Server table | PGlite table | Notes |
|---|---|---|
| `note` | `note` | Identical DDL |
| `note_original` | `note_original` | Identical DDL |
| `note_revised_current` | `note_revised_current` | `tsv tsvector GENERATED` — native in PGlite |
| `note_revision` | `note_revision` | Identical DDL |
| `attachment` | `attachment` | Identical DDL |
| `attachment_blob` | `attachment_blob` | `data BYTEA` — inline for small files; large files use OPFS (same threshold as server) |
| `embedding` | `embedding` | `vector(768)` via pgvector extension |
| `embedding_set` | `embedding_set` | Identical DDL |
| `skos_concept` | `skos_concept` | Identical DDL |
| `skos_concept_relation` | `skos_concept_relation` | Identical DDL |
| `skos_scheme` | `skos_scheme` | Identical DDL |
| `note_tag` | `note_tag` | Identical DDL |
| `note_skos_tag` | `note_skos_tag` | Identical DDL |
| `link` | `link` | Identical DDL |
| `provenance_edge` | `provenance_edge` | Identical DDL |
| `collection` | `collection` | Identical DDL |
| `archive` | `archive` | Each archive = separate PGlite database instance (OPFS path: `fortemi-{name}`) |
| `job_queue` | `job_queue` | Identical DDL |
| `document_type` | `document_type` | Seeded from static JSON on first run |
| `api_key` | `api_key` | Identical DDL |

**Multi-memory isolation**: Each archive is a **separate PGlite database instance** (mirroring PostgreSQL schema-level isolation). Default archive uses OPFS path `fortemi-public`. Named archives use `fortemi-{name}`. Archive switching swaps the active PGlite instance reference.

### JSON Interchange Format

JSON exported from the fortemi server must import cleanly into fortemi-react and vice versa:
- Field names: identical (PGlite uses same column names as server)
- UUIDs: UUIDv7 strings (time-ordered)
- Timestamps: ISO 8601 with UTC timezone (`2026-01-24T12:00:00.000Z`)
- Enums: string literals matching server Rust enum serializations
- JSONB fields: plain JSON objects
- Vectors: arrays of floats (JSON API), stored as `vector(768)` in PGlite via pgvector

### REST API Surface (Service Worker)

fortemi-react registers a Service Worker that intercepts requests to `http://localhost:3000` (or a configurable base URL) and serves them from PGlite — making the browser backend **indistinguishable from the server** to MCP tools and integrations.

Full endpoint compatibility:
- `POST/GET/PATCH/DELETE /api/v1/notes`
- `GET /api/v1/search`
- `POST /api/v1/notes/{id}/attachments`
- `GET/PATCH/DELETE /api/v1/notes/{id}/versions`
- `GET/POST/DELETE /api/v1/concepts`
- `GET/POST/PATCH/DELETE /api/v1/collections`
- `GET/POST/DELETE /api/v1/embedding-sets`
- `GET /api/v1/jobs`, `GET /api/v1/jobs/{id}`
- `GET /health`, `GET /api/v1/status`
- OAuth2 discovery endpoints (passthrough or local mock)

Error response format: `{ "error": string, "code"?: string }` — matching server exactly.

### Sync Protocol (Post-v1)

Not in scope for v1, but the data model must accommodate it from day one:
- All primary keys are UUIDv7 (time-ordered, server-compatible)
- `deleted_at` soft-delete pattern preserved (critical for sync tombstoning)
- `updated_at_utc` on all mutable entities (sync cursor)
- No synthetic auto-increment IDs anywhere — always UUIDs
- Conflict strategy: last-write-wins on notes (by `updated_at_utc`), merge on tags

---

## Architecture (Current Design)

### Style: Modular Browser Application (PWA)

```
┌────────────────────────────────────────────────────────────┐
│  React UI (components, views, routing)                     │
├────────────────────────────────────────────────────────────┤
│  Event Bus (SSE-compatible reactive event model)           │
├────────────────────────────────────────────────────────────┤
│  Browser API Layer (mirrors REST surface)                  │
│  ├── NotesRepository                                       │
│  ├── SearchRepository (tsvector FTS + pgvector + RRF)     │
│  ├── TagsRepository (SKOS)                                 │
│  ├── AttachmentsRepository                                 │
│  └── JobQueue (async processing pipeline)                  │
├────────────────────────────────────────────────────────────┤
│  Capability Modules (opt-in WASM)                         │
│  ├── EmbeddingModule (transformers.js, nomic-embed-text)  │
│  ├── LLMModule (WebLLM or external API)                   │
│  ├── AudioModule (Whisper.js or external API)             │
│  └── VisionModule (WebLLM or external API)                │
├────────────────────────────────────────────────────────────┤
│  PGlite Worker (single-writer, message-passing)            │
│  ├── PGlite (public archive)    ← opfs://fortemi-public   │
│  ├── PGlite (named archives)    ← opfs://fortemi-{name}   │
│  ├── pgvector extension (vector(768) + HNSW)              │
│  └── SQL migration runner                                  │
├────────────────────────────────────────────────────────────┤
│  OPFS (raw file handles for blobs >10MB)                   │
│  └── blobs/{xx}/{xx}/{uuid}.bin                            │
├────────────────────────────────────────────────────────────┤
│  Service Worker                                            │
│  ├── REST API interception (localhost:3000 compatibility)  │
│  └── MCP tool handler (38 core tools)                      │
└────────────────────────────────────────────────────────────┘
```

### Eventing Model

Replicates the server's SSE event model. Every write operation emits a typed event on the bus. UI components subscribe to relevant event types. This enables reactive updates without polling and decouples the data layer from the view layer.

Key event types (mirroring server SSE):
- `note.created`, `note.updated`, `note.deleted`
- `note.job.queued`, `note.job.completed`, `note.job.failed`
- `embedding.ready`, `search.index.updated`
- `archive.switched`

### Capability Tiers

Users activate capability modules on demand. Each module downloads and caches its WASM model:

| Tier | Download | Features unlocked |
|---|---|---|
| **Text** (always active) | 0 MB | Note CRUD, BM25 FTS, SKOS tagging, collections, links, provenance |
| **Semantic** (opt-in) | ~100 MB | Vector embeddings (nomic-embed-text), semantic search, RRF fusion |
| **LLM** (opt-in) | ~1-4 GB or API key | AI revision (Standard/Contextual/Light), concept tagging, title generation |
| **Vision** (opt-in) | ~2 GB or API key | Image description, document type inference for images |
| **Audio** (opt-in) | ~100 MB or API key | Audio/video transcription (Whisper.js) |
| **PDF/Office** (opt-in) | ~5 MB | PDF extraction (pdf.js), DOCX/XLSX (mammoth.js, SheetJS) |

### Document Types

All 131 server document types are shipped as static JSON seed data. Browser-unsupported extraction strategies (e.g., `glb_3d_model`, `video_multimodal` without the Vision module) degrade gracefully — the attachment is stored but extraction is skipped or queued for server processing.

### Job Queue

Mirrors the server's `job_queue` table semantics in IndexedDB. A browser-native worker (Web Worker or service worker) processes jobs asynchronously. Job types supported:
- `embedding` (requires Semantic module)
- `ai_revision` (requires LLM module)
- `concept_tagging` (chains from ai_revision)
- `title_generation`
- `linking` (requires embeddings)
- `extraction` (attachment processing)
- `audio_transcription` (requires Audio module)
- `vision` (requires Vision module)

### Search Implementation

Full hybrid FTS + vector + RRF (Reciprocal Rank Fusion):

1. **Full-text search**: PostgreSQL `tsvector`/`tsquery` via PGlite — same engine as server. `note_revised_current.tsv` is a `GENERATED` tsvector column, updated automatically on content change.
2. **Vector**: pgvector `<=>` cosine distance operator on `embedding.vector vector(768)` — HNSW index, same as server.
3. **RRF**: `score = 1 / (60 + rank)` fusion — identical constant to server, implemented in SQL.
4. **Filters**: `StrictTagFilter` (AND/OR/NOT logic on SKOS concepts) expressed as parameterized SQL — same logic as server's Rust implementation.

When the Semantic module is not loaded, the vector step is skipped and FTS-only results are returned with `semantic_available: false` — matching the server's response format exactly.

---

## Key Technical Decisions

### Storage Engine: PGlite (PostgreSQL WASM)

**Decision**: `@electric-sql/pglite` with `@electric-sql/pglite/vector` extension, persisted to OPFS.

**Why PGlite over IndexedDB:**
- **Schema evolution**: Real `ALTER TABLE`, `CREATE INDEX`, `DROP COLUMN` — no migration gymnastics. IndexedDB has no equivalent; adding a column requires rebuilding the entire object store and migrating all data manually via `onupgradeneeded`.
- **Full-text search parity**: Native `tsvector`/`tsquery` with the same stemming and ranking as the server. No custom BM25 implementation needed.
- **Vector parity**: pgvector `vector(768)` column type with HNSW indexing — identical to server. No Float32Array scan loops.
- **SQL query power**: The complex filtering in the server (StrictTagFilter with AND/OR/NOT on SKOS concepts, temporal filters, metadata filters) is written as SQL on the server and can be written as the same SQL in PGlite.
- **Migration strategy**: Server `migrations/` files are the reference. Browser migration files adapt the same DDL, skipping server-only features (partitioning, roles, publications). Same numbered sequence.

**Tradeoffs accepted:**
- PGlite is single-writer (one connection per database). Concurrent write from Service Worker + main thread requires message-passing coordination. Mitigated by routing all writes through a single worker.
- ~6-10MB WASM bundle (loaded once, cached). Acceptable for a PWA.
- PGlite startup time (~50-200ms on OPFS open). Acceptable; shown as loading state.

### Multi-memory isolation: Separate PGlite instances

Each archive = a separate PGlite database instance with its own OPFS file. Mirrors PostgreSQL schema-level isolation. Default: `opfs://fortemi-public`. Named archives: `opfs://fortemi-{name}`. Archive switching swaps the active instance reference. Federated search opens multiple instances concurrently (read-only queries are safe).

### File storage: OPFS (Origin Private File System)

**Two-tier storage:**
1. **PGlite** (`attachment_blob.data BYTEA`): Inline storage for files ≤10MB — same threshold as server. PGlite itself is persisted in OPFS, so this is effectively OPFS-backed.
2. **Raw OPFS** (`navigator.storage.getDirectory()`): Direct file handles for attachments >10MB. Path structure mirrors server: `blobs/{first2}/{next2}/{uuid}.bin`. BLAKE3 hashing for deduplication (wasm-blake3). Reference counting in `attachment_blob.reference_count`.

Storing large binaries directly in PGlite's WAL would cause excessive WAL growth and slow checkpoint performance. OPFS raw file handles bypass this entirely — same reason the server uses filesystem storage rather than PostgreSQL BYTEA for large files.

### UUIDv7 generation

Client-side UUIDv7 (time-ordered) using a browser-compatible implementation. Same format as server. Critical for sync compatibility.

---

## Compatibility Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| WASM model sizes (200MB+ for embeddings) | HIGH | Capability module system — opt-in only |
| Embedding dimension drift (server may change model) | HIGH | Store model name + dimension in `embedding` row; re-embed on model change |
| PGlite single-writer constraint | MEDIUM | Route all writes through a single dedicated worker; reads can be concurrent |
| PGlite OPFS storage quota limits (~60% of free disk) | MEDIUM | Separate OPFS files for large blobs; warn user at 80% quota |
| Server migration DDL not 100% compatible with PGlite | MEDIUM | Maintain browser-specific migration files adapted from server originals; test on every server migration |
| BM25/tsvector ranking divergence (config, stemming) | LOW | Server uses English stemming config; PGlite uses default. Document; rankings may differ but result sets converge |
| BLAKE3 WASM not available in all browsers | LOW | Fallback to SHA-256 with migration path |
| WebLLM quality gap vs server LLM (Llama 3.2 vs larger) | HIGH | Allow external API config; document clearly |
| Service Worker API interception latency | LOW | Acceptable for MCP tool use cases |
| UUIDv7 collision if offline clocks skew | LOW | Machine ID component in UUIDv7 generation |
| PGlite startup time on large databases | MEDIUM | Show loading indicator; pre-warm in background on app load |
| Safari < 17 OPFS sync API incompatibility | LOW | Document Safari 17+ minimum; Mac/Win/Linux Chrome or Firefox have no issues; iOS out of scope v1 |

---

## Known Scope Boundaries (v1)

The following server features are **deferred** (not v1):
- Sync protocol with server (data model accommodates it — no blocking decisions)
- ColBERT token-level re-ranking (architecture supports it, not implemented)
- PKE (X25519/AES-256-GCM) encryption (data model present, UI deferred)
- Federated search across archives (architecture supports, not optimized for v1)
- OAuth2 server integration (local mock only in v1)

---

## Team and Process

**Team size**: Solo developer (roctinam)
**Development style**: Parallel tracks, full scope, no feature scope reduction
**Version scheme**: CalVer `YYYY.M.PATCH` (no leading zeros) — matching fortemi server convention
**License**: AGPL-3.0
**Repository**: Gitea (fortemi/fortemi-react)

---

## Next Steps

1. Review and refine this intake for accuracy
2. **PGlite proof of concept** — verify PGlite + pgvector + OPFS persistence works in target browsers (Safari is the risk)
3. Write browser migration file v1 (adapted from server `migrations/` DDL) — this is the schema; get it right before any application code
4. **Scaffold the capability module system** before any WASM code is introduced
5. Implement the PGlite worker (single-writer message-passing pattern)
6. Implement the Service Worker REST interception layer
7. Build the event bus
8. Then: core CRUD → FTS search → SKOS → embeddings → AI modules
9. Sync protocol: design phase after core is stable

**Companion documents**:
- `solution-profile.md` — profile selection and maturity assessment
- `option-matrix.md` — project context, priorities, trade-offs
