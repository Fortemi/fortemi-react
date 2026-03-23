# Integrating fortemi-react into an Existing React Application

This guide covers embedding `@fortemi/react` as a component in a larger application — for example, a host like Plinyverse that mounts fortemi as a panel or organ within its own React tree. The patterns here assume you are a senior React developer who needs direct access to the database, event bus, repositories, and capability pipeline — not just the convenience hooks.

## Table of Contents

1. [Package Installation](#1-package-installation)
2. [Provider Setup](#2-provider-setup)
3. [Accessing the Context](#3-accessing-the-context)
4. [Using the Repository Layer Directly](#4-using-the-repository-layer-directly)
5. [MCP Tool Integration](#5-mcp-tool-integration)
6. [Event Bus Integration](#6-event-bus-integration)
7. [Job Queue Integration](#7-job-queue-integration)
8. [Capability Module Wiring](#8-capability-module-wiring)
9. [Attachment Handling](#9-attachment-handling)
10. [Multi-Archive Support](#10-multi-archive-support)
11. [Service Worker Setup](#11-service-worker-setup)
12. [TypeScript Types](#12-typescript-types)
13. [Browser Compatibility Notes](#13-browser-compatibility-notes)

---

## 1. Package Installation

Both packages use the `workspace:*` protocol in a pnpm monorepo. If you are embedding fortemi inside your own monorepo, add them as workspace dependencies.

**pnpm-workspace.yaml** (in your repo root):

```yaml
packages:
  - apps/*
  - packages/*
  - vendor/fortemi-browser/packages/*   # path to your fortemi checkout
```

**package.json** (your app package):

```json
{
  "dependencies": {
    "@fortemi/core": "workspace:*",
    "@fortemi/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

After adding the entries, run `pnpm install` from the monorepo root. Both packages export their source TypeScript directly — there is no separate build step required for consumers in the same workspace.

If you are consuming published packages rather than a local checkout, replace `workspace:*` with the released version:

```json
{
  "dependencies": {
    "@fortemi/core": "2026.3.0",
    "@fortemi/react": "2026.3.0"
  }
}
```

---

## 2. Provider Setup

`FortemiProvider` initializes PGlite, the event bus, the archive manager, the capability manager, and the blob store. It must wrap any component tree that calls fortemi hooks or reads from the context.

### Minimal setup

```tsx
import { Suspense } from 'react'
import { FortemiProvider } from '@fortemi/react'

export function PlinyverseApp() {
  return (
    <Suspense fallback={<DatabaseLoading />}>
      <FortemiProvider persistence="opfs" archiveName="plinyverse-main">
        <YourApplicationContent />
      </FortemiProvider>
    </Suspense>
  )
}

function DatabaseLoading() {
  return <div aria-label="Initializing database">Loading knowledge base...</div>
}
```

### Error boundary for init failures

`FortemiProvider` throws synchronously when initialization fails, so an error boundary above the Suspense boundary will catch it:

```tsx
import { Component, type ReactNode, type ErrorInfo } from 'react'
import { Suspense } from 'react'
import { FortemiProvider } from '@fortemi/react'

interface State { error: Error | null }

class FortemiErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[fortemi] provider init failed:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert">
          <p>Knowledge base failed to load: {this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

export function PlinyverseApp() {
  return (
    <FortemiErrorBoundary>
      <Suspense fallback={<DatabaseLoading />}>
        <FortemiProvider persistence="opfs" archiveName="plinyverse-main">
          <YourApplicationContent />
        </FortemiProvider>
      </Suspense>
    </FortemiErrorBoundary>
  )
}
```

### Provider props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `persistence` | `'opfs' \| 'idb' \| 'memory'` | Yes | Storage backend. Use `opfs` for production, `memory` for tests. |
| `archiveName` | `string` | No (default: `'default'`) | Name of the initial archive to open. Maps to `opfs-ahp://fortemi-{name}` or `idb://fortemi-{name}`. |
| `children` | `ReactNode` | Yes | Component subtree that will consume the context. |

While PGlite is initializing, `FortemiProvider` returns `null`. The Suspense boundary above it displays the loading UI during that window.

**React StrictMode note:** `FortemiProvider` uses a module-level singleton promise (`globalInitPromise`) to prevent double-initialization from StrictMode's deliberate double-mount in development. The PGlite WASM module can only be instantiated once per cached `Response` — a second `WebAssembly.instantiateStreaming()` call against the same cached response will fail. The guard handles this automatically; you do not need to disable StrictMode.

---

## 3. Accessing the Context

`useFortemiContext()` returns the full `FortemiContextValue` and is the escape hatch for anything not covered by the high-level hooks.

```tsx
import { useFortemiContext } from '@fortemi/react'

function DebugPanel() {
  const { db, events, archiveManager, capabilityManager, blobStore } = useFortemiContext()

  const handleInspect = async () => {
    // Raw query against PGlite — same API surface as the repositories use internally
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM note WHERE deleted_at IS NULL`
    )
    console.log('Live notes:', result.rows[0].count)

    // Archive state
    console.log('Current archive:', archiveManager.getCurrentArchiveName())

    // Capability states
    console.log('Capabilities:', capabilityManager.listAll())
  }

  return <button onClick={handleInspect}>Inspect DB</button>
}
```

`useFortemiContext()` throws if called outside a `FortemiProvider`. This is intentional — it surfaces misconfiguration immediately rather than producing silent failures later.

### Context shape

```typescript
interface FortemiContextValue {
  db: PGlite                    // The active PGlite instance for the current archive
  events: TypedEventBus         // Typed pub/sub bus shared across the entire tree
  archiveManager: ArchiveManager // Manages multiple databases (one per workspace)
  capabilityManager: CapabilityManager // Tracks WASM capability load states
  blobStore: BlobStore          // Content-addressable binary store (OPFS or IDB)
}
```

---

## 4. Using the Repository Layer Directly

The repository classes provide the canonical data access interface. Use them when the built-in hooks do not meet your needs — for example, when you need to run repository operations outside of React (in a background callback, a message handler, or a non-component module), or when you need methods that hooks do not expose, such as `getRevisions`, `star`, or `pin`.

### Decision guide

| Scenario | Recommended approach |
|----------|---------------------|
| Display a reactive list of notes in a component | `useNotes()` hook |
| Create a note from a user action | `useCreateNote()` hook |
| Run a query in a background message handler | `NotesRepository` directly |
| Access revision history | `NotesRepository.getRevisions()` directly |
| Build a custom SKOS browser | `SkosRepository` directly |
| Need a single atomic transaction across multiple repos | Repositories directly via `db.transaction()` |

### NotesRepository

```typescript
import { NotesRepository } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

// In a component:
function useRevisionHistory(noteId: string) {
  const { db, events } = useFortemiContext()

  const fetchRevisions = async () => {
    const repo = new NotesRepository(db, events)
    return repo.getRevisions(noteId)
  }

  // ...
}
```

### Multi-repository transaction

Repositories share the same `db` instance, so you can combine them in a single `db.transaction()` call:

```typescript
import { NotesRepository, CollectionsRepository } from '@fortemi/core'

async function createNoteInCollection(
  db: PGlite,
  events: TypedEventBus,
  content: string,
  collectionId: string,
) {
  const notesRepo = new NotesRepository(db, events)
  const collectionsRepo = new CollectionsRepository(db)

  // NotesRepository.create() runs its own internal transaction.
  // Create the note first, then add to collection in a second transaction.
  const note = await notesRepo.create({ content, format: 'markdown' })
  await collectionsRepo.addNote(collectionId, note.id)

  return note
}
```

### Available repositories

| Class | Import | Purpose |
|-------|--------|---------|
| `NotesRepository` | `@fortemi/core` | Create, read, update, delete, star, pin, archive, list, getRevisions |
| `SearchRepository` | `@fortemi/core` | Full-text, semantic, and hybrid search with 12 filter options, phrase search, and faceted results |
| `TagsRepository` | `@fortemi/core` | Tag enumeration and management |
| `CollectionsRepository` | `@fortemi/core` | Collection CRUD, note membership |
| `LinksRepository` | `@fortemi/core` | Semantic and manual links between notes |
| `SkosRepository` | `@fortemi/core` | SKOS concept schemes, concepts, and relations |
| `AttachmentsRepository` | `@fortemi/core` | Binary file attachments per note |

---

## 5. MCP Tool Integration

Tool functions are the boundary between the MCP protocol layer and the repository layer. They accept raw, unvalidated input (an `unknown` value), run it through a Zod schema, and delegate to repositories. This makes them suitable for use from MCP bridge handlers, message port listeners, or any code path that receives opaque JSON payloads.

### captureKnowledge

```typescript
import { captureKnowledge } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

// Called from an MCP bridge handler or a Plinyverse organ message
async function handleCaptureMessage(rawPayload: unknown) {
  const { db, events } = useFortemiContext() // or extract from a ref

  const result = await captureKnowledge(db, rawPayload, events)
  // result.action: 'create' | 'bulk_create' | 'from_template'
  // result.notes: NoteFull[]
  console.log('Created note:', result.notes[0].id)
}
```

The Zod schema for validation is exported separately for cases where you want to validate without executing:

```typescript
import { CaptureKnowledgeInputSchema } from '@fortemi/core'

const parsed = CaptureKnowledgeInputSchema.safeParse(rawPayload)
if (!parsed.success) {
  return { error: parsed.error.format() }
}
// Now safe to call captureKnowledge(db, parsed.data, events)
```

### manageNote

```typescript
import { manageNote } from '@fortemi/core'

// Delete a note
const result = await manageNote(db, {
  action: 'delete',
  note_id: 'note-uuid-here',
}, events)

// Update content and title
const updated = await manageNote(db, {
  action: 'update',
  note_id: 'note-uuid-here',
  title: 'Revised Title',
  content: '## Updated content\n\nWith new structure.',
}, events)
// updated.note is the full NoteFull with current revision
```

### searchTool

```typescript
import { searchTool } from '@fortemi/core'

const response = await searchTool(db, {
  query: 'semantic memory retrieval',
  mode: 'text',       // 'text' | 'semantic' | 'hybrid' — semantic requires the capability
  limit: 20,
  offset: 0,
  tags: ['knowledge-management'],
  date_from: '2026-01-01',       // filter by creation date range
  is_starred: true,               // only starred notes
  format: 'markdown',             // filter by note format
  include_facets: true,           // include tag/collection counts
})
// response.results: SearchResult[]
// response.mode: 'text' | 'semantic' | 'hybrid'
// response.semantic_available: boolean
// response.total: number
// response.facets?: { tags: [...], collections: [...] }
```

The `useSearch` hook automatically dispatches to hybrid search when semantic capability is enabled — no manual embedding required:

```typescript
import { useSearch, useSearchHistory, useSearchSuggestions } from '@fortemi/react'

// useSearch automatically uses hybrid when semantic is ready
const { data, search } = useSearch()
await search('machine learning', { include_facets: true })
// data.mode will be 'hybrid' if semantic is enabled, 'text' otherwise

// Search history + suggestions
const { history, addEntry } = useSearchHistory()
const { suggestions, getSuggestions } = useSearchSuggestions(history)
```

### manageAttachments

```typescript
import { manageAttachments } from '@fortemi/core'

// List attachments for a note
const listResult = await manageAttachments(db, blobStore, {
  action: 'list',
  note_id: 'note-uuid-here',
})
// listResult.attachments: AttachmentRow[]

// Retrieve the binary content
const blobResult = await manageAttachments(db, blobStore, {
  action: 'get_blob',
  attachment_id: listResult.attachments![0].id,
})
// blobResult.data_base64: string (base64-encoded bytes)
```

### Tool signatures

| Function | Signature | Notes |
|----------|-----------|-------|
| `captureKnowledge` | `(db, rawInput, events?) => Promise<CaptureKnowledgeResult>` | |
| `manageNote` | `(db, rawInput, events?) => Promise<ManageNoteResult>` | |
| `searchTool` | `(db, rawInput) => Promise<SearchResponse>` | |
| `manageAttachments` | `(db, blobStore, rawInput) => Promise<ManageAttachmentsResult>` | Requires blobStore from context |
| `manageCapabilities` | `(rawInput, capabilityManager) => Promise<ManageCapabilitiesResult>` | |
| `manageArchive` | `(rawInput, archiveManager) => Promise<ManageArchiveResult>` | |
| `manageTags` | `(db, rawInput) => Promise<ManageTagsResult>` | |
| `manageCollections` | `(db, rawInput) => Promise<ManageCollectionsResult>` | |
| `manageLinks` | `(db, rawInput) => Promise<ManageLinksResult>` | |
| `getNote` | `(db, rawInput) => Promise<NoteFull>` | |
| `listNotes` | `(db, rawInput) => Promise<PaginatedResult<NoteSummary>>` | |

---

## 6. Event Bus Integration

`TypedEventBus` is a typed, synchronous pub/sub system shared across the entire fortemi component tree. It is the primary mechanism for cross-component and cross-layer communication. The bus supports exact subscriptions, wildcard prefix subscriptions, and cross-context bridging via `MessagePort`.

### Subscribing to specific events

```typescript
import { useFortemiContext } from '@fortemi/react'
import { useEffect } from 'react'

function PlinyverseActivityFeed() {
  const { events } = useFortemiContext()

  useEffect(() => {
    // Exact subscription — typed payload
    const onCreated = events.on('note.created', ({ id }) => {
      console.log('New note captured:', id)
      // Notify a Plinyverse panel, update a badge count, etc.
    })

    const onJobCompleted = events.on('job.completed', ({ id, noteId, type }) => {
      if (type === 'embedding') {
        console.log(`Embeddings ready for ${noteId} — semantic search now active`)
      }
    })

    // Subscriptions return an IDisposable — call dispose() to unsubscribe
    return () => {
      onCreated.dispose()
      onJobCompleted.dispose()
    }
  }, [events])

  return null
}
```

### Wildcard prefix subscriptions

The bus supports `'prefix.*'` patterns that match any event whose name starts with the given prefix:

```typescript
useEffect(() => {
  // Fires on note.created, note.updated, note.deleted, note.restored, note.revised
  const allNoteEvents = events.on('note.*', (payload) => {
    // payload is typed as unknown for wildcard subscriptions
    invalidateNoteCache()
  })

  const allCapabilityEvents = events.on('capability.*', (payload) => {
    refreshCapabilityUI()
  })

  return () => {
    allNoteEvents.dispose()
    allCapabilityEvents.dispose()
  }
}, [events])
```

### One-shot subscriptions with once()

```typescript
// Wait for capability to become ready before starting a job
await new Promise<void>((resolve) => {
  const sub = events.once('capability.ready', ({ name }) => {
    if (name === 'semantic') resolve()
    else sub.dispose() // wrong capability — re-register if needed
  })
})
```

### Bridging across a MessagePort

When fortemi runs in a Worker or iframe context, the event bus can be bridged to a `MessagePort` so events flow bidirectionally:

```typescript
// In the host window
const channel = new MessageChannel()
const bridge = events.bridge(channel.port1)

// Send port2 to the worker
worker.postMessage({ type: 'FORTEMI_BRIDGE' }, [channel.port2])

// Clean up when unmounting
bridge.dispose()
```

### Full event map

| Event | Payload | Emitted when |
|-------|---------|-------------|
| `note.created` | `{ id: string }` | Note successfully inserted |
| `note.updated` | `{ id: string }` | Note fields or content changed |
| `note.deleted` | `{ id: string }` | Note soft-deleted |
| `note.restored` | `{ id: string }` | Soft-delete reversed |
| `note.revised` | `{ id: string; revisionNumber: number }` | AI or user revision applied |
| `search.reindexed` | `{}` | Full-text search index rebuilt |
| `embedding.ready` | `{ noteId: string }` | Embeddings stored for a note |
| `capability.ready` | `{ name: string }` | Capability transitioned to ready |
| `capability.disabled` | `{ name: string }` | Capability disabled |
| `capability.loading` | `{ name: string; progress?: number }` | Capability loading (with optional 0–100 progress) |
| `job.completed` | `{ id: string; noteId: string; type: string }` | Job queue job succeeded |
| `job.failed` | `{ id: string; noteId: string; type: string; error: string }` | Job queue job exhausted retries |
| `archive.switched` | `{ name: string }` | Active archive changed |
| `migration.applied` | `{ version: number }` | DB migration applied |

---

## 7. Job Queue Integration

The job queue runs in the browser on a polling loop. Jobs are stored in the `job_queue` table, dispatched to registered handlers, and retried with exponential backoff. Custom job types can be registered alongside the built-in pipeline.

### Starting the built-in pipeline with useJobQueue

The `useJobQueue` hook starts the worker and registers all server-compatible handlers. Mount it once at the top of your application tree:

```tsx
import { useJobQueue } from '@fortemi/react'

function JobQueueOrchestrator() {
  const { jobs, enqueue } = useJobQueue(3000) // poll every 3 seconds

  const pendingCount = jobs.filter(j => j.status === 'pending').length
  const failedCount = jobs.filter(j => j.status === 'failed').length

  return (
    <div aria-label="Processing queue">
      {pendingCount > 0 && <span>{pendingCount} pending</span>}
      {failedCount > 0 && <span className="error">{failedCount} failed</span>}
    </div>
  )
}
```

### Registering a custom job handler

For job types that belong to your host application rather than to fortemi's core pipeline, construct a `JobQueueWorker` directly and register your handlers alongside or instead of the built-ins:

```typescript
import {
  JobQueueWorker,
  titleGenerationHandler,
  aiRevisionHandler,
  embeddingGenerationHandler,
  conceptTaggingHandler,
  linkingHandler,
  enqueueJob,
} from '@fortemi/core'
import type { PGlite } from '@electric-sql/pglite'
import { useFortemiContext } from '@fortemi/react'
import { useEffect, useRef } from 'react'

// Custom handler signature: (job, db) => Promise<unknown>
async function exportToPlinyverseHandler(
  job: { note_id: string; id: string },
  db: PGlite,
): Promise<unknown> {
  const result = await db.query<{ content: string; title: string | null }>(
    `SELECT content, title FROM note_revised_current nrc
     JOIN note n ON n.id = nrc.note_id
     WHERE nrc.note_id = $1`,
    [job.note_id],
  )
  if (result.rows.length === 0) return { skipped: true, reason: 'note not found' }

  const { content, title } = result.rows[0]
  // ... call your Plinyverse export API
  return { exported: true, title }
}

function CustomJobQueueMount() {
  const { db, events, capabilityManager } = useFortemiContext()
  const workerRef = useRef<JobQueueWorker | null>(null)

  useEffect(() => {
    const worker = new JobQueueWorker(db, events, { pollIntervalMs: 5000 }, capabilityManager)

    // Built-in pipeline
    worker.registerHandler('title_generation', titleGenerationHandler)
    worker.registerHandler('ai_revision', aiRevisionHandler)
    worker.registerHandler('embedding', embeddingGenerationHandler)
    worker.registerHandler('concept_tagging', conceptTaggingHandler)
    worker.registerHandler('linking', linkingHandler)

    // Your application-specific handlers
    worker.registerHandler('plinyverse_export', exportToPlinyverseHandler)

    worker.start()
    workerRef.current = worker

    return () => {
      worker.stop()
      workerRef.current = null
    }
  }, [db, events, capabilityManager])

  return null
}
```

### Enqueuing jobs programmatically

```typescript
import { enqueueJob, JOB_PRIORITIES } from '@fortemi/core'

// Enqueue a built-in type
const jobId = await enqueueJob(db, {
  noteId: 'note-uuid-here',
  jobType: 'embedding',
})

// Enqueue a custom type with explicit priority (lower = higher priority)
const exportJobId = await enqueueJob(db, {
  noteId: 'note-uuid-here',
  jobType: 'plinyverse_export',
  priority: 3,
  requiredCapability: null, // no capability gate for this job type
})
```

### Monitoring job status

```typescript
import { getJobQueueStatus } from '@fortemi/core'

// All recent jobs
const allJobs = await getJobQueueStatus(db)

// Jobs for a specific note
const noteJobs = await getJobQueueStatus(db, noteId)
const failed = noteJobs.filter(j => j.status === 'failed')
```

### Capability-gated jobs

Jobs with a `required_capability` field are held in `pending` state until the corresponding capability is `ready`. The worker checks `capabilityManager.isReady(name)` before dispatching. You can set `requiredCapability` to `null` to bypass gating entirely.

Built-in capability gates:

| Job type | Required capability |
|----------|-------------------|
| `embedding` | `semantic` |
| `ai_revision` | `llm` |
| `concept_tagging` | `llm` |
| `title_generation` | none |
| `linking` | none |

---

## 8. Capability Module Wiring

Capabilities are optional WASM modules (transformers.js, WebLLM) that augment the job pipeline. None are loaded by default — loading is always initiated explicitly by the host application.

### CapabilityManager state machine

```
unloaded -> loading -> ready
                    -> error -> loading (retry)
ready    -> disabled -> loading (re-enable)
```

Transitions are enforced at runtime. Calling `enable()` from `ready` or `loading` is a no-op (idempotent). Calling `disable()` from anything other than `ready` throws.

### registerSemanticCapability with transformers.js

The semantic capability requires an `EmbedFunction` — a function that accepts an array of text strings and returns an array of float arrays (one embedding vector per input).

In production, you load this from a Web Worker to avoid blocking the main thread:

```typescript
import { registerSemanticCapability } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

// embedding-worker.ts (runs in a Web Worker)
// import { pipeline } from '@huggingface/transformers'
// const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
// self.onmessage = async (e) => {
//   const output = await extractor(e.data.texts, { pooling: 'mean', normalize: true })
//   self.postMessage({ embeddings: output.tolist() })
// }

function SemanticCapabilityLoader() {
  const { capabilityManager, events } = useFortemiContext()

  const enableSemantic = async () => {
    // Create a worker that wraps the transformers.js pipeline
    const worker = new Worker(new URL('./embedding-worker.ts', import.meta.url), {
      type: 'module',
    })

    // Define the EmbedFunction that delegates to the worker
    const embedFn = (texts: string[]): Promise<number[][]> =>
      new Promise((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          worker.removeEventListener('message', handler)
          if (e.data.error) reject(new Error(e.data.error))
          else resolve(e.data.embeddings as number[][])
        }
        worker.addEventListener('message', handler)
        worker.postMessage({ texts })
      })

    // Wire the function and register the loader
    registerSemanticCapability(
      capabilityManager,
      embedFn,
      (pct) => {
        capabilityManager.reportProgress('semantic', pct)
      },
    )

    // Trigger the loader — transitions: unloaded -> loading -> ready
    await capabilityManager.enable('semantic')
  }

  return <button onClick={enableSemantic}>Enable Semantic Search</button>
}
```

### registerLlmCapability with WebLLM

The LLM capability performs WebGPU detection and selects a model tier before loading. You provide the `LlmCompleteFn` — a function that accepts a prompt string and returns a completion string:

```typescript
import {
  registerLlmCapability,
  detectGpuCapabilities,
  estimateVramTier,
  selectLlmModel,
} from '@fortemi/core'

function LlmCapabilityLoader() {
  const { capabilityManager } = useFortemiContext()
  const [loadProgress, setLoadProgress] = useState('')

  const enableLlm = async () => {
    // Inspect GPU first if you need to display model selection to the user
    const gpuCaps = await detectGpuCapabilities()
    if (!gpuCaps.webgpuAvailable) {
      alert('WebGPU is required for local LLM inference.')
      return
    }

    const tier = estimateVramTier(gpuCaps)
    const model = selectLlmModel(tier, gpuCaps.supportsF16)
    console.log(`Selected model for ${tier} VRAM tier: ${model}`)

    // Create a worker that wraps @mlc-ai/web-llm
    const worker = new Worker(new URL('./llm-worker.ts', import.meta.url), {
      type: 'module',
    })

    const completeFn = (
      prompt: string,
      options?: { maxTokens?: number; temperature?: number },
    ): Promise<string> =>
      new Promise((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          worker.removeEventListener('message', handler)
          if (e.data.error) reject(new Error(e.data.error))
          else resolve(e.data.completion as string)
        }
        worker.addEventListener('message', handler)
        worker.postMessage({ prompt, options })
      })

    registerLlmCapability(capabilityManager, completeFn, {
      modelOverride: model, // pass the pre-selected model
      onProgress: (pct, text) => {
        setLoadProgress(`${text} (${pct}%)`)
        capabilityManager.reportProgress('llm', pct)
      },
    })

    await capabilityManager.enable('llm')
    setLoadProgress('')
  }

  return (
    <div>
      <button onClick={enableLlm}>Enable Local LLM</button>
      {loadProgress && <p aria-live="polite">{loadProgress}</p>}
    </div>
  )
}
```

### Reacting to capability state changes

```typescript
useEffect(() => {
  const onReady = events.on('capability.ready', ({ name }) => {
    if (name === 'semantic') setSemanticReady(true)
    if (name === 'llm') setLlmReady(true)
  })

  const onLoading = events.on('capability.loading', ({ name, progress }) => {
    if (name === 'semantic' && progress !== undefined) {
      setSemanticProgress(progress)
    }
  })

  return () => {
    onReady.dispose()
    onLoading.dispose()
  }
}, [events])
```

### Checking capability state without the event bus

```typescript
const { capabilityManager } = useFortemiContext()

// Point-in-time check
const isSemanticReady = capabilityManager.isReady('semantic')
const llmState = capabilityManager.getState('llm') // 'unloaded' | 'loading' | 'ready' | 'error' | 'disabled'

// All capabilities
const all = capabilityManager.listAll()
// [{ name: 'semantic', state: 'ready' }, { name: 'llm', state: 'unloaded' }, ...]
```

---

## 9. Attachment Handling

Attachments are stored as binary blobs in the `BlobStore` (OPFS or IDB), with metadata in the `attachment` table. The `manageAttachments` tool handles the base64 encoding boundary so that data can be transported over JSON (MCP bridge, `postMessage`, etc.).

### Attaching a file from a file input

```tsx
import { manageAttachments } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

function AttachFileButton({ noteId }: { noteId: string }) {
  const { db, blobStore } = useFortemiContext()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const arrayBuffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    // Encode to base64 for transport through the tool boundary
    let binary = ''
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
    const data_base64 = btoa(binary)

    const result = await manageAttachments(db, blobStore, {
      action: 'attach',
      note_id: noteId,
      data_base64,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      display_name: file.name,
    })

    console.log('Attached:', result.attachment?.id, 'size:', result.size_bytes, 'bytes')
  }

  return <input type="file" onChange={handleFileChange} />
}
```

### Retrieving a blob and rendering it

```typescript
async function downloadAttachment(
  db: PGlite,
  blobStore: BlobStore,
  attachmentId: string,
  filename: string,
) {
  const result = await manageAttachments(db, blobStore, {
    action: 'get_blob',
    attachment_id: attachmentId,
  })

  if (!result.data_base64) throw new Error('No blob returned')

  // Decode base64 back to bytes
  const binaryStr = atob(result.data_base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

  // Create a download
  const blob = new Blob([bytes])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

### Direct BlobStore access

If you need to bypass the tool boundary for performance reasons (bulk reads, streaming), access the `BlobStore` from context directly:

```typescript
const { blobStore } = useFortemiContext()

// Write
await blobStore.write(hash, uint8Data)

// Read (returns null if the hash is not found)
const data = await blobStore.read(hash)

// Check existence before reading
const exists = await blobStore.exists(hash)
```

The `hash` used by the attachment system is computed from the file content using `computeHash` from `@fortemi/core`. Do not fabricate hash values — always let the `AttachmentsRepository` or `manageAttachments` tool manage them.

---

## 10. Multi-Archive Support

Each archive is a separate PGlite database instance with its own storage path. Archives allow you to partition knowledge by workspace, project, or user. The `ArchiveManager` handles creation, switching, and listing.

### Creating and switching archives

```tsx
import { useFortemiContext } from '@fortemi/react'

function WorkspaceSwitcher() {
  const { archiveManager, events } = useFortemiContext()

  const switchWorkspace = async (name: string) => {
    // Closes the current DB and opens (or creates) the named archive
    // Runs migrations automatically on the new database
    await archiveManager.switchTo(name)
    // events.emit('archive.switched', { name }) is called internally
  }

  const createWorkspace = async (name: string) => {
    try {
      await archiveManager.create(name) // throws if name already exists
    } catch (err) {
      console.error('Archive already exists:', err)
    }
  }

  const workspaces = archiveManager.listArchives()

  return (
    <ul>
      {workspaces.map((archive) => (
        <li key={archive.name}>
          <button onClick={() => switchWorkspace(archive.name)}>
            {archive.name}
          </button>
        </li>
      ))}
      <li>
        <button onClick={() => createWorkspace('research-2026')}>
          New workspace
        </button>
      </li>
    </ul>
  )
}
```

### Reacting to archive switches

When the active archive switches, the `db` reference in the context is replaced. React components that depend on `db` will re-render because the context value has changed. However, repositories instantiated in callbacks or effects need to be re-created. The safest pattern is to key components on the archive name:

```tsx
function NotesPanel() {
  const { archiveManager } = useFortemiContext()
  const archiveName = archiveManager.getCurrentArchiveName()

  // Re-mount the entire notes list when the archive changes
  return <NotesList key={archiveName} />
}
```

Alternatively, subscribe to `archive.switched` and flush any local state:

```typescript
useEffect(() => {
  const sub = events.on('archive.switched', ({ name }) => {
    setNotes([])
    setCurrentArchive(name)
    // trigger re-fetch
  })
  return () => sub.dispose()
}, [events])
```

### Using manageArchive tool

```typescript
import { manageArchive } from '@fortemi/core'

// List archives via the tool boundary
const result = await manageArchive({ action: 'list' }, archiveManager)
// result.archives: ArchiveInfo[]

// Create via tool boundary
await manageArchive({ action: 'create', name: 'fieldwork-notes' }, archiveManager)

// Switch via tool boundary
await manageArchive({ action: 'switch', name: 'fieldwork-notes' }, archiveManager)
```

---

## 11. Service Worker Setup

The service worker exposes a REST API at `/api/v1/*` that proxies requests to the in-browser PGlite database. This is the primary integration point for tools and agents that communicate via HTTP rather than direct function calls.

### Registering the service worker

```typescript
import { registerServiceWorker } from '@fortemi/core'

// Call this once at application startup, before mounting the React tree
const result = await registerServiceWorker('/sw.js')

if (!result.registered) {
  console.warn('Service Worker registration failed:', result.error)
  // Fall back to direct function call integration
} else {
  console.log('SW active — REST API available at /api/v1/*')
}
```

`registerServiceWorker` waits for the service worker to reach the `activated` state before resolving, so subsequent `fetch` calls against `/api/v1/*` will be intercepted immediately.

### Route structure

The SW handles the following routes. All routes accept and return `application/json`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/notes` | List notes |
| `POST` | `/api/v1/notes` | Create a note |
| `GET` | `/api/v1/notes/:id` | Fetch a single note |
| `PUT` | `/api/v1/notes/:id` | Update a note |
| `DELETE` | `/api/v1/notes/:id` | Soft-delete a note |
| `POST` | `/api/v1/notes/:id/restore` | Restore a soft-deleted note |
| `POST` | `/api/v1/notes/:id/star` | Star or unstar a note |
| `POST` | `/api/v1/notes/:id/archive` | Archive or unarchive a note |
| `GET` | `/api/v1/search` | Full-text search |

### Custom route handler

If you need to add routes for your host application, use `createRoutes` and `matchRoute` from `@fortemi/core`:

```typescript
import { createRoutes, matchRoute, type RouteHandler } from '@fortemi/core'

// In your sw.ts
const fortemiRoutes = createRoutes()

// Add your own routes
const appRoutes: RouteHandler[] = [
  {
    method: 'POST',
    pattern: /^\/api\/v1\/plinyverse\/export\/?$/,
    handler: async (request) => {
      const body = await request.json()
      // handle export
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
]

const allRoutes = [...fortemiRoutes, ...appRoutes]

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith('/api/')) return

  const match = matchRoute(allRoutes, event.request, url)
  if (!match) return

  event.respondWith(
    match.handler(event.request, [], url.searchParams)
  )
})
```

---

## 12. TypeScript Types

Key types for consumers. All are exported from `@fortemi/core` or `@fortemi/react`.

### Context and provider

```typescript
import type {
  FortemiContextValue,   // { db, events, archiveManager, capabilityManager, blobStore }
  FortemiProviderProps,  // { persistence, archiveName?, children }
} from '@fortemi/react'

import type { PersistenceMode } from '@fortemi/core'  // 'opfs' | 'idb' | 'memory'
```

### Notes

```typescript
import type {
  NoteSummary,        // Lightweight list item (no content body)
  NoteFull,           // Full note with original, current revision, and tags
  NoteCreateInput,    // { content, title?, format?, source?, visibility?, tags?, archive_id? }
  NoteUpdateInput,    // { title?, content?, format?, visibility? }
  NoteListOptions,    // Filtering and pagination options for list()
  NoteRevision,       // Single revision record with content and ai_metadata
  PaginatedResult,    // { items: T[], total, limit, offset }
} from '@fortemi/core'
```

### Search

```typescript
import type {
  SearchResult,   // { id, title, snippet, rank, created_at, updated_at, tags }
  SearchResponse, // { results, total, query, mode, semantic_available, limit, offset }
  SearchOptions,  // { limit?, offset?, tags?, collection_id? }
} from '@fortemi/core'
```

### Event bus

```typescript
import type {
  EventMap,    // Full typed map of all event names to their payload shapes
  IDisposable, // { dispose(): void } — returned by on() and once()
} from '@fortemi/core'
```

### Job queue

```typescript
import type {
  JobType,          // 'title_generation' | 'ai_revision' | 'embedding' | 'concept_tagging' | 'linking'
  JobStatus,        // Full job row including status, retry_count, error, result
  EnqueueJobInput,  // { noteId, jobType, priority?, requiredCapability? }
  JobQueueOptions,  // { pollIntervalMs?, maxRetries?, backoffBaseMs?, backoffMaxMs? }
} from '@fortemi/core'
```

### Capabilities

```typescript
import type {
  CapabilityName,   // 'semantic' | 'llm' | 'audio' | 'vision' | 'pdf'
  CapabilityState,  // 'unloaded' | 'loading' | 'ready' | 'error' | 'disabled'
  GpuCapabilities,  // { webgpuAvailable, vendor, architecture, maxBufferSizeBytes, supportsF16 }
  VramTier,         // 'low' | 'medium' | 'high' | 'unknown'
  EmbedFunction,    // (texts: string[]) => Promise<number[][]>
  LlmCompleteFn,    // (prompt: string, options?) => Promise<string>
  LlmCapabilityOptions, // { modelOverride?, onProgress? }
} from '@fortemi/core'
```

### Attachments

```typescript
import type {
  AttachmentRow,           // DB row: { id, note_id, filename, mime_type, size_bytes, ... }
  AttachInput,             // { noteId, data: Uint8Array, filename, mimeType?, displayName? }
  ManageAttachmentsInput,  // Tool input shape
  ManageAttachmentsResult, // Tool result shape
  BlobStore,               // { write, read, remove, exists }
} from '@fortemi/core'
```

### Archive and collection

```typescript
import type {
  ArchiveInfo,              // { name: string, createdAt: string }
  CollectionRow,            // Collection DB row
  CollectionCreateInput,    // Input for collection creation
  LinkRow,                  // Link between notes
  SkosScheme,               // SKOS concept scheme
  SkosConcept,              // Individual SKOS concept
  SkosRelation,             // Relation between concepts
} from '@fortemi/core'
```

---

## 13. Browser Compatibility Notes

### Storage backend selection

`createBlobStore()` and `createPGliteInstance()` select their backends automatically based on what the browser supports:

| Backend | Availability | PGlite dataDir | BlobStore class |
|---------|-------------|----------------|-----------------|
| OPFS (Origin Private File System) | Chrome 86+, Edge 86+, Safari 15.2+ | `opfs-ahp://fortemi-{name}` | `OpfsBlobStore` |
| IndexedDB | All modern browsers including Firefox | `idb://fortemi-{name}` | `IdbBlobStore` |
| Memory | Everywhere, no persistence | `undefined` | `MemoryBlobStore` |

When using `persistence: 'opfs'` on a browser that does not support OPFS, PGlite will throw during initialization. `FortemiProvider` will catch this and re-throw, so your error boundary will surface it. Prefer `'idb'` as the production default unless you have confirmed OPFS support in your target environment.

### WebGPU for local LLM

WebGPU is required for the `llm` capability. The `detectGpuCapabilities()` function handles the detection and surfaces the result clearly:

- Chrome 113+ on Windows, macOS, Linux (with `--enable-unsafe-webgpu` flag on Linux)
- Safari 18+ (macOS Sequoia, iOS 18)
- Firefox 141+ with `dom.webgpu.enabled` set to `true` in `about:config`

**Linux note:** Chrome on Linux requires launching with `--enable-unsafe-webgpu` for hardware-accelerated WebGPU. Without the flag, `detectGpuCapabilities()` will return a SwiftShader (software rasterizer) adapter, which `estimateVramTier()` will classify as `low` VRAM tier and `selectLlmModel()` will map to the smallest available model (`Qwen3-0.6B`). The `supportsF16` field will be `false` for SwiftShader, so the `q4f32_1` quantization variant is selected automatically.

If your Plinyverse deployment targets Linux workstations, document the Chrome launch flag requirement for users who want local LLM inference.

### Cross-origin isolation

PGlite with OPFS and WebGPU both require `crossOriginIsolated` to be `true`. Your server must send the following headers for the pages that host fortemi:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Verify isolation at runtime before initializing:

```typescript
if (!crossOriginIsolated) {
  console.error(
    'fortemi requires cross-origin isolation. ' +
    'Ensure COOP: same-origin and COEP: require-corp headers are set.'
  )
}
```

### PGlite WASM initialization

PGlite loads a WASM module on first initialization. On a cold load (no HTTP cache), this fetch is approximately 6–8 MB. Subsequent loads are served from the browser cache.

PGlite 0.4.x requires the `database: 'postgres'` option to be explicitly set — this is handled internally by `createPGliteInstance()`. Do not call `PGlite.create()` directly without this option, as it will fail with a connection error.

The `vector` extension for pgvector is loaded with every instance and enabled via `CREATE EXTENSION IF NOT EXISTS vector` immediately after creation. Embedding dimensions in the default pipeline are 384 (all-MiniLM-L6-v2).
