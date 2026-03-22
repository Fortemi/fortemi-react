# UC-002 — Search Notes

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Critical (Phase 2 — Core, Phase 3 — Semantic)
**Actors**: User, AI Agent (MCP)
**Implements**: Hybrid Search Flow (see `flows.md` §3)

---

## Brief Description

A user or AI agent searches notes using full-text search (always available) and optionally hybrid vector + BM25 search (when semantic capability is enabled). Results are ranked by relevance using RRF fusion (k=60) when hybrid mode is active.

---

## Preconditions

- PGlite Worker is initialized
- At least one note exists (non-deleted)
- For hybrid mode: `semantic` capability module is loaded and embeddings exist

---

## Primary Flow (Hybrid Search)

1. Actor submits search request: `{ q, mode='hybrid', limit=20, tags?, collection_id?, date_range? }`
2. `SearchRepository` checks `CapabilityManager.isReady('semantic')`
3. Semantic module is ready → proceed to hybrid path
4. System executes FTS query in PGlite Worker:
   ```sql
   SELECT note_id, ts_rank(tsv, plainto_tsquery('english', $q)) AS fts_score
   FROM note_revised_current
   JOIN note ON note.id = note_revised_current.note_id
   WHERE tsv @@ plainto_tsquery('english', $q)
     AND note.deleted_at IS NULL
     [AND tag filters]
   ORDER BY fts_score DESC LIMIT 60
   ```
5. System generates query embedding from `q` using semantic module
6. System executes vector query in PGlite Worker:
   ```sql
   SELECT note_id, 1-(vector <=> $query_vector) AS vec_score
   FROM embedding
   ORDER BY vector <=> $query_vector LIMIT 60
   ```
7. System executes RRF fusion (k=60) in PGlite Worker
8. System fetches `NoteSummary` for top `limit` results
9. Returns `SearchResponse { notes: NoteSummary[], semantic_available: true, mode: 'hybrid' }`

---

## Alternative Flows

### 2a — FTS-only (semantic not available)

`CapabilityManager.isReady('semantic')` returns false. Skip steps 5–7. Execute FTS query only. Return `SearchResponse { notes, semantic_available: false, warnings: ['semantic_unavailable'] }`.

### 1a — Temporal search

Actor specifies `mode='temporal'`. System filters by `created_at_utc` range instead of relevance ranking.

### 1b — Semantic-only search

Actor specifies `mode='semantic'`. Requires semantic capability. Returns pure vector results without BM25 component.

### 1c — Federated search (future)

Actor specifies `mode='federated'`. Searches across multiple archives. Merges results from each PGlite instance.

### 7a — MCP tool path

AI agent calls `search` MCP tool. Service Worker intercepts, dispatches to SearchRepository. Returns MCP-formatted results.

---

## Postconditions

- Results are ranked by relevance (RRF score in hybrid mode, FTS score in text-only mode)
- Soft-deleted notes (`deleted_at IS NOT NULL`) are excluded from all results
- `semantic_available` field accurately reflects current capability state

---

## Business Rules

- BR-001: FTS uses `'english'` text search dictionary (matches server)
- BR-002: RRF k=60 (matches server for result convergence)
- BR-003: Vector dimensions must be 768 (matches nomic-embed-text / bge-m3)
- BR-004: Deleted notes must never appear in search results
- BR-005: Maximum result limit is 100; default is 20
- BR-006: Hybrid mode gracefully degrades to FTS-only if semantic unavailable

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | FTS search with semantic unavailable | Returns FTS results; `semantic_available: false` |
| AT-002 | Hybrid search with semantic available | Returns RRF-fused results; `semantic_available: true` |
| AT-003 | Search for deleted note | Deleted note excluded from results |
| AT-004 | Search with tag filter `tags: ['rust']` | Only notes tagged 'rust' returned |
| AT-005 | MCP `search { q: 'rust memory safety', mode: 'hybrid' }` | Returns MCP-formatted results matching server format |
| AT-006 | RRF fusion result ordering | Notes appearing in both FTS and vector results ranked higher |
| AT-007 | Empty query returns recent notes | No error; returns most recent notes |

---

## Non-Functional Requirements

- PERF-002: FTS search < 500ms p95 (10k notes)
- PERF-003: Hybrid search < 1s p95 (10k embeddings)
- FP-001: JSON response matches server SearchResponse shape
- FP-006: RRF k=60
- FP-007: FTS config = 'english'
