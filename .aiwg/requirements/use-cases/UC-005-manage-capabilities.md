# UC-005 — Manage Capability Modules

**Version**: 2026.3.0
**Status**: Baselined
**Priority**: Critical (Phase 1 — Foundation)
**Actors**: User
**Implements**: Capability Module State Machine (see `architecture.md`, `ADR-002`)

---

## Brief Description

The user enables or disables opt-in WASM capability modules (semantic embeddings, LLM AI revision, audio transcription, vision, PDF extraction). No WASM beyond PGlite is loaded without explicit user consent. Once enabled, capabilities are cached and available for subsequent sessions.

---

## Preconditions

- CapabilityManager is initialized (always — happens at app startup before any WASM)
- User is on Settings → Capabilities page

---

## Primary Flow — Enable Semantic Capability

1. User sees Capability panel: `Semantic (Embeddings)` — Status: `disabled`
2. User clicks "Enable"
3. System shows: "This will download ~100MB. Proceed?"
4. User confirms
5. System calls `CapabilityManager.enable('semantic')`
6. System displays progress: "Downloading transformers.js... 15MB / 100MB"
7. System initializes EmbeddingModule with `nomic-embed-text` model
8. System caches model weights in OPFS
9. Status updates: `semantic` → `READY`
10. Event Bus emits `capability.ready { name: 'semantic' }`
11. Job Queue Worker re-queues pending `embedding` jobs
12. UI shows: "Semantic search enabled. Processing pending notes..."

---

## Alternative Flows

### 7a — Download fails (network error)

System shows error: "Download failed. Check your connection and try again." Status returns to `disabled`.

### 5a — User cancels download

User clicks "Cancel" on progress dialog. System calls `controller.abort()`. Status returns to `disabled`. No partial download left in OPFS.

### 10a — LLM capability: external API path

User selects "External API" instead of in-browser WebLLM. User enters API URL and key. System validates connectivity. System registers `llm` capability as `READY` (no download). Key stored encrypted in localStorage via Web Crypto AES-256-GCM.

### 10b — LLM capability: WebLLM path

User selects "In-browser LLM". System warns: "This will download 1–4GB and requires a GPU." User selects model. Download and initialization proceeds as semantic path but larger.

---

## Capability Tiers

| Name | Trigger | Download | Purpose |
|---|---|---|---|
| `text` | Always on (automatic) | ~8MB (PGlite) | FTS, BM25, SQL |
| `semantic` | User enables | ~100MB | Embeddings, vector search |
| `llm` | User enables (WebLLM or external API) | 1–4GB or 0 | AI revision, tagging, titles |
| `audio` | User enables | ~100MB (Whisper.js) | Audio transcription |
| `vision` | User enables | ~1-4GB | Image description |
| `pdf` | User enables | ~5MB (pdf.js) | PDF text extraction |

---

## Disable Flow

1. User clicks "Disable" for an active capability
2. System warns if pending jobs exist that require the capability
3. System calls `module.dispose()` (frees WASM heap)
4. Status: `disabled`
5. Cached model weights remain in OPFS (not deleted — re-enable is fast)
6. Note: pending jobs for this capability remain `pending` until re-enabled

---

## Postconditions

- `capability.status` correctly reflects module state
- Model weights cached in OPFS for fast subsequent loads
- Pending capability-gated jobs re-scheduled on READY event
- User consent recorded for audit

---

## Business Rules

- BR-001: CapabilityManager must be instantiated before any WASM module loads — enforced at app init
- BR-002: No WASM download may occur without explicit user interaction
- BR-003: Download progress must be visible with byte count and percentage
- BR-004: Download must be cancellable via AbortController
- BR-005: Model weights cached in OPFS (not re-downloaded each session)
- BR-006: LLM external API key must be AES-256-GCM encrypted before storage
- BR-007: Capability state is per-archive (each archive has independent capability config)

---

## Acceptance Tests

| Test ID | Description | Expected Result |
|---|---|---|
| AT-001 | App starts with no WASM beyond PGlite loaded | Only PGlite Worker active; no transformers.js, WebLLM, etc. |
| AT-002 | Enable semantic: confirm dialog shown | "~100MB download" warning displayed |
| AT-003 | Enable semantic: download progress visible | Progress bar with bytes/total shown |
| AT-004 | Cancel download mid-progress | No partial WASM in memory; status = disabled |
| AT-005 | Enable semantic successfully | Status = READY; pending embedding jobs re-queued |
| AT-006 | Configure external LLM API | API key stored encrypted; LLM capability = READY without download |
| AT-007 | External LLM key not stored in PGlite | api_key table does not contain external LLM key |
| AT-008 | Disable semantic capability | module.dispose() called; status = disabled |

---

## Non-Functional Requirements

- CAP-001: No WASM beyond PGlite without user consent (CRITICAL)
- CAP-002: Model weights cached in OPFS
- CAP-003: Pending jobs re-run on capability READY
- CAP-004: Capability unload frees WASM heap
- CAP-005: Download cancellable
- SEC-001: External API keys encrypted AES-256-GCM
- UX-001: Progress bar with byte count and cancellation
