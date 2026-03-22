# UC-007 — Manage Archives (Multi-Memory)

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: High (Phase 1 — Foundation)
**Actors**: User
**Implements**: Archive switching state machine (see `architecture.md`)

---

## Brief Description

A user creates and switches between isolated knowledge archives (e.g., "public", "work", "research"). Each archive is a separate PGlite database instance stored in OPFS. Data is fully isolated between archives — no cross-archive queries in v1.

---

## Preconditions

- CapabilityManager initialized
- PGlite Worker pool initialized (supports multiple archive instances)

---

## Primary Flow — Create Archive

1. User navigates to Settings → Archives
2. User enters archive name (e.g., "work")
3. System validates name is unique and URL-safe
4. System generates UUIDv7 for archive ID
5. System inserts `archive` row: `(id, name, db_path='opfs://fortemi-work', schema_version=0)`
6. System initializes new PGlite instance at `opfs://fortemi-work`
7. System runs migration runner: applies all migrations from 0001 to current
8. System registers archive in global registry
9. Returns `Archive` DTO

---

## Primary Flow — Switch Archive

1. User selects archive from dropdown in header
2. System identifies current archive
3. System suspends active jobs for current archive (graceful drain)
4. System closes current PGlite connection
5. System opens (or creates) PGlite instance for selected archive
6. System verifies migration version; runs any pending migrations
7. System updates current archive in global state
8. UI re-renders with new archive's data
9. Event Bus emits `archive.switched { from, to }`

---

## Alternative Flows

### 6a — Migration needed on switch

Selected archive is behind current migration version. System runs pending migrations before exposing the archive. Shows migration progress to user.

### 3a — Archive not found

`opfs://fortemi-{name}` directory does not exist. System initializes new PGlite instance (creates the database). Proceeds as Create Archive from step 7.

### Delete Archive

1. User selects archive → "Delete Archive"
2. System warns: "All notes in this archive will be permanently deleted. This cannot be undone."
3. User confirms with archive name
4. System removes OPFS directory `opfs://fortemi-{name}`
5. System deletes `archive` row from registry
6. System switches to default archive

---

## Archive Naming and Paths

```
Archive name: "public"   → db_path: "opfs://fortemi-public"
Archive name: "work"     → db_path: "opfs://fortemi-work"
Archive name: "research" → db_path: "opfs://fortemi-research"
```

Default archive on first launch: `"public"`.

---

## Postconditions

- `archive` row exists in registry
- OPFS directory `opfs://fortemi-{name}` exists
- Archive is migration-current
- On switch: previous archive connection closed, new one open

---

## Business Rules

- BR-001: Archive names must be URL-safe (lowercase alphanumeric, hyphens only)
- BR-002: Archive names must be globally unique (within this browser origin)
- BR-003: Each archive is a completely separate PGlite database — no shared tables
- BR-004: Maximum 10 archives (UX and OPFS quota constraint)
- BR-005: Cannot delete the last remaining archive
- BR-006: Archive metadata stored in the default ("public") archive's `archive` table

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | Create archive "work" | New PGlite db at `opfs://fortemi-work`; schema_version = latest |
| AT-002 | Switch to archive "work" | UI shows "work" notes; "public" notes not visible |
| AT-003 | Note created in "work" not visible in "public" | Data isolation confirmed |
| AT-004 | Switch to archive with pending migration | Migration runs; archive opened after success |
| AT-005 | Delete archive "work" with notes | Warning shown; confirmed delete removes OPFS dir |
| AT-006 | Duplicate archive name | Error: archive_name_conflict |
| AT-007 | Invalid archive name (spaces, uppercase) | Validation error; name normalized or rejected |

---

## Non-Functional Requirements

- PERF-004: PGlite startup for existing archive < 3s
- REL-002: Migration run is atomic per migration file
- REL-006: Archive switching works offline
