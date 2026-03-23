# ADR-006: Public TypeScript API as Primary Interface

**Date**: 2026-03-22
**Status**: Proposed (Supersedes ADR-004 for primary interface designation)
**Deciders**: roctinam

---

## Context

fortemi-react was originally designed as a standalone PWA where a Service Worker intercepts HTTP requests to `localhost:3000`, providing drop-in compatibility with the fortemi server REST API (ADR-004). This assumed the primary consumers were external MCP clients and AI agents making HTTP calls from outside the browser.

We now know that fortemi-react is the **MNEMOS organ** inside the Plinyverse platform. In this deployment:

- It is loaded in a sandboxed iframe within the Plinyverse portal
- Other organs and the host shell interact with it via a typed `postMessage` bridge protocol (`@plinyverse/bridge`)
- Agentic sessions (G0DM0D3 shell) discover tools through a `PlinyCapability` registry with JSON Schema input/output definitions
- **No HTTP is involved** for in-browser communication between organs
- All primary consumers are in-browser JavaScript/TypeScript components

The Service Worker REST layer remains useful for standalone deployment and external MCP clients, but it is no longer the primary interface. Designing around HTTP as the core abstraction forces unnecessary serialization, routing overhead, and fetch-based IPC when all consumers share the same JavaScript runtime (modulo iframe sandboxing).

## Decision

Design a **TypeScript public API** as the primary interface layer. The Plinyverse bridge shim and the optional Service Worker REST adapter are thin adapters over this core API.

### Core API (transport-agnostic, headless)

No React, no browser APIs required. This layer works in Node, Vitest, Web Workers, or any JS runtime with PGlite access.

```typescript
interface FortemiCore {
  notes: NotesRepository
  search: SearchRepository
  collections: CollectionsRepository
  tags: TagsRepository
  links: LinksRepository
  attachments: AttachmentsRepository
  jobs: JobQueueRepository
  archives: ArchiveManager
  capabilities: CapabilityManager
  events: EventBus
}
```

Each repository exposes typed async methods (e.g., `notes.create()`, `notes.findById()`, `search.fullText()`). All return plain objects matching the existing JSON contract — 100% round-trip parity with the server API (UUIDv7 IDs, ISO 8601 timestamps, soft-delete semantics).

### Tool Handlers (agent/capability consumers)

Each of the 38 MCP tools as a typed async function with JSON Schema-compatible input/output. These map 1:1 to `PlinyCapability` entries.

```typescript
interface FortemiTools {
  capture_knowledge(args: CaptureArgs): Promise<CaptureResult>
  search(args: SearchArgs): Promise<SearchResult>
  manage_note(args: ManageArgs): Promise<ManageResult>
  manage_collection(args: CollectionArgs): Promise<CollectionResult>
  // ... all 38 tools
}
```

### React Hooks (optional, for UI consumers)

```typescript
useNotes(filter?) -> { notes, isLoading, error }
useSearch(query, options?) -> { results, isSearching }
useNote(id) -> { note, update, remove }
useCapabilities() -> { enabled, enable, disable, isReady }
```

### Event Emitter (non-React consumers)

```typescript
core.events.on('note.created', handler)
core.events.on('note.revised', handler)
core.events.on('search.reindexed', handler)
core.events.on('capability.ready', handler)
```

## Layer Architecture

```
┌─ Adapters (thin) ──────────────────────────────────┐
│  PlinyBridgeAdapter  │  ServiceWorkerAdapter        │
│  (postMessage)       │  (REST/JSON-RPC, optional)   │
└──────────┬───────────┴───────────┬──────────────────┘
           │                       │
┌──────────▼───────────────────────▼──────────────────┐
│  FortemiTools (38 tool handlers)                    │
│  - Typed input/output per tool                      │
│  - JSON Schema for PlinyCapability registration     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  FortemiCore (repositories + services)              │
│  - NotesRepo, SearchRepo, CollectionsRepo, ...      │
│  - EventBus, CapabilityManager, JobQueue            │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  PGlite Worker (single-writer, ADR-003)             │
│  - Browser: Web Worker + postMessage                │
│  - Test/Node: same-thread, in-memory                │
└─────────────────────────────────────────────────────┘
```

Adapters are thin translation layers (~100-200 lines each) that map transport-specific protocols to `FortemiTools` or `FortemiCore` calls. No business logic lives in adapters.

## Deployment Modes

Three deployment targets from one codebase:

| Mode | Primary use | Interface layer | UI |
|------|------------|----------------|----|
| **Organ mode** | Embedded in Plinyverse iframe | PlinyBridgeAdapter maps `PlinyCapability` invocations to `FortemiTools` | Optional (MNEMOS panel) |
| **Library mode** | `import { createFortemi } from '@fortemi/core'` | Direct `FortemiCore` + `FortemiTools` API | None (headless) |
| **Standalone mode** | Full PWA at `localhost:5173` | React UI + optional Service Worker for external MCP clients | Full React app |

All three modes share the same `FortemiCore` -> `PGlite Worker` stack. The only difference is which adapter (if any) sits on top.

## Relationship to ADR-004

ADR-004 defined the Service Worker REST interception as the primary API surface. That decision assumed external HTTP consumers as the main integration point. With Plinyverse embedding:

- **ADR-004 remains valid** for standalone deployment mode and external MCP client compatibility
- **ADR-004 is superseded as primary interface** — the SW REST layer becomes an optional adapter, not the architectural center
- The SW adapter calls the same `FortemiTools`/`FortemiCore` functions; no duplication of business logic

## Consequences

**Positive:**
- Trivial Plinyverse integration — bridge shim is a thin adapter mapping `PlinyCapability` calls to typed `FortemiTools` functions
- First-class TypeScript API — library consumers get full type safety, autocompletion, and documentation
- React hooks — reactive data layer for UI consumers without manual subscription management
- Testable without browser — core API works in Vitest with in-memory PGlite, no Service Worker or DOM required
- Service Worker becomes optional — not a core dependency; standalone mode can enable it, organ/library modes skip it entirely
- Natural PlinyCapability fit — tool handlers have typed interfaces with JSON Schema input/output, mapping directly to the capability registry
- Single source of truth — all deployment modes share one implementation; adapters only translate transport

**Negative:**
- ADR-004 partially superseded — teams expecting SW-first architecture need to update mental model
- Multiple adapter maintenance — PlinyBridgeAdapter and ServiceWorkerAdapter are separate code paths (mitigated: both are thin, ~100-200 lines, and share the same underlying API)
- API surface design effort — public API requires careful interface design, versioning, and documentation (mitigated: repositories already mirror server API structure)
