# UC-001 — Capture Knowledge

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Critical (Phase 2 — Core)
**Actors**: User, AI Agent (MCP)
**Implements**: Note creation pipeline (see `flows.md` §1)

---

## Brief Description

A user or AI agent creates a new note. The system stores the original content immutably, queues async jobs for AI revision and embeddings, and returns the note immediately without waiting for processing.

---

## Preconditions

- PGlite Worker is initialized and migration-current
- Archive is selected (default: "public")
- Note content is non-empty

---

## Primary Flow

1. Actor submits note: `{ content, format?, tags?, revision_mode?, collection_id?, source? }`
2. System generates UUIDv7 for the note ID
3. System opens a database transaction
4. System inserts:
   - `note` (id, format, source, created_at_utc, updated_at_utc, visibility='private')
   - `note_original` (note_id, content, hash=SHA-256)
   - `note_revised_current` (note_id, content=original, is_user_edited=false)
   - `note_tag` rows for each provided tag
   - `job_queue` rows: `title_generation` (priority=2), `ai_revision` (priority=8), `embedding` (priority=5)
5. System commits the transaction
6. System emits `note.created` event on Event Bus
7. System returns `NoteFull` DTO to actor immediately (original content, no revision yet)
8. Job Queue Worker asynchronously processes jobs (title, revision, embedding, linking)

---

## Alternative Flows

### 4a — Bulk create

Actor submits array of note objects. System repeats steps 2–8 for each note in a single transaction batch.

### 4b — From template

Actor specifies `document_type_id`. System pre-populates metadata from `document_type.note_template` and sets `extraction_strategy` from `document_type.extraction_strategy`.

### 4c — LLM not available (AI revision)

At step 4 (job insertion), `ai_revision` job is inserted with `required_capability='llm'`. Job stays `pending` until LLM capability becomes available. Note is returned with original content.

### 7a — MCP tool path

AI agent calls `capture_knowledge` MCP tool via `POST localhost:3000/mcp`. Service Worker intercepts, dispatches to MCP tool handler, which calls `NotesRepository.create()`. Returns MCP-formatted tool result.

---

## Postconditions

- `note` row exists with `deleted_at = NULL`
- `note_original` row is immutable; content and hash are set
- `note_revised_current` row exists (may not yet have AI revision)
- At least one `job_queue` row exists for the note
- Event Bus has emitted `note.created`

---

## Business Rules

- BR-001: Note ID must be UUIDv7 (not v4)
- BR-002: `note_original.content` is immutable after creation
- BR-003: `note_revised_current` is created even if no revision exists yet (content = original)
- BR-004: Jobs are queued even if capabilities are unavailable
- BR-005: Revision mode `'standard'` is default; `'minimal'`, `'comprehensive'` are alternatives

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | Create note with content "Test note" | Returns NoteFull with UUIDv7 id; note_original.hash = SHA-256("Test note") |
| AT-002 | Create note with tags ["rust", "async"] | note_tag rows exist for both tags |
| AT-003 | Create note; check job queue | Three jobs: title_generation, ai_revision, embedding |
| AT-004 | Create note; JSON matches server fixture | Round-trip format parity test passes |
| AT-005 | MCP tool `capture_knowledge { action: 'create', content: '...' }` | Returns MCP-formatted result identical to server format |
| AT-006 | Create note with deleted_at=NULL | note.deleted_at IS NULL confirmed |

---

## Non-Functional Requirements

- PERF-001: Create latency < 200ms p95 (no AI, no attachments)
- FP-001: JSON response matches server OpenAPI shape
- FP-002: ID is UUIDv7
- FP-003: `deleted_at` is NULL (not omitted)
