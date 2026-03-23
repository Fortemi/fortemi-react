# API Reference

**Packages:** `@fortemi/core` · `@fortemi/react`
**Version:** 2026.3.0

---

## Table of Contents

- [@fortemi/core](#fortemicore)
  - [Core Utilities](#core-utilities)
  - [Types](#types)
  - [Event Bus](#event-bus)
  - [Capability Manager](#capability-manager)
  - [Repositories](#repositories)
    - [NotesRepository](#notesrepository)
    - [SearchRepository](#searchrepository)
    - [TagsRepository](#tagsrepository)
    - [CollectionsRepository](#collectionsrepository)
    - [LinksRepository](#linksrepository)
    - [SkosRepository](#skosrepository)
    - [AttachmentsRepository](#attachmentsrepository)
  - [Repository Types](#repository-types)
  - [Tool Functions](#tool-functions)
  - [Job Queue](#job-queue)
  - [Capabilities](#capabilities)
  - [Migrations and Archive](#migrations-and-archive)
  - [Service Worker](#service-worker)
  - [Worker Utilities](#worker-utilities)
- [@fortemi/react](#fortemiреасt)
  - [Provider](#provider)
  - [Hooks](#hooks)

---

## @fortemi/core

### Core Utilities

#### `VERSION`

```typescript
const VERSION: string
```

The current package version string. Value: `'2026.3.0'`.

---

#### `generateId()`

```typescript
function generateId(): string
```

Generates a UUIDv7 identifier. UUIDv7 values are time-ordered, making them suitable as primary keys in sorted indexes.

**Returns:** A UUIDv7 string, e.g. `'018f1e2d-3b4c-7a5d-8e9f-0a1b2c3d4e5f'`.

---

#### `computeHash(data)`

```typescript
function computeHash(data: Uint8Array): string
```

Computes a SHA-256 digest of the provided binary data.

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Uint8Array` | Raw bytes to hash |

**Returns:** A prefixed hex string in the form `'sha256:<hex>'`.

---

#### `createPGliteInstance(persistence, archiveName)`

```typescript
function createPGliteInstance(
  persistence: PersistenceMode,
  archiveName: string
): Promise<PGlite>
```

Creates and initializes a PGlite database instance using the specified storage backend.

| Parameter | Type | Description |
|-----------|------|-------------|
| `persistence` | `PersistenceMode` | Storage backend: `'opfs'`, `'idb'`, or `'memory'` |
| `archiveName` | `string` | Logical name for the archive; used to scope the on-disk path |

**Returns:** A `Promise` that resolves to an initialized `PGlite` instance.

---

#### `createFortemi(config)`

```typescript
function createFortemi(config: FortemiConfig): Promise<FortemiCore>
```

Primary factory function. Assembles a fully initialized `FortemiCore` instance including database, repositories, event bus, capability manager, blob store, and archive manager.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `FortemiConfig` | Configuration object (see [FortemiConfig](#fortemiconfig)) |

**Returns:** A `Promise` that resolves to a `FortemiCore` instance.

---

#### `createBlobStore(archiveName)`

```typescript
function createBlobStore(archiveName: string): BlobStore
```

Creates a `BlobStore` backed by OPFS when available, falling back to IndexedDB. Used for binary attachment storage.

| Parameter | Type | Description |
|-----------|------|-------------|
| `archiveName` | `string` | Archive name used to scope the storage namespace |

**Returns:** A `BlobStore` instance.

---

#### `MemoryBlobStore`

```typescript
class MemoryBlobStore implements BlobStore {
  write(key: string, data: Uint8Array): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  remove(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

An in-memory implementation of `BlobStore` intended for use in test environments. Data does not persist between instantiations.

---

### Types

#### `PersistenceMode`

```typescript
type PersistenceMode = 'opfs' | 'idb' | 'memory'
```

Controls where PGlite stores data.

| Value | Description |
|-------|-------------|
| `'opfs'` | Origin Private File System — best performance on supported browsers |
| `'idb'` | IndexedDB — broader compatibility fallback |
| `'memory'` | No persistence; suitable for tests |

---

#### `BlobStore`

```typescript
interface BlobStore {
  write(key: string, data: Uint8Array): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  remove(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

Abstract interface for binary blob storage. All four methods are required. Keys are arbitrary strings; by convention they are attachment IDs.

---

#### `FortemiConfig`

```typescript
interface FortemiConfig {
  persistence: PersistenceMode
  archiveName?: string
}
```

Configuration passed to `createFortemi`.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `persistence` | `PersistenceMode` | Yes | Storage backend |
| `archiveName` | `string` | No | Archive identifier; defaults to a standard name when omitted |

---

#### `FortemiCore`

```typescript
interface FortemiCore {
  db: PGlite
  events: TypedEventBus
  archiveManager: ArchiveManager
  capabilityManager: CapabilityManager
  blobStore: BlobStore
}
```

The assembled runtime surface returned by `createFortemi`. All repositories are constructed on demand using `db` and `events`.

---

### Event Bus

#### `TypedEventBus`

```typescript
class TypedEventBus {
  on(event: FortemiEvent, handler: EventHandler): () => void
  once(event: FortemiEvent, handler: EventHandler): () => void
  emit(event: FortemiEvent, payload?: unknown): void
  bridge(port: MessagePort): void
}
```

Typed publish/subscribe bus. All internal subsystems communicate through this bus. `bridge` connects a `MessagePort`, allowing events to be relayed across Worker boundaries.

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Subscribe to an event. Returns an unsubscribe function. |
| `once(event, handler)` | Subscribe for a single emission, then auto-unsubscribe. Returns an unsubscribe function. |
| `emit(event, payload?)` | Publish an event with an optional payload. |
| `bridge(port)` | Forward all events bidirectionally over a `MessagePort`. |

**Event names:**

| Event | When emitted |
|-------|-------------|
| `note.created` | A note was successfully persisted |
| `note.updated` | A note's content or metadata changed |
| `note.deleted` | A note was soft-deleted |
| `note.restored` | A soft-deleted note was restored |
| `job.completed` | A background job finished successfully |
| `job.failed` | A background job terminated with an error |
| `capability.ready` | A capability finished loading and is available |
| `capability.disabled` | A capability was explicitly disabled |
| `capability.loading` | A capability loader started |

---

### Capability Manager

#### `CapabilityManager`

```typescript
class CapabilityManager {
  enable(name: CapabilityName): Promise<void>
  disable(name: CapabilityName): void
  isReady(name: CapabilityName): boolean
  getState(name: CapabilityName): CapabilityState
  registerLoader(name: CapabilityName, fn: () => Promise<void>): void
  getError(name: CapabilityName): Error | null
  getProgress(name: CapabilityName): string | null
  setProgress(name: CapabilityName, msg: string): void
  listAll(): Array<{ name: CapabilityName; state: CapabilityState }>
}
```

Manages optional runtime capabilities (ML models, hardware features). Each capability has an independently tracked lifecycle.

| Method | Description |
|--------|-------------|
| `enable(name)` | Invoke the registered loader for the capability. Resolves when ready. Emits `capability.loading` then `capability.ready`. |
| `disable(name)` | Unload a capability and mark it disabled. Emits `capability.disabled`. |
| `isReady(name)` | Returns `true` if the capability state is `'ready'`. |
| `getState(name)` | Returns the current `CapabilityState` for the capability. |
| `registerLoader(name, fn)` | Register the async function that initializes the capability. Must be called before `enable`. |
| `getError(name)` | Returns the `Error` that caused the last load failure, or `null`. |
| `getProgress(name)` | Returns the current progress message string, or `null`. |
| `setProgress(name, msg)` | Update the progress message during a long-running load. |
| `listAll()` | Returns an array of all registered capabilities and their states. |

---

#### `CapabilityName`

```typescript
type CapabilityName = 'semantic' | 'llm' | 'audio' | 'vision' | 'pdf'
```

| Value | Description |
|-------|-------------|
| `'semantic'` | Embedding model for semantic search |
| `'llm'` | Language model for title generation and tagging |
| `'audio'` | Audio transcription |
| `'vision'` | Image understanding |
| `'pdf'` | PDF text extraction |

---

#### `CapabilityState`

```typescript
type CapabilityState = 'unloaded' | 'loading' | 'ready' | 'error' | 'disabled'
```

| Value | Description |
|-------|-------------|
| `'unloaded'` | Loader registered but not yet started |
| `'loading'` | Loader is running |
| `'ready'` | Capability is available for use |
| `'error'` | Loader failed; inspect via `getError()` |
| `'disabled'` | Explicitly disabled via `disable()` |

---

### Repositories

All repositories share a common constructor signature unless noted:

```typescript
constructor(db: PGlite, events?: TypedEventBus)
```

`events` is optional. When provided, state-changing operations emit the corresponding events on the bus.

---

#### `NotesRepository`

```typescript
class NotesRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  create(input: NoteCreateInput): Promise<NoteFull>
  get(id: string): Promise<NoteFull | null>
  list(options?: NoteListOptions): Promise<PaginatedResult<NoteSummary>>
  update(id: string, input: NoteUpdateInput): Promise<NoteFull>
  delete(id: string): Promise<void>
  restore(id: string): Promise<void>
  star(id: string, starred: boolean): Promise<void>
  pin(id: string, pinned: boolean): Promise<void>
  archive(id: string, archived: boolean): Promise<void>
  addTags(id: string, tags: string[]): Promise<void>
  removeTags(id: string, tags: string[]): Promise<void>
  getRevisions(id: string): Promise<NoteRevision[]>
}
```

| Method | Description |
|--------|-------------|
| `create(input)` | Insert a new note. Emits `note.created`. |
| `get(id)` | Retrieve a single note by ID including full content and tags. Returns `null` if not found. |
| `list(options?)` | Retrieve a paginated, filtered list of note summaries. |
| `update(id, input)` | Apply partial updates to a note. Creates a revision snapshot. Emits `note.updated`. |
| `delete(id)` | Soft-delete a note. Emits `note.deleted`. |
| `restore(id)` | Undo a soft-delete. Emits `note.restored`. |
| `star(id, starred)` | Set the starred flag. |
| `pin(id, pinned)` | Set the pinned flag. |
| `archive(id, archived)` | Set the archived flag. |
| `addTags(id, tags)` | Append tags to a note without duplicates. |
| `removeTags(id, tags)` | Remove specific tags from a note. |
| `getRevisions(id)` | Return the ordered revision history for a note. |

---

#### `SearchRepository`

```typescript
class SearchRepository {
  constructor(db: PGlite, semanticAvailable?: boolean)

  search(query: string, options?: SearchOptions, queryEmbedding?: number[]): Promise<SearchResponse>
  semanticSearch(queryEmbedding: number[], options?: SearchOptions): Promise<SearchResponse>
  hybridSearch(query: string, queryEmbedding: number[], options?: SearchOptions): Promise<SearchResponse>
}
```

| Method | Description |
|--------|-------------|
| `search(query, options?, queryEmbedding?)` | Main entry point. Dispatches to text, semantic, or hybrid based on inputs. Empty query returns recent notes. Quoted phrases use `phraseto_tsquery`. |
| `semanticSearch(queryEmbedding, options?)` | Pure vector similarity search via pgvector cosine distance. |
| `hybridSearch(query, queryEmbedding, options?)` | Combines BM25 text ranking and vector similarity using Reciprocal Rank Fusion (k=60). |

The `search()` method routing logic:
- Query text + embedding = **hybrid** (RRF fusion)
- Embedding only (empty query) = **semantic** (vector cosine)
- Query text only = **text** (BM25 tsvector)
- Empty query, no embedding = **recent notes** (ordered by created_at DESC)

#### `buildNoteConditions()`

```typescript
function buildNoteConditions(
  options: Pick<SearchOptions, 'tags' | 'collection_id' | 'date_from' | 'date_to' | 'is_starred' | 'is_archived' | 'format' | 'source' | 'visibility'>,
  startIdx: number,
  includeDeleted?: boolean,
): { conditions: string[]; params: unknown[]; nextIdx: number }
```

Shared SQL condition builder used by both `SearchRepository` and `NotesRepository`. Generates parameterized WHERE clause conditions for all filter fields.

---

#### `TagsRepository`

```typescript
class TagsRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  list(): Promise<string[]>
  getFrequency(): Promise<Array<{ tag: string; count: number }>>
  suggest(partial: string): Promise<string[]>
}
```

| Method | Description |
|--------|-------------|
| `list()` | Return all distinct tags in the database. |
| `getFrequency()` | Return all tags with their usage counts, ordered by frequency descending. |
| `suggest(partial)` | Return tags that begin with the given prefix string. |

---

#### `CollectionsRepository`

```typescript
class CollectionsRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  create(input: { name: string; description?: string }): Promise<CollectionRow>
  get(id: string): Promise<CollectionRow | null>
  list(): Promise<CollectionRow[]>
  update(id: string, input: { name?: string; description?: string }): Promise<CollectionRow>
  delete(id: string): Promise<void>
  addNotes(collectionId: string, noteIds: string[]): Promise<void>
  removeNotes(collectionId: string, noteIds: string[]): Promise<void>
}
```

| Method | Description |
|--------|-------------|
| `create(input)` | Create a new named collection. |
| `get(id)` | Retrieve a collection by ID. Returns `null` if not found. |
| `list()` | List all collections. |
| `update(id, input)` | Update name or description. |
| `delete(id)` | Delete a collection. Does not delete member notes. |
| `addNotes(collectionId, noteIds)` | Add notes to a collection. Silently skips already-present members. |
| `removeNotes(collectionId, noteIds)` | Remove notes from a collection. |

---

#### `LinksRepository`

```typescript
class LinksRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  create(input: { sourceId: string; targetId: string; relation?: string }): Promise<LinkRow>
  get(id: string): Promise<LinkRow | null>
  list(noteId?: string): Promise<LinkRow[]>
  delete(id: string): Promise<void>
  getRelated(noteId: string): Promise<NoteSummary[]>
}
```

| Method | Description |
|--------|-------------|
| `create(input)` | Create a directional link between two notes. `relation` is an optional label (e.g. `'supports'`, `'contradicts'`). |
| `get(id)` | Retrieve a link record by ID. |
| `list(noteId?)` | List all links, or only links where the given note is source or target. |
| `delete(id)` | Remove a link by ID. |
| `getRelated(noteId)` | Return summaries for all notes connected to the given note by any link. |

---

#### `SkosRepository`

```typescript
class SkosRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  createScheme(input: { uri: string; title: string }): Promise<{ id: string }>
  createConcept(input: { schemeId: string; prefLabel: string; uri?: string }): Promise<{ id: string }>
  createRelation(input: { conceptId: string; relationType: string; targetConceptId: string }): Promise<void>
  getScheme(id: string): Promise<{ id: string; uri: string; title: string } | null>
  getConcept(id: string): Promise<{ id: string; schemeId: string; prefLabel: string; uri?: string } | null>
  listConcepts(schemeId: string): Promise<Array<{ id: string; prefLabel: string; uri?: string }>>
}
```

Supports a subset of the SKOS (Simple Knowledge Organization System) model for organizing note tags into hierarchical concept schemes.

| Method | Description |
|--------|-------------|
| `createScheme(input)` | Create a top-level concept scheme identified by URI. |
| `createConcept(input)` | Create a concept within a scheme. |
| `createRelation(input)` | Assert a typed relation (e.g. `'broader'`, `'narrower'`, `'related'`) between concepts. |
| `getScheme(id)` | Retrieve a scheme by ID. |
| `getConcept(id)` | Retrieve a concept by ID. |
| `listConcepts(schemeId)` | List all concepts belonging to a scheme. |

---

#### `AttachmentsRepository`

```typescript
class AttachmentsRepository {
  constructor(db: PGlite, blobStore: BlobStore)

  attach(input: { noteId: string; filename: string; mimeType: string; data: Uint8Array }): Promise<AttachmentRow>
  get(id: string): Promise<AttachmentRow | null>
  getBlob(id: string): Promise<Uint8Array | null>
  list(noteId: string): Promise<AttachmentRow[]>
  delete(id: string): Promise<void>
}
```

Unlike other repositories, `AttachmentsRepository` takes a `BlobStore` instead of `TypedEventBus` as its second argument, because attachment data is stored outside the database.

| Method | Description |
|--------|-------------|
| `attach(input)` | Write binary data to the blob store and record metadata in the database. |
| `get(id)` | Retrieve attachment metadata without the binary payload. |
| `getBlob(id)` | Retrieve the raw binary data for an attachment. |
| `list(noteId)` | List all attachments for a note (metadata only). |
| `delete(id)` | Remove metadata from the database and delete the blob. |

---

### Repository Types

#### `NoteSummary`

```typescript
interface NoteSummary {
  id: string
  title: string | null
  snippet: string
  tags: string[]
  starred: boolean
  pinned: boolean
  archived: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
```

Lightweight note projection used in list results.

---

#### `NoteFull`

```typescript
interface NoteFull extends NoteSummary {
  content: string
  embedding: number[] | null
}
```

Full note including raw content and optional embedding vector.

---

#### `NoteCreateInput`

```typescript
interface NoteCreateInput {
  content: string
  title?: string
  tags?: string[]
}
```

---

#### `NoteUpdateInput`

```typescript
interface NoteUpdateInput {
  content?: string
  title?: string
  tags?: string[]
  starred?: boolean
  pinned?: boolean
  archived?: boolean
}
```

All fields are optional; only provided fields are written.

---

#### `NoteListOptions`

```typescript
interface NoteListOptions {
  page?: number
  pageSize?: number
  tags?: string[]
  starred?: boolean
  pinned?: boolean
  archived?: boolean
  includeDeleted?: boolean
  orderBy?: 'createdAt' | 'updatedAt' | 'title'
  orderDir?: 'asc' | 'desc'
}
```

---

#### `PaginatedResult<T>`

```typescript
interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
}
```

---

#### `SearchResult`

```typescript
interface SearchResult {
  note: NoteSummary
  score: number
  highlights?: string[]
}
```

---

#### `SearchFacets`

```typescript
interface SearchFacets {
  tags: { tag: string; count: number }[]
  collections: { id: string; name: string; count: number }[]
}
```

Aggregate counts from the full (unpaginated) result set. Present on `SearchResponse` when `include_facets: true`.

---

#### `SearchResponse`

```typescript
interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  mode: 'text' | 'semantic' | 'hybrid'
  semantic_available: boolean
  limit: number
  offset: number
  facets?: SearchFacets
}
```

The `mode` field reflects the actual search mode used. `facets` is present when `include_facets: true` was requested.

---

#### `SearchOptions`

```typescript
interface SearchOptions {
  limit?: number           // 1-100, default: 20
  offset?: number          // default: 0
  tags?: string[]          // filter: notes with ANY of these tags
  collection_id?: string   // filter: notes in this collection
  date_from?: Date         // filter: created on or after
  date_to?: Date           // filter: created on or before
  is_starred?: boolean     // filter: starred status
  is_archived?: boolean    // filter: archived status
  format?: string          // filter: 'markdown' | 'plain' | 'html'
  source?: string          // filter: 'user' | 'mcp' | 'import' | 'api'
  visibility?: string      // filter: 'private' | 'shared' | 'public'
  include_facets?: boolean // include tag/collection aggregate counts (default: false)
}
```

All filters apply uniformly across text, semantic, and hybrid search modes.

---

#### `NoteRevision`

```typescript
interface NoteRevision {
  id: string
  noteId: string
  content: string
  title: string | null
  createdAt: string
}
```

Immutable snapshot of a note's content at the time of an update.

---

#### `CollectionRow`

```typescript
interface CollectionRow {
  id: string
  name: string
  description: string | null
  noteCount: number
  createdAt: string
  updatedAt: string
}
```

---

#### `LinkRow`

```typescript
interface LinkRow {
  id: string
  sourceId: string
  targetId: string
  relation: string | null
  createdAt: string
}
```

---

#### `AttachmentRow`

```typescript
interface AttachmentRow {
  id: string
  noteId: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
}
```

---

#### `AttachmentBlobRow`

```typescript
interface AttachmentBlobRow extends AttachmentRow {
  data: Uint8Array
}
```

---

### Tool Functions

Tool functions follow the MCP (Model Context Protocol) calling convention: they accept a plain `input` object and return a structured result. They are suitable for use both from UI code and from LLM tool-call dispatch.

---

#### `captureKnowledge(db, events, input)`

```typescript
function captureKnowledge(
  db: PGlite,
  events: TypedEventBus,
  input:
    | { action: 'create'; content: string; title?: string; tags?: string[] }
    | { action: 'bulk_create'; notes: NoteCreateInput[] }
    | { action: 'from_template'; templateId: string; variables: Record<string, string> }
): Promise<NoteFull | NoteFull[]>
```

Create one or more notes. `from_template` expands a stored template with variable substitution.

---

#### `manageNote(db, events, input)`

```typescript
function manageNote(
  db: PGlite,
  events: TypedEventBus,
  input:
    | { action: 'update'; id: string } & NoteUpdateInput
    | { action: 'delete'; id: string }
    | { action: 'restore'; id: string }
    | { action: 'archive'; id: string; archived: boolean }
    | { action: 'star'; id: string; starred: boolean }
): Promise<NoteFull | void>
```

Mutate an existing note's state or metadata.

---

#### `searchTool(db, input)`

```typescript
function searchTool(
  db: PGlite,
  input:
    | { mode: 'text'; query: string; options?: SearchOptions }
    | { mode: 'semantic'; embedding: number[]; options?: SearchOptions }
    | { mode: 'hybrid'; query: string; embedding: number[]; options?: SearchOptions }
): Promise<SearchResponse>
```

Unified search entry point covering all three search modes.

---

#### `getNote(db, input)`

```typescript
function getNote(
  db: PGlite,
  input: { id: string }
): Promise<NoteFull | null>
```

Retrieve a single note by ID.

---

#### `listNotes(db, input)`

```typescript
function listNotes(
  db: PGlite,
  input: NoteListOptions
): Promise<PaginatedResult<NoteSummary>>
```

Retrieve a paginated, filtered note list.

---

#### `manageTags(db, input)`

```typescript
function manageTags(
  db: PGlite,
  input:
    | { action: 'list' }
    | { action: 'frequency' }
    | { action: 'suggest'; partial: string }
): Promise<string[] | Array<{ tag: string; count: number }>>
```

---

#### `manageCollections(db, input)`

```typescript
function manageCollections(
  db: PGlite,
  input:
    | { action: 'create'; name: string; description?: string }
    | { action: 'get'; id: string }
    | { action: 'list' }
    | { action: 'update'; id: string; name?: string; description?: string }
    | { action: 'delete'; id: string }
    | { action: 'add_notes'; collectionId: string; noteIds: string[] }
    | { action: 'remove_notes'; collectionId: string; noteIds: string[] }
): Promise<CollectionRow | CollectionRow[] | void>
```

---

#### `manageLinks(db, input)`

```typescript
function manageLinks(
  db: PGlite,
  input:
    | { action: 'create'; sourceId: string; targetId: string; relation?: string }
    | { action: 'get'; id: string }
    | { action: 'list'; noteId?: string }
    | { action: 'delete'; id: string }
    | { action: 'get_related'; noteId: string }
): Promise<LinkRow | LinkRow[] | NoteSummary[] | void>
```

---

#### `manageArchive(manager, input)`

```typescript
function manageArchive(
  manager: ArchiveManager,
  input:
    | { action: 'open'; name: string }
    | { action: 'list' }
    | { action: 'create'; name: string; persistence: PersistenceMode }
    | { action: 'switch'; name: string }
    | { action: 'delete'; name: string }
): Promise<unknown>
```

---

#### `manageCapabilities(manager, input)`

```typescript
function manageCapabilities(
  manager: CapabilityManager,
  input:
    | { action: 'enable'; name: CapabilityName }
    | { action: 'disable'; name: CapabilityName }
    | { action: 'status'; name?: CapabilityName }
): Promise<CapabilityState | Array<{ name: CapabilityName; state: CapabilityState }> | void>
```

---

#### `manageAttachments(db, blobStore, input)`

```typescript
function manageAttachments(
  db: PGlite,
  blobStore: BlobStore,
  input:
    | { action: 'attach'; noteId: string; filename: string; mimeType: string; data: Uint8Array }
    | { action: 'list'; noteId: string }
    | { action: 'get'; id: string }
    | { action: 'get_blob'; id: string }
    | { action: 'delete'; id: string }
): Promise<AttachmentRow | AttachmentBlobRow | AttachmentRow[] | void>
```

---

### Job Queue

The job queue processes background tasks (embedding generation, title generation, tagging, linking) asynchronously inside a Worker or on the main thread.

---

#### `JobQueueWorker`

```typescript
class JobQueueWorker {
  constructor(
    db: PGlite,
    events: TypedEventBus,
    options: { pollIntervalMs?: number; batchSize?: number },
    capabilityManager: CapabilityManager
  )

  registerHandler(jobType: JobType, handler: JobHandler): void
  start(): void
  stop(): void
  processOnce(): Promise<number>
}
```

| Method | Description |
|--------|-------------|
| `registerHandler(jobType, handler)` | Register an async function to handle a specific job type. |
| `start()` | Begin polling the job queue at the configured interval. |
| `stop()` | Stop polling. In-flight jobs complete before the worker halts. |
| `processOnce()` | Process one batch of pending jobs immediately. Returns the count processed. |

---

#### `enqueueJob(db, input)`

```typescript
function enqueueJob(
  db: PGlite,
  input: { noteId: string; jobType: JobType; priority?: number }
): Promise<string>
```

Insert a job into the queue. Returns the job ID.

---

#### `enqueueNoteCreationJobs(db, noteId, hasTitle)`

```typescript
function enqueueNoteCreationJobs(
  db: PGlite,
  noteId: string,
  hasTitle: boolean
): Promise<void>
```

Convenience function that enqueues the standard set of post-creation jobs: embedding, concept tagging, linking, and optionally title generation (when `hasTitle` is `false`).

---

#### `getJobQueueStatus(db, noteId?)`

```typescript
function getJobQueueStatus(
  db: PGlite,
  noteId?: string
): Promise<Array<{ jobId: string; jobType: JobType; status: string; createdAt: string }>>
```

Return current queue status. Pass `noteId` to filter to jobs for a specific note.

---

#### Built-in Job Handlers

The following handler functions are registered on a `JobQueueWorker` to implement background processing. Each conforms to the `JobHandler` type.

| Export | Job Type | Requires Capability |
|--------|----------|---------------------|
| `titleGenerationHandler` | `'title_generation'` | `'llm'` |
| `aiRevisionHandler` | `'ai_revision'` | `'llm'` |
| `conceptTaggingHandler` | `'concept_tagging'` | `'llm'` |
| `linkingHandler` | `'linking'` | `'llm'` |
| `embeddingGenerationHandler` | `'embedding'` | `'semantic'` |

`embeddingGenerationHandler` is exported from the capabilities module rather than the core job queue module.

---

#### `JobType`

```typescript
type JobType =
  | 'title_generation'
  | 'ai_revision'
  | 'embedding'
  | 'concept_tagging'
  | 'linking'
```

---

#### `JOB_PRIORITIES`

```typescript
const JOB_PRIORITIES: Record<JobType, number>
```

Default numeric priority values for each job type. Lower numbers run first.

---

#### `JOB_CAPABILITIES`

```typescript
const JOB_CAPABILITIES: Record<JobType, CapabilityName>
```

Maps each job type to the capability that must be ready before the job can run.

---

### Capabilities

Utility functions for hardware detection, model selection, and ML function registration.

---

#### `detectGpuCapabilities()`

```typescript
function detectGpuCapabilities(): Promise<GpuCapabilities>
```

Queries the WebGPU adapter (if available) to detect GPU memory and features.

**Returns:** A `GpuCapabilities` object with detected hardware details.

---

#### `estimateVramTier(caps)`

```typescript
function estimateVramTier(caps: GpuCapabilities): VramTier
```

Maps detected GPU capabilities to a discrete VRAM tier used for model selection.

| Parameter | Type | Description |
|-----------|------|-------------|
| `caps` | `GpuCapabilities` | Output of `detectGpuCapabilities()` |

**Returns:** A `VramTier` value.

---

#### `selectLlmModel(tier, supportsF16?)`

```typescript
function selectLlmModel(tier: VramTier, supportsF16?: boolean): string
```

Returns the recommended model identifier for the given hardware tier.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tier` | `VramTier` | Hardware tier from `estimateVramTier` |
| `supportsF16` | `boolean` | Optional; prefer F16 quantization when `true` |

**Returns:** A model identifier string (e.g. `'smollm2-135m-instruct-q4_k_m'`).

---

#### `setEmbedFunction(fn)` / `getEmbedFunction()`

```typescript
function setEmbedFunction(fn: (text: string) => Promise<number[]>): void
function getEmbedFunction(): ((text: string) => Promise<number[]>) | null
```

Register or retrieve the active embedding function. The embedding function is called by `embeddingGenerationHandler` and `semanticSearch`. Must be set before semantic features are used.

---

#### `setLlmFunction(fn)` / `getLlmFunction()`

```typescript
function setLlmFunction(fn: (prompt: string) => Promise<string>): void
function getLlmFunction(): ((prompt: string) => Promise<string>) | null
```

Register or retrieve the active LLM inference function. Called by title generation, tagging, and revision handlers.

---

#### `registerSemanticCapability(manager)` / `unregisterSemanticCapability(manager)`

```typescript
function registerSemanticCapability(manager: CapabilityManager): void
function unregisterSemanticCapability(manager: CapabilityManager): void
```

Attach or detach the default semantic capability loader from a `CapabilityManager` instance.

---

#### `registerLlmCapability(manager)` / `unregisterLlmCapability(manager)`

```typescript
function registerLlmCapability(manager: CapabilityManager): void
function unregisterLlmCapability(manager: CapabilityManager): void
```

Attach or detach the default LLM capability loader from a `CapabilityManager` instance.

---

#### `chunkText(content)`

```typescript
function chunkText(content: string): string[]
```

Split a document into overlapping chunks suitable for embedding. Used internally before calling the embed function on long notes.

---

#### `cosineSimilarity(a, b)`

```typescript
function cosineSimilarity(a: number[], b: number[]): number
```

Compute the cosine similarity between two equal-length embedding vectors.

**Returns:** A float in the range `[-1, 1]`.

---

#### `suggestTags(embedding, tagEmbeddings)`

```typescript
function suggestTags(
  embedding: number[],
  tagEmbeddings: Array<{ tag: string; embedding: number[] }>
): string[]
```

Return a ranked list of tags whose embeddings are most similar to the input embedding. Used by the concept tagging job handler.

---

### Migrations and Archive

#### `MigrationRunner`

```typescript
class MigrationRunner {
  constructor(db: PGlite)

  run(): Promise<void>
}
```

Applies all pending schema migrations in order. Safe to call on each startup; already-applied migrations are skipped.

---

#### `allMigrations`

```typescript
const allMigrations: Migration[]
```

The ordered array of all schema migration definitions used by `MigrationRunner`.

---

#### `ArchiveManager`

```typescript
class ArchiveManager {
  constructor(persistence: PersistenceMode, events?: TypedEventBus)

  open(name: string): Promise<PGlite>
  list(): Promise<string[]>
  create(name: string, persistence?: PersistenceMode): Promise<void>
  switch(name: string): Promise<PGlite>
  delete(name: string): Promise<void>
}
```

Manages multiple named archives (databases). Each archive is an independent PGlite instance.

| Method | Description |
|--------|-------------|
| `open(name)` | Open an existing archive and return its `PGlite` instance. |
| `list()` | Return names of all known archives for the current persistence mode. |
| `create(name, persistence?)` | Create a new empty archive with optional override persistence mode. |
| `switch(name)` | Open a different archive, replacing the currently active instance. |
| `delete(name)` | Permanently delete an archive and all its data. |

---

### Service Worker

#### `registerServiceWorker(options)`

```typescript
function registerServiceWorker(options?: {
  scriptUrl?: string
  scope?: string
}): Promise<ServiceWorkerRegistration>
```

Register the Fortemi service worker. The service worker intercepts requests to serve cached assets and route API-style requests to the in-process PGlite instance.

---

#### `createRoutes(db, events)`

```typescript
function createRoutes(
  db: PGlite,
  events: TypedEventBus
): Route[]
```

Build the route table used by the service worker to dispatch incoming `fetch` events to the appropriate repository method.

---

#### `matchRoute(routes, request)`

```typescript
function matchRoute(
  routes: Route[],
  request: Request
): RouteHandler | null
```

Find the handler for an incoming request by matching against the route table. Returns `null` if no route matches.

---

### Worker Utilities

#### `PGliteWorkerClient`

```typescript
class PGliteWorkerClient {
  constructor(worker: Worker)

  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: TransactionProxy) => Promise<T>): Promise<T>
}
```

A `PGlite`-compatible client that proxies queries over a `Worker` message channel. Use this on the main thread when PGlite is running in a dedicated worker.

---

#### `TransactionProxy`

```typescript
interface TransactionProxy {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string): Promise<void>
}
```

Handle passed to transaction callbacks in `PGliteWorkerClient.transaction`. Scoped to the in-flight transaction.

---

## @fortemi/react

### Provider

#### `FortemiProvider`

```typescript
function FortemiProvider(props: FortemiProviderProps): JSX.Element
```

Context provider that initializes a `FortemiCore` instance and makes it available to the component tree. Must wrap all components that use Fortemi hooks.

```tsx
<FortemiProvider persistence="opfs" archiveName="my-notes">
  <App />
</FortemiProvider>
```

---

#### `FortemiProviderProps`

```typescript
interface FortemiProviderProps {
  persistence: PersistenceMode
  archiveName?: string
  children: React.ReactNode
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `persistence` | `PersistenceMode` | Yes | Storage backend for the underlying PGlite instance |
| `archiveName` | `string` | No | Archive name; uses a default when omitted |
| `children` | `React.ReactNode` | Yes | Component subtree |

---

#### `useFortemiContext()`

```typescript
function useFortemiContext(): FortemiContextValue
```

Returns the `FortemiContextValue` from the nearest `FortemiProvider`. Throws if called outside a provider.

---

#### `FortemiContextValue`

```typescript
interface FortemiContextValue {
  db: PGlite
  events: TypedEventBus
  archiveManager: ArchiveManager
  capabilityManager: CapabilityManager
  blobStore: BlobStore
}
```

The raw runtime objects exposed by the provider. Use the typed hooks below for most UI work; access `FortemiContextValue` directly when calling repositories or tool functions manually.

---

### Hooks

All hooks re-render when relevant data changes via the event bus. Initial data is fetched on mount.

---

#### `useNotes(options?)`

```typescript
function useNotes(options?: NoteListOptions): {
  notes: NoteSummary[]
  total: number
  hasNext: boolean
  loading: boolean
  error: Error | null
  refetch: () => void
}
```

Subscribe to a paginated, filtered list of notes. Re-fetches automatically on `note.created`, `note.updated`, `note.deleted`, and `note.restored` events.

---

#### `useNote(id)`

```typescript
function useNote(id: string): {
  note: NoteFull | null
  loading: boolean
  error: Error | null
  refetch: () => void
}
```

Fetch and subscribe to a single note. Re-fetches when the note is updated or restored.

---

#### `useSearch()`

```typescript
function useSearch(): {
  data: SearchResponse | null
  loading: boolean
  error: Error | null
  search: (query: string, options?: SearchOptions) => Promise<SearchResponse>
  clear: () => void
}
```

Automatically dispatches to the best available search mode. When semantic capability is ready, generates a query embedding and passes it to `SearchRepository.search()`, enabling hybrid search (text + vector). When semantic is not available, falls back to text-only search.

---

#### `useSearchHistory()`

```typescript
function useSearchHistory(): {
  history: string[]
  addEntry: (query: string) => void
  removeEntry: (query: string) => void
  clearHistory: () => void
}
```

Persists search queries to `localStorage` (key: `fortemi:search-history`, max 50 entries). Deduplicates entries with most recent first. Survives archive switches.

---

#### `useSearchSuggestions(history?)`

```typescript
function useSearchSuggestions(history?: string[]): {
  suggestions: Array<{ text: string; source: 'vocabulary' | 'history' }>
  loading: boolean
  getSuggestions: (prefix: string) => void
  clearSuggestions: () => void
  refreshVocabulary: () => Promise<void>
}
```

Loads vocabulary from `ts_stat` (top 500 words by document frequency) on mount. Merges with search history for prefix-matched suggestions. Pass the `history` array from `useSearchHistory` for history-augmented suggestions.

---

#### `useCreateNote()`

```typescript
function useCreateNote(): {
  createNote: (input: NoteCreateInput) => Promise<NoteFull>
  loading: boolean
  error: Error | null
}
```

Returns a `createNote` function that calls `captureKnowledge` with `action: 'create'` and enqueues post-creation jobs.

---

#### `useUpdateNote()`

```typescript
function useUpdateNote(): {
  updateNote: (id: string, input: NoteUpdateInput) => Promise<NoteFull>
  loading: boolean
  error: Error | null
}
```

---

#### `useDeleteNote()`

```typescript
function useDeleteNote(): {
  deleteNote: (id: string) => Promise<void>
  restoreNote: (id: string) => Promise<void>
  loading: boolean
  error: Error | null
}
```

Provides both soft-delete and restore in a single hook.

---

#### `useTags()`

```typescript
function useTags(): {
  tags: string[]
  frequency: Array<{ tag: string; count: number }>
  loading: boolean
  error: Error | null
  suggest: (partial: string) => Promise<string[]>
}
```

Loads all tags and frequency counts on mount. `suggest` performs an on-demand prefix query.

---

#### `useCollections()`

```typescript
function useCollections(): {
  collections: CollectionRow[]
  loading: boolean
  error: Error | null
  createCollection: (input: { name: string; description?: string }) => Promise<CollectionRow>
  deleteCollection: (id: string) => Promise<void>
  addNotes: (collectionId: string, noteIds: string[]) => Promise<void>
  removeNotes: (collectionId: string, noteIds: string[]) => Promise<void>
}
```

---

#### `useJobQueue(pollMs?)`

```typescript
function useJobQueue(pollMs?: number): {
  jobs: Array<{ jobId: string; jobType: JobType; status: string; createdAt: string }>
  loading: boolean
}
```

Polls `getJobQueueStatus` at the specified interval (default: 2000 ms) and exposes the current queue state. Useful for displaying background processing indicators.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pollMs` | `number` | `2000` | Polling interval in milliseconds |
