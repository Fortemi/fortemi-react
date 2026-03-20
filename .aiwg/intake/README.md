# fortemi-browser — Design & Intake Documents

**Generated**: 2026-03-20
**Status**: Approved (inception phase)

---

## Document Index

### Intake (What / Why)

| Document | Purpose |
|---|---|
| [project-intake.md](./project-intake.md) | System overview, compatibility requirements, architecture summary, risk register, next steps |
| [solution-profile.md](./solution-profile.md) | Enterprise profile rationale, security posture, test strategy, 6-phase build roadmap |
| [option-matrix.md](./option-matrix.md) | Project reality, constraints, priorities, trade-offs, hard questions answered |

### Architecture (How)

| Document | Purpose |
|---|---|
| [architecture.md](./architecture.md) | System context, container diagram, layer diagram, PGlite worker pattern, Service Worker flow, capability module lifecycle, archive switching |
| [data-model.md](./data-model.md) | Full ERD, subsystem ERDs (notes, SKOS, embeddings, files, jobs, provenance), complete table inventory |
| [flows.md](./flows.md) | Note creation pipeline, job queue state machine, hybrid search flow, note lifecycle, attachment processing, blob GC, migration strategy, MCP tool flow |

### Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](./adrs/ADR-001-pglite-storage-engine.md) | PGlite (PostgreSQL WASM) as storage engine — why not IndexedDB or SQLite |
| [ADR-002](./adrs/ADR-002-capability-modules.md) | Opt-in capability module system — must exist before any WASM code |
| [ADR-003](./adrs/ADR-003-pglite-single-writer.md) | Single-writer PGlite Worker pattern — message-passing coordinator |
| [ADR-004](./adrs/ADR-004-service-worker-api.md) | Service Worker REST API interception — MCP tool compatibility |
| [ADR-005](./adrs/ADR-005-browser-compatibility.md) | Browser compatibility matrix — Chrome 102+, Firefox 111+, Safari 17+ |

---

## Key Constraints (Non-Negotiable)

1. **UUIDv7** primary keys everywhere — sync compatibility
2. **Soft-delete** (`deleted_at` nullable) on all mutable entities — sync tombstoning
3. **JSON field names** identical to server serializations — format parity
4. **Capability module system** built before any WASM code — no forced downloads
5. **AGPL-3.0** — no proprietary dependencies
6. **CalVer** `YYYY.M.PATCH` (no leading zeros) — matches server versioning

## Build Phases (Summary)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 — Foundation | 1-4 | PGlite PoC, migration v1, capability system, Service Worker, event bus |
| 2 — Core | 5-10 | Note CRUD, FTS search, SKOS, collections, links, REST handlers |
| 3 — Semantic | 11-16 | transformers.js embeddings, pgvector search, RRF fusion |
| 4 — AI | 17-24 | WebLLM + external API, revision pipeline, concept tagging |
| 5 — Media | 25-32 | PDF/Office, vision, audio, OPFS blobs |
| 6 — MCP + Polish | 33-40 | 38 MCP tools, multi-archive, PWA, mobile |

## Reference: fortemi Server

The server at `~/dev/fortemi/fortemi` (Rust, v2026.2.13) is the **canonical reference** for:
- Data model (PostgreSQL schema)
- API response formats (OpenAPI spec)
- Migration history (87+ numbered files)
- MCP tool specifications (mcp-server/src/)
- Search algorithms (BM25 + pgvector RRF)
