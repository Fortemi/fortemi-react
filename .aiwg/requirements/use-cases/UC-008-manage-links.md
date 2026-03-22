# UC-008 — Manage Note Links

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Medium (Phase 2 — Core)
**Actors**: User, AI Agent (MCP), Job Queue Worker (automated semantic linking)
**Implements**: Note creation pipeline §1 Phase 3 (linking job), `flows.md`

---

## Brief Description

Notes can be connected via typed links (semantic, manual, reference, cite). Semantic links are created automatically by the Job Queue Worker using RRF fusion to find related notes. Manual links are created by the user or AI agent. Links are directional (from_note_id → to_note_id) but can also point to external URLs.

---

## Preconditions

- PGlite Worker is initialized
- Both source and destination notes exist (for note-to-note links)

---

## Primary Flow — Manual Link Creation

1. Actor submits: `{ from_note_id, to_note_id, kind='manual', score?, metadata? }`
   or `{ from_note_id, to_url, kind='reference', metadata? }`
2. System validates both notes exist and are not deleted (for note-to-note)
3. System generates UUIDv7 for link ID
4. System inserts `link` row
5. Returns `Link` DTO

---

## Primary Flow — Automated Semantic Linking (Job Queue)

Triggered after embedding job completes for a note.

1. Job Queue Worker picks up `linking` job (priority=3) for a note
2. Worker executes hybrid search (FTS + vector) to find candidate notes
3. Worker computes RRF scores
4. Worker inserts top-N links (default N=10) with `kind='semantic'`, `score=rrf_score`
5. Worker marks job `completed`
6. Event Bus emits `note.linked { note_id, links }`

---

## Alternative Flows

### Explore graph

Actor requests `explore_graph { note_id, depth=2 }`. System traverses `link` table up to `depth` hops. Returns graph structure with nodes (NoteSummary) and edges (Link).

### Find similar

Actor requests `find_similar { note_id, limit=10 }`. System runs hybrid search using the note's content/embedding as query. Returns ranked similar notes.

### Remove link

Actor submits `{ link_id }`. System hard-deletes the link row (links are not soft-deleted).

### Update link metadata

Actor submits `{ link_id, metadata }`. System updates `link.metadata` JSONB.

---

## Postconditions

- `link` row exists with correct `from_note_id`, `to_note_id` (or `to_url`)
- Semantic links have `score` set from RRF fusion
- Link graph navigable via `explore_graph`

---

## Business Rules

- BR-001: `to_note_id` and `to_url` are mutually exclusive (one of the two, not both)
- BR-002: Links are hard-deleted (not soft-deleted) — they don't participate in sync tombstoning
- BR-003: Duplicate links (same from_note_id + to_note_id + kind) are deduplicated
- BR-004: Semantic links are system-generated (kind='semantic'); manual links require explicit actor action
- BR-005: Link score is BM25 or vector similarity (0.0 – 1.0)
- BR-006: Link IDs are UUIDv7
- BR-007: Deleting a note does not delete its outgoing/incoming links immediately (links become stale; cleaned up by purge)

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | Create manual link between two notes | Link row exists; `kind='manual'` |
| AT-002 | Create URL link | `to_url` populated; `to_note_id` NULL |
| AT-003 | Semantic linking job runs after embedding | Top-10 semantic links created; `kind='semantic'` |
| AT-004 | Explore graph depth=2 | Notes 2 hops away returned |
| AT-005 | Find similar returns ranked results | Results match hybrid search for note content |
| AT-006 | Remove link | Link row deleted |
| AT-007 | MCP `manage_links { action: 'create', ... }` | Returns Link DTO in MCP format |
| AT-008 | Duplicate link creation | Deduplicated; single link row |

---

## Non-Functional Requirements

- FP-001: Link response JSON matches server Link response shape
- FP-002: Link IDs are UUIDv7
- PERF-002: Linking job (10k notes) < 2s
