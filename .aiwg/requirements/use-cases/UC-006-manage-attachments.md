# UC-006 — Manage Attachments

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Medium (Phase 5 — Media)
**Actors**: User, AI Agent (MCP)
**Implements**: Attachment Processing Pipeline (see `flows.md` §5), Blob GC (see `flows.md` §6)

---

## Brief Description

A user or AI agent attaches files to notes. Files are content-addressed (BLAKE3 hash deduplication), stored either inline in PGlite (≤10MB) or as raw OPFS files (>10MB). Capability-dependent extraction jobs queue for text extraction, AI description, or transcription.

---

## Preconditions

- PGlite Worker is initialized
- Note exists and is not deleted
- For files >10MB: OPFS accessible
- For extraction: relevant capability module may or may not be available (graceful degradation)

---

## Primary Flow — Upload Attachment

1. Actor submits: `{ note_id, file: File }`
2. System computes BLAKE3 hash (or SHA-256 if BLAKE3 WASM unavailable)
3. System queries: `SELECT id FROM attachment_blob WHERE content_hash = $hash`
4. Blob not found → insert new blob:
   - `size_bytes ≤ 10MB`: `INSERT INTO attachment_blob (data=bytes, storage_backend='database')`
   - `size_bytes > 10MB`: Write to `OPFS: blobs/{xx}/{xx}/{uuid}.bin`; `INSERT INTO attachment_blob (storage_path=..., storage_backend='filesystem')`
5. System inserts `attachment` row: `(note_id, blob_id, filename, status='queued')`
6. System inserts `job_queue` row: `(type='extraction', required_capability=inferred_from_mime)`
7. Returns `attachment_id`
8. Job Queue Worker processes extraction job asynchronously

---

## Alternative Flow — Deduplication

At step 3, blob found → skip blob insertion. Update `attachment_blob.reference_count += 1`. Continue with step 5 (new `attachment` row still created; blob is shared).

---

## Primary Flow — Delete Attachment

1. Actor submits: `{ attachment_id }`
2. System deletes `attachment` row
3. System decrements `attachment_blob.reference_count`
4. If `reference_count = 0`:
   - `storage_backend = 'database'`: `DELETE FROM attachment_blob`
   - `storage_backend = 'filesystem'`: `OPFS.remove(storage_path)` then `DELETE FROM attachment_blob`
5. Returns `{ deleted: true }`

---

## Extraction Job Processing (Async)

Job Queue Worker processes `extraction` job based on MIME type and available capability:

| MIME Type | Required Capability | Extraction Strategy |
|---|---|---|
| `application/pdf` | `pdf` | pdf.js text extraction |
| `image/*` | `vision` | AI image description (LLaVA / moondream) |
| `audio/*`, `video/*` | `audio` | Whisper.js transcription |
| `text/*` | none | Read bytes directly |
| Other | none | Store only, no extraction |

On completion: `UPDATE attachment SET extracted_text=..., status='completed'`

---

## Blob Storage Paths

```
OPFS root
└── blobs/
    └── {first 2 hex chars of UUID}/
        └── {next 2 hex chars of UUID}/
            └── {full UUID}.bin
```

Example: blob UUID `01947a3b-...` → `blobs/01/94/01947a3b-....bin`

---

## Postconditions

- `attachment` row exists with correct `blob_id` reference
- `attachment_blob.reference_count` is accurate
- Extraction job queued; extracted_text populated asynchronously
- If blob was deduplicated: single blob row with incremented reference_count

---

## Business Rules

- BR-001: All blobs content-addressed; BLAKE3 hash is canonical identifier
- BR-002: `reference_count = 0` triggers GC (delete blob)
- BR-003: Files >10MB stored as raw OPFS files (not in PGlite WAL)
- BR-004: Files ≤10MB stored inline as BYTEA in `attachment_blob.data`
- BR-005: Extraction is capability-gated and gracefully degraded (stored without extraction if no capability)
- BR-006: Re-embedding job queued after extraction completes (to include extracted text in note embeddings)
- BR-007: Attachment IDs are UUIDv7
- BR-008: `storage_path` format: `blobs/{xx}/{xx}/{uuid}.bin` (matches server path convention)

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | Upload 1MB text file | Stored inline; `storage_backend='database'` |
| AT-002 | Upload 15MB PDF | Stored in OPFS; `storage_backend='filesystem'` |
| AT-003 | Upload same file twice | Second upload reuses blob; `reference_count=2` |
| AT-004 | Delete one of two references | `reference_count=1`; blob not deleted |
| AT-005 | Delete last reference | `reference_count=0`; blob GC runs; OPFS file removed |
| AT-006 | Upload PDF with pdf capability disabled | `status='completed'`; no extracted_text |
| AT-007 | Upload PDF with pdf capability enabled | `extracted_text` populated asynchronously |
| AT-008 | BLAKE3 hash unavailable (fallback) | SHA-256 hash used; `content_hash='sha256:...'` |
| AT-009 | MCP `capture_knowledge { action: 'upload', ... }` | Returns attachment metadata in MCP format |

---

## Non-Functional Requirements

- PERF-001: Attachment upload (1MB) < 500ms (hashing + DB insert)
- REL-005: Blob GC never deletes referenced blobs
- FP-001: Attachment response JSON matches server format
