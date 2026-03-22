# UC-003 — Manage Collections

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Medium (Phase 2 — Core)
**Actors**: User, AI Agent (MCP)

---

## Brief Description

A user or AI agent creates, updates, and organizes collections (hierarchical note folders). Notes can be assigned to collections. Collections support parent-child nesting for knowledge organization.

---

## Preconditions

- PGlite Worker is initialized

---

## Primary Flow — Create Collection

1. Actor submits: `{ name, description?, parent_id? }`
2. System generates UUIDv7 for collection ID
3. System inserts `collection` row: `(id, name, description, parent_id, created_at_utc)`
4. If `parent_id` provided, system validates parent exists (not deleted)
5. Returns `Collection` DTO

---

## Primary Flow — Assign Note to Collection

1. Actor submits: `{ note_id, collection_id }`
2. System validates both note and collection exist
3. System updates `note.collection_id = collection_id`
4. System emits `note.updated` event
5. Returns updated `NoteSummary`

---

## Alternative Flows

### Create — Duplicate name

If `name` already exists at same parent level, system returns validation error: `{ error: 'collection_name_conflict' }`.

### Assign — Remove from collection

Actor submits `{ note_id, collection_id: null }`. System sets `note.collection_id = NULL`.

### List — Hierarchical tree

Actor requests `GET /api/v1/collections`. System returns tree structure with `children` arrays, recursive.

### Delete collection

Actor requests delete. System validates no notes assigned. If notes exist, returns error unless `force=true`. With `force=true`, notes' `collection_id` set to NULL before deletion.

---

## Postconditions

- `collection` row exists with unique name within parent scope
- `collection.parent_id` creates hierarchical tree
- `note.collection_id` references assigned collection

---

## Business Rules

- BR-001: Collection names unique within same parent (not globally)
- BR-002: Circular parent references must be rejected
- BR-003: Deleting parent collection does not cascade delete children (children become orphaned — same parent_id set to NULL)
- BR-004: Collection IDs are UUIDv7
- BR-005: No soft-delete on `collection` — collections are hard-deleted (notes are unassigned, not deleted)

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | Create collection "Research" | Collection with UUIDv7 id returned |
| AT-002 | Create nested collection "Research > Rust" | parent_id = Research.id |
| AT-003 | Duplicate name at same level | Error: collection_name_conflict |
| AT-004 | Assign note to collection | note.collection_id updated |
| AT-005 | List collections returns hierarchical tree | Children nested under parents |
| AT-006 | MCP `manage_collections { action: 'create', name: '...' }` | Returns MCP-formatted Collection DTO |

---

## Non-Functional Requirements

- FP-001: JSON shape matches server Collection response
- FP-002: IDs are UUIDv7
