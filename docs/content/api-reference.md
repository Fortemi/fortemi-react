# API Reference

**Packages:** `@fortemi/core` · `@fortemi/graph` · `@fortemi/react`
**Version:** 2026.7.6

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
    - [EmbeddingSetsRepository](#embeddingsetsrepository)
    - [GraphRepository](#graphrepository)
    - [CommunitiesRepository](#communitiesrepository)
  - [Repository Types](#repository-types)
  - [Tool Functions](#tool-functions)
  - [Job Queue](#job-queue)
  - [Capabilities](#capabilities)
  - [Migrations and Archive](#migrations-and-archive)
  - [Knowledge Shards](#knowledge-shards)
  - [Service Worker](#service-worker)
  - [Worker Utilities](#worker-utilities)
  - [AIWG Index (@fortemi/core/aiwg-index)](#aiwg-index-fortemicoreaiwg-index)
- [@fortemi/graph](#fortemigraph)
  - [Graph Data Model](#graph-data-model)
  - [Graph Helpers](#graph-helpers)
  - [Render Pipeline](#render-pipeline)
  - [Control Contract](#control-contract)
  - [SVG Renderer](#svg-renderer)
  - [GraphController](#graphcontroller)
- [@fortemi/react](#fortemireact)
  - [Provider](#provider)
  - [Hooks](#hooks)
    - [Graph and community hooks](#graph-and-community-hooks)
  - [Graph Views and Subpath Exports](#graph-views-and-subpath-exports)

---

## @fortemi/core

### Core Utilities

#### `VERSION`

```typescript
const VERSION: string
```

The current package version string. Value: `'2026.7.6'`.

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
function createFortemi(config: FortemiConfig): FortemiCore
```

Lightweight factory for the non-React runtime shell. It creates the shared `TypedEventBus`, stores the provided config, and exposes a `destroy()` cleanup hook. Use `ArchiveManager.open()` to create the PGlite database before constructing repositories.

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `FortemiConfig` | Configuration object (see [FortemiConfig](#fortemiconfig)) |

**Returns:** A `FortemiCore` instance.

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
  events: TypedEventBus
  config: FortemiConfig
  destroy(): void
}
```

The runtime shell returned by `createFortemi`. React apps usually get the richer `{ db, events, archiveManager, capabilityManager, blobStore }` surface from `FortemiProvider` instead.

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
- Query text without embedding = **text** (BM25 tsvector)
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
  tagNote(noteId: string, conceptId: string): Promise<NoteSkosTag>
  untagNote(noteId: string, conceptId: string): Promise<void>
  conceptsForNote(noteId: string): Promise<SkosConcept[]>
  getScheme(id: string): Promise<{ id: string; uri: string; title: string } | null>
  getConcept(id: string): Promise<{ id: string; schemeId: string; prefLabel: string; uri?: string } | null>
  listConcepts(schemeId: string): Promise<Array<{ id: string; prefLabel: string; uri?: string }>>
}
```

Supports a subset of the SKOS (Simple Knowledge Organization System) model for organizing note tags into hierarchical concept schemes and attaching concepts to notes.

| Method | Description |
|--------|-------------|
| `createScheme(input)` | Create a top-level concept scheme identified by URI. |
| `createConcept(input)` | Create a concept within a scheme. |
| `createRelation(input)` | Assert a typed relation (e.g. `'broader'`, `'narrower'`, `'related'`) between concepts. |
| `tagNote(noteId, conceptId)` | Attach a SKOS concept to a note idempotently. |
| `untagNote(noteId, conceptId)` | Remove a note-to-concept assignment. |
| `conceptsForNote(noteId)` | Read active SKOS concepts assigned to a note. |
| `getScheme(id)` | Retrieve a scheme by ID. |
| `getConcept(id)` | Retrieve a concept by ID. |
| `listConcepts(schemeId)` | List all concepts belonging to a scheme. |

---

#### `ProvenanceRepository`

```typescript
class ProvenanceRepository {
  constructor(db: PGlite)

  recordProvenance(
    entityType: string,
    entityId: string,
    input: {
      activity: string
      agent: string
      startedAt?: Date | string
      endedAt?: Date | string | null
      attributes?: Record<string, unknown> | null
    }
  ): Promise<ProvenanceEdge>

  forEntity(entityType: string, entityId: string): Promise<ProvenanceEdge[]>
}
```

First-class W3C PROV write/read surface over `provenance_edge`, so consumers do not need raw SQL to record lifecycle events.

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

#### `EmbeddingSetsRepository`

```typescript
class EmbeddingSetsRepository {
  constructor(db: PGlite, events?: TypedEventBus)

  create(input: EmbeddingSetCreateInput): Promise<EmbeddingSetRow>
  ensureDefault(): Promise<EmbeddingSetRow>
  get(id: string): Promise<EmbeddingSetRow>
  list(): Promise<EmbeddingSetRow[]>
  listDescriptors(): Promise<EmbeddingSetDescriptor[]>
  createVirtualDefinition(input: VirtualEmbeddingSetDefinition): Promise<EmbeddingSetRow>
  putEmbedding(input: EmbeddingSetEmbeddingInput): Promise<{ id: string }>
  resolveSelector(selector: EmbeddingSetSelector): Promise<ResolvedEmbeddingSet>
}
```

Manages physical and virtual embedding sets. Selectors can target explicit sets, criteria-based sets, set operations, latest-compatible sets, snapshots, or fallback chains. Virtual definitions are durable metadata until materialized by application code.

---

#### `GraphRepository`

```typescript
class GraphRepository {
  constructor(db: PGlite)

  buildLinkGraph(): Promise<CommunityGraph>
  buildSimilarityGraph(embeddingSet: string | EmbeddingSetSelector, options?: SimilarityGraphOptions): Promise<CommunityGraph>
  buildOrLoadSimilarityGraph(request: SimilarityGraphRequest): Promise<SimilarityGraphResult>
  saveSimilarityGraphArtifact(input: {
    graph: CommunityGraph
    request: Required<Pick<SimilarityGraphRequest, 'selector' | 'k' | 'minSimilarity' | 'metric' | 'source'>>
    resolved: ResolvedEmbeddingSet
    cacheKey: SimilarityGraphCacheKey
    freshness?: 'fresh' | 'stale' | 'unknown'
  }): Promise<SimilarityGraphResult['graphSource']>
  markSimilarityGraphStale(graphSourceId: string, reason: string): Promise<void>
  loadGraphArtifact(graphSourceId: string, noteIds?: string[]): Promise<CommunityGraph>
}
```

Builds citation and embedding-similarity graphs, detects communities, and persists precomputed graph artifacts for shard export/import and UI reuse. Cached graph results include source metadata, freshness, and cache status.

---

#### `CommunitiesRepository`

```typescript
class CommunitiesRepository {
  constructor(db: PGlite)

  previewDynamicCommunity(filters: CommunityFilterDefinition): Promise<CommunityAssignmentView[]>
  saveCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor>
  rerunDynamicCommunity(sourceId: string): Promise<CommunityAssignmentView[]>
  listCommunitySources(): Promise<CommunitySourceDescriptor[]>
  getCommunityAssignments(sourceId: string): Promise<CommunityAssignmentView[]>
  listCommunitySummaries(sourceId: string): Promise<CommunitySummary[]>
}
```

Provides runtime-only dynamic community previews plus persisted dynamic snapshots and user-authored communities. Saved communities use the graph/community artifact tables so they can round-trip through Knowledge Shards.

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
  has_embedding?: boolean  // whether the note has a vector embedding (for semantic search readiness)
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
  mode?: 'text' | 'semantic' | 'hybrid' | 'auto'  // override search mode (default: 'auto')
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
  confidence: number | null   // similarity score (1 - cosine distance) for semantic links
  updated_at: Date | null     // last modification timestamp
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

Tool functions accept plain input objects, validate them with Zod, and return structured results. `FortemiToolManifest` currently registers 10 bridge-visible Fortemi tools; `@fortemi/core` also exports `manageAttachments` as a direct helper because it requires both `db` and `blobStore`.

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

#### `createRemoteBackend(config)`

```typescript
function createRemoteBackend(config: {
  baseUrl: string
  id?: string
  fetchImpl?: typeof fetch
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  authToken?: string
  paths?: Partial<RemoteBackendPaths>
}): DataBackend
```

Creates the network-backed Fortemi server tier for `selectBackend`. The returned backend advertises `read`, `write`, `merge`, `multiUser`, `semantic: 'server'`, and `startupCost: 'network'`.

Readable `DataBackend` implementations expose `listNotes`, `getNote`, `search`, `getNoteFull`, `linksOf`, `conceptsOf`, and `provenanceOf`; write-capable backends expose `manageNote`, and semantic-capable backends expose `semantic`.

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
  input: { noteId: string; jobType: JobType; priority?: number; requiredCapability?: string | null }
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

#### `enqueueFullWorkflow(db, noteId)`

```typescript
async function enqueueFullWorkflow(db: PGlite, noteId: string): Promise<void>
```

Enqueues the complete 5-job pipeline for a note in correct dependency order: AI revision (1) → title generation (2) → embedding (3) → concept tagging (4) → linking (5).

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

| Job Type | Priority |
|----------|----------|
| `ai_revision` | 1 |
| `title_generation` | 2 |
| `embedding` | 3 |
| `concept_tagging` | 4 |
| `linking` | 5 |

---

#### `JOB_CAPABILITIES`

```typescript
const JOB_CAPABILITIES: Record<JobType, CapabilityName>
```

Maps each job type to the capability that must be ready before the job can run.
If a pending job's required capability is not ready, the worker defers dispatch,
keeps the job pending with a `requires capability '<name>' — not ready` message,
and emits both `job.blocked` and `capability.required` events.

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

#### `registerSemanticCapabilityWorker(manager, port, options?)`

```typescript
function registerSemanticCapabilityWorker(
  manager: CapabilityManager,
  port: EmbedTransportPort, // Worker | MessagePort
  options?: EmbedWorkerOptions, // { timeoutMs?: number } — default 30000, 0 disables
): void
```

Register the semantic capability backed by an off-main-thread transport, so embedding model load and per-query inference never touch the main thread (#180). Core round-trips each `{ texts }` request to the host-owned worker and awaits `number[][]`. Pairs with `handleEmbedRequests(port, embed)` (worker side) and `createWorkerEmbedFunction(port, options?)` (the lower-level primitive). Additive and opt-in; the main-thread `registerSemanticCapability` path is unchanged. See [Integration → Off-main-thread embedding transport](./guides/integration.md#off-main-thread-embedding-transport).

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
| `adopt(backend, name?)` | Adopt an already-created backend **without running migrations** — e.g. a PGlite restored from a physical snapshot (the restored data dir already carries the schema + indexes). |

---

#### Physical DB snapshot — `dumpDbSnapshot` / `restoreDbSnapshot`

A **snapshot** is a binary dump of a populated PGlite data directory — schema + rows + **indexes** (including the HNSW vector index) — that restores in a single load with **no migration, no shard import, and no client-side HNSW build**. It is the fast, pre-indexed, single-version restore option, complementary to logical Knowledge Shards (portable + mergeable, but they pay the import + reindex cost on every load).

> Distinct from `ArchiveManager`/`archiveName` (a *named persistence store*) and from Knowledge Shards (logical, mergeable interchange). "Snapshot" = the physical data-dir image.

```typescript
// Build-time (Node), after the corpus is populated and the HNSW index built once:
const { data, meta } = await dumpDbSnapshot(db, { compression: 'gzip' })
// Write `data` to e.g. corpus.pgdata and `meta` to corpus.pgdata.meta.json (the sidecar).

// Browser restore — verifies the version stamp BEFORE loading, then no migration/import:
const pglite = await restoreDbSnapshot('/corpus/corpus.pgdata', { persistence: 'memory' })
```

| Export | Description |
|--------|-------------|
| `dumpDbSnapshot(db, options?)` | Dump a `{ data, meta }` snapshot. `meta` stamps `{ pglite_version, pgvector_version, migration_head, created_at }`. |
| `restoreDbSnapshot(source, options?)` | Restore a `PGlite` from a snapshot (`{data,meta}`, a URL, or `{dataUrl, metaUrl?}`). Verifies the stamp first; throws `DbSnapshotVersionError` on mismatch (catch it to fall back to a shard import). |
| `verifyDbSnapshotMeta(meta, expected?)` | Pure compatibility check → `{ compatible, reasons, warnings }`. Hard gates: snapshot schema, migration head (exact), PGlite major.minor; pgvector is advisory. |
| `DbSnapshotVersionError` | Thrown when a snapshot is incompatible with this build; carries `reasons` + `meta`. |
| `SUPPORTED_PGLITE_VERSION` / `CURRENT_MIGRATION_HEAD` / `DB_SNAPSHOT_SCHEMA_VERSION` | The version values this build restores against. |

`createPGliteInstance(persistence, archiveName?, { loadDataDir })` accepts a snapshot blob directly for lower-level use. The React `FortemiProvider` exposes a `snapshotUrl` prop (main execution mode) as the turnkey path.

---

### Knowledge Shards

A Knowledge Shard is a gzip-compressed tar archive with 100% format compatibility with the Rust/PostgreSQL Fortemi server. All shard APIs are exported from the `@fortemi/core` root.

#### `exportShard(db, options?)`

```typescript
function exportShard(db: DatabaseClient, options?: ExportOptions): Promise<Uint8Array>

interface ExportOptions {
  includeEmbeddings?: boolean
  collectionId?: string          // export only notes in this collection
  tag?: string                   // export only notes with this tag (e.g. 'app:research')
  embeddingSetIds?: string[]     // export only these sets + member/vector rows
  includeMaterializedSelectors?: boolean
  clusterNotesSize?: number      // emit clustered notes/000.jsonl files for in-place readers
  includeBlobs?: boolean         // pack attachment bytes into a content-addressed blobs/<blake3-hex> sidecar
  blobStore?: BlobStore          // byte source for the sidecar; required when includeBlobs is set
}
```

Produces the `.shard` archive bytes. With `includeBlobs`, attachment bytes are read from `blobStore` by `content_hash` and packed as BLAKE3-addressed `blobs/<hex>` sidecar entries, making the shard self-contained; a blob the store cannot return is skipped (that attachment stays reference-only) rather than failing the export.

#### `importShard(db, data, options?)`

```typescript
function importShard(
  db: DatabaseClient,
  data: Uint8Array | ArrayBuffer,
  options?: ImportOptions,
): Promise<ImportResult>

type ConflictStrategy = 'skip' | 'replace' | 'error'

interface ImportOptions {
  conflictStrategy?: ConflictStrategy      // default 'skip'
  batchSize?: number                       // rows between cooperative yields (default 250)
  onProgress?: (progress: ImportProgress) => void
  blobStore?: BlobStore                    // destination for hydrating sidecar attachment bytes
}

interface ImportResult {
  success: boolean
  counts: ImportCounts                     // per-component imported-row counts
  skipped: Partial<ImportCounts>
  warnings: string[]
  errors: string[]
  duration_ms: number
}
```

Structured-error contract: a malformed manifest or component **resolves** to `{ success: false, errors: [...] }` — the promise does not reject. When `blobStore` is provided, sidecar entries matching imported attachments' `content_hash` are written to the store after the import transaction commits, so `getBlob()` returns real bytes; without it, attachments import as reference-only metadata.

#### `openShard(source, options?)`

```typescript
function openShard(source: ShardReaderSource, options?: OpenShardOptions): Promise<ShardReader>

interface OpenShardOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  semantic?: StaticSemanticProvider
  maxCachedMatches?: number
  maxComponentBytes?: number
}

interface ShardReader {
  readonly manifest: ShardManifest
  listNotes(options?: ShardListOptions): Promise<{ items: ShardReaderNote[]; total: number }>
  getNote(id: string): Promise<ShardReaderNote | null>
  getNoteFull(id: string): Promise<ShardNoteFull | null>
  search(query: string, options?: ShardSearchOptions): Promise<ShardSearchResult>
  semantic(query: string, k?: number): Promise<Array<{ note: ShardReaderNote; score: number }>>
  linksOf(id: string): Promise<ShardLink[]>
  conceptsOf(id: string): Promise<ShardSkosConcept[]>
  relationsOf(conceptId: string): Promise<ShardSkosRelation[]>
  provenanceOf(id: string): Promise<ShardProvenanceEdge[]>
  close(): void
}
```

Read a shard **in place** — no database, no import. Components are fetched and checksum-validated lazily as each is first read (not up front), so opening is cheap even for large shards; clustered-note layouts (`clusterNotesSize` at export) fetch only the clusters they need. Throws when the shard's `min_reader_version` exceeds this build — fall back to `importShard`.

#### `createCosineSemanticProvider(options)`

```typescript
function createCosineSemanticProvider(options: {
  embedQuery: (query: string) => Promise<number[]> | number[]
  vectorsFile?: string           // default 'vectors.jsonl'
  vectors?: VectorEntry[]        // supply vectors directly instead of reading a file
}): StaticSemanticProvider
```

Brute-force cosine provider for `openShard`'s `semantic` option. Fine for small/demo corpora; supply a prebuilt-ANN `StaticSemanticProvider` for full-size corpora.

#### Prefetch / warm API

```typescript
function prefetchShard(url: string, options?: PrefetchOptions): Promise<PrefetchResult>
function fromPrefetched(url: string): Uint8Array   // throws if not prefetched
function isShardPrefetched(url: string): boolean
function getPrefetchedSha256(url: string): string | undefined
function clearPrefetchedShard(url?: string): void  // omit url to clear all
```

`prefetchShard(url, { expectedSha256 })` downloads (optionally via Cache Storage) and verifies the whole-archive SHA-256, warming the bytes for a later `openShard(fromPrefetched(url))` or `importShard`.

#### Schema validation and low-level helpers

| Export | Purpose |
|---|---|
| `validateShardArchive` / `validateShardManifest` / `validateShardComponentRecord` / `assertShardComponentRecord` | Validate against the vendored `knowledge-shard.schema.json` authority; return `ShardSchemaValidationResult` |
| `getKnowledgeShardSchema()` | The parsed JSON Schema object |
| `packTarGz` / `unpackTarGz` | Tar + gzip primitives used by the pipelines |
| `sha256Hex` / `validateChecksums` | Component checksum helpers |
| `noteToShard`, `noteFromShard`, `linkToShard`, `collectionToShard`, … | Per-entity field mappers between browser rows and server-parity shard JSON (one `xToShard`/`xFromShard` pair per component; see `shard/field-mapper.ts`) |
| `CURRENT_SHARD_VERSION` / `SHARD_FORMAT` | Format constants |

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

### AIWG Index (`@fortemi/core/aiwg-index`)

Database-free tooling for AIWG Fortemi index exports (`aiwg.fortemi.index.export.v1`/`v2`): validate, query, chunk, embed, and project static index files without PGlite. Import from the subpath:

```typescript
import { createAiwgIndexController, queryAiwgFortemiIndex } from '@fortemi/core/aiwg-index'
```

The schema authority is vendored at `packages/core/schemas/aiwg-fortemi-index-export.schema.json` (pinned with a provenance receipt).

#### `createAiwgIndexController(initialIndex?)`

```typescript
function createAiwgIndexController(initialIndex?: AiwgFortemiIndexExport): AiwgIndexController

interface AiwgIndexController {
  // Loading
  loadIndex(value: unknown): AiwgFortemiIndexExport
  loadChunkedIndex(manifest: unknown, loader: AiwgChunkedIndexLoader, options?: AiwgChunkedIndexLoadOptions): AiwgFortemiChunkManifest
  getIndex(): AiwgFortemiIndexExport | null
  getChunkedManifest(): AiwgFortemiChunkManifest | null
  getSnapshot(): AiwgIndexControllerSnapshot
  // Query
  query(query?: string, options?: AiwgIndexQueryOptions): AiwgIndexQueryResult
  queryChunked(query?: string, options?: AiwgChunkedIndexQueryOptions): Promise<AiwgChunkedIndexQueryResult>
  getRecord(id: string): Promise<AiwgFortemiRecord>   // resolves projected records via the detail loader
  // Relationship traversal
  neighbors(id: string, options?: AiwgRelationshipTraversalOptions): Promise<AiwgRelationshipTraversalResult>
  relationshipQuery(options?: AiwgRelationshipQueryOptions): Promise<AiwgRelationshipTraversalResult>
  relationshipSet(options: AiwgRelationshipSetOptions): Promise<AiwgRelationshipSetResult>
  // Graph projection
  toCommunityGraph(options?: AiwgIndexGraphOptions): CommunityGraph
  toCommunityGraphChunked(options?: AiwgIndexGraphOptions & { onProgress?: (p: AiwgChunkedIndexProgress) => void }): Promise<CommunityGraph>
  // Review workflow
  setReviewDecision(input: AiwgReviewInput): AiwgReviewDecision
  clearReviewDecision(itemId: string): void
  createReviewDecisionExport(generatedAt?: string): AiwgReviewDecisionExport
  // Lifecycle
  clearChunkCache(): void
  subscribe(listener: AiwgIndexControllerListener): () => void
}
```

Stateful controller over a whole or chunked index: load once, then query, traverse relationships, project to a `CommunityGraph`, and record review decisions. `subscribe` notifies on load/decision changes.

#### Query functions

```typescript
function queryAiwgFortemiIndex(
  index: AiwgFortemiIndexExport,
  query?: string,
  options?: AiwgIndexQueryOptions,
): AiwgIndexQueryResult

interface AiwgIndexQueryOptions {
  types?: string[]
  facets?: Record<string, string[]>
  tags?: string[]
  concepts?: string[]
  privacy?: AiwgPrivacyClassification[]      // 'private' | 'sanitized' | 'public'
  relationshipTargetId?: string
  limit?: number
  offset?: number
  rank?: boolean
  snippets?: boolean
  snippetLength?: number
  weights?: Partial<AiwgIndexQueryWeights>   // title/text/tag/concept/facet/id/source
  includeMatches?: boolean
  searchProfile?: 'default' | 'aiwg-discovery'
}

interface AiwgIndexQueryResult {
  items: AiwgFortemiRecord[]
  total: number
  facets: Record<string, Record<string, number>>
  rankedItems?: AiwgIndexQueryRankedItem[]   // when rank: true — rank, snippet, matches
}

// Semantic and hybrid variants over a static embedding set
function queryAiwgSemanticIndex(index, embeddingSet, queryEmbedding: number[], options?): AiwgStaticSemanticResult[]
function queryAiwgHybridIndex(index, embeddingSet, query: string, queryEmbedding: number[], options?): AiwgStaticHybridResult[]
```

#### Chunked indexes

```typescript
function buildAiwgChunkedIndex(index: AiwgFortemiIndexExport, options?: { partSize?: number /* default 500 */, ... }): AiwgChunkedIndexBuildResult
function createAiwgFetchChunkLoader(baseUrl?: string | URL): AiwgChunkedIndexLoader
function createAiwgFetchDetailLoader(baseUrl?: string | URL): AiwgChunkedIndexDetailLoader
```

`buildAiwgChunkedIndex` splits a whole index into a manifest + fixed-size parts (optionally search-projected records with per-id detail files) for static hosting. The fetch loaders resolve part/detail `href`s against `baseUrl`. v2 exports with `source.graph` are supported end-to-end.

#### Static embeddings

```typescript
function buildAiwgStaticEmbeddingSet(
  index: AiwgFortemiIndexExport,
  options: BuildAiwgStaticEmbeddingSetOptions,   // embed callback + granularity ('body' default)
): Promise<AiwgStaticEmbeddingSet>

function findAiwgStaticDuplicatePairs(index, embeddingSet, threshold = 0.9, options?): AiwgStaticDuplicatePair[]
```

#### Validators

Every validator has a `validate*` form returning `{ valid, errors }` — total on hostile input, never throws — and an `assert*` form that throws on invalid input:

| Validate (total) | Assert (throwing) | Target |
|---|---|---|
| `validateAiwgFortemiIndexExport` | `assertAiwgFortemiIndexExport` | Whole index export (v1/v2) |
| `validateAiwgFortemiChunkManifest` | `assertAiwgFortemiChunkManifest` | Chunk manifest |
| `validateAiwgFortemiChunkPart` | `assertAiwgFortemiChunkPart` | Chunk part (checked against source export version) |
| `validateAiwgStaticEmbeddingSet` | `assertAiwgStaticEmbeddingSet` | Static embedding set |

#### Projection and utilities

| Export | Purpose |
|---|---|
| `aiwgFortemiIndexToCommunityGraph(index, options?)` | Project records + relationships to a `@fortemi/graph` `CommunityGraph` (relationship weights, community strategy via `AiwgIndexGraphOptions`) |
| `filterAiwgRecordsByPrivacy(records, options?)` | Drop records above the allowed privacy classification (fails closed on unknown values) |
| `getAiwgFortemiFacets(items)` | Facet-name → value → count aggregation |
| `createAiwgReviewDecisionExport(source, decisions, generatedAt?)` | Serialize review decisions for round-trip to AIWG |
| `resolveAiwgFetchUrl` / `encodeAiwgDetailId` / `aiwgDetailHrefForId` | URL/id helpers used by the fetch loaders |
| `AIWG_SCAN_REQUIRED_FIELDS` / `DEFAULT_AIWG_DUPLICATE_SCAN_MAX_EMBEDDINGS` | Constants |

---

## @fortemi/graph

Framework-agnostic graph tooling. The projection helpers operate on plain
`CommunityGraph` data (structurally identical to what `@fortemi/core` produces),
so a graph from `GraphRepository` or `aiwgFortemiIndexToCommunityGraph` drops
straight in. `@fortemi/react`'s `GraphView` is built on these helpers, and JS-only
hosts can use them to render their own SVG/canvas views without React or PGlite.
All projection helpers are pure (no input mutation), deterministic, and
database-free, so they tree-shake cleanly. The package depends on `@fortemi/core`
for `GraphController` (the graph-source state machine), which reaches core's
repositories.

```bash
pnpm add @fortemi/graph
```

### Graph Data Model

```typescript
interface GraphNode { id: string }
interface GraphEdge { source: string; target: string; weight: number; kind?: string }
interface GraphCommunity { id: string; nodes: string[] }
interface CommunityGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: GraphCommunity[]
}

type GraphLayoutAlgorithm = 'force' | 'radial' | 'community' | 'manual'

interface PositionedGraphNode extends GraphNode {
  x: number
  y: number
  degree: number
  communityId?: string
}

interface PositionedGraph {
  nodes: PositionedGraphNode[]
  edges: GraphEdge[]
  nodeIndex: Map<string, PositionedGraphNode>
}

interface GraphBounds {
  minX: number; minY: number; maxX: number; maxY: number
  width: number; height: number; centerX: number; centerY: number
}

interface ViewportTransform { scale: number; offsetX: number; offsetY: number }
```

`@fortemi/graph` re-exports `CommunityGraph` and its member types for hosts that
do not depend on `@fortemi/core`. Community *detection* (`detectCommunities`)
lives in `@fortemi/core`, which remains the base layer; this package only
projects graphs it is given.

### Graph Helpers

```typescript
// Layout — deterministic 2D positions + per-node degree/community
interface LayoutOptions {
  algorithm?: GraphLayoutAlgorithm
  width?: number
  height?: number
  seed?: number                     // deterministic PRNG seed (`force`)
  ticks?: number                    // settlement iterations (`force`)
  nodeRadius?: NodeRadiusResolver   // per-node render radius
  linkDistance?: number             // target edge length px (`force`)
  linkStrength?: number             // spring stiffness 0..1 (`force`)
  chargeStrength?: number           // repulsion magnitude (`force`)
  collisionPadding?: number         // extra collision spacing (`force`)
  communityStrength?: number        // pull toward community centroid (`force`)
  boundsPadding?: number            // min distance from canvas edges
  pinned?: PositionMap              // positions held fixed during settlement
  initialPositions?: PositionMap    // warm-start seed positions
}
function layoutCommunityGraph(
  graph: CommunityGraph,
  options?: LayoutOptions,
): PositionedGraph

// Filter — by community, edge kind, node allow-list, or predicate
interface GraphFilter {
  communityIds?: string[]
  edgeKinds?: string[]
  nodeIds?: string[]
  nodePredicate?: (node: GraphNode) => boolean
}
function filterCommunityGraph(graph: CommunityGraph | null | undefined, filter?: GraphFilter): CommunityGraph

// Sizing
function computeDegrees(graph: CommunityGraph): Map<string, number>
function nodeRadius(
  degree: number,
  options?: { base?: number; perDegree?: number; min?: number; max?: number },
): number

// Color — deterministic community → color (themeable palette)
const COMMUNITY_COLORS: readonly string[]
const UNASSIGNED_COMMUNITY_COLOR: string
function colorForCommunity(communityId: string | undefined, palette?: readonly string[], unassignedColor?: string): string

// Bounds / fit
function computeGraphBounds(nodes: ReadonlyArray<{ x: number; y: number }>): GraphBounds
function fitGraphToViewport(
  bounds: GraphBounds,
  viewport: { width: number; height: number },
  options?: { padding?: number; minScale?: number; maxScale?: number },
): ViewportTransform

// Selection / neighborhood
function buildAdjacency(graph: CommunityGraph): Map<string, Set<string>>
function neighborsOf(graph: CommunityGraph, nodeId: string): Set<string>
function expandNeighborhood(
  graph: CommunityGraph,
  seeds: Iterable<string>,
  options?: { depth?: number; includeSeeds?: boolean },
): Set<string>
function subgraphForNodes(graph: CommunityGraph, nodeIds: Iterable<string>): CommunityGraph
function neighborhoodSubgraph(graph: CommunityGraph, seeds: Iterable<string>, options?: { depth?: number; includeSeeds?: boolean }): CommunityGraph

// Static snapshots — reproducible JSON for JS-only hosts
interface GraphSnapshot {
  version: number
  graph: CommunityGraph
  layout?: { algorithm: GraphLayoutAlgorithm; width: number; height: number }
  generatedAt?: string
}
const GRAPH_SNAPSHOT_VERSION: number
function serializeGraphSnapshot(graph: CommunityGraph, options?: { layout?: GraphSnapshot['layout']; generatedAt?: string }): GraphSnapshot
function stringifyGraphSnapshot(graph: CommunityGraph, options?: { layout?: GraphSnapshot['layout']; generatedAt?: string }): string
function deserializeGraphSnapshot(input: GraphSnapshot | string): CommunityGraph
```

See `packages/graph/README.md` for a complete vanilla-JS host example that
fetches a snapshot and renders it to SVG using these helpers.

### Render Pipeline

Prepares a `CommunityGraph` for any renderer tier (SVG, Sigma 2D, 3D) as a `RenderGraph` — plain nodes/links with resolved colors, labels, and optionally baked positions.

```typescript
// CommunityGraph → RenderGraph (colors + labels resolved, positions optional)
function mapCommunityGraph(graph: CommunityGraph, options?: MapCommunityGraphOptions): RenderGraph

// Layout + map in one step: positions baked in (x/y on every node)
function bakeRenderGraph(graph: CommunityGraph, options?: BakeRenderGraphOptions): RenderGraph

// Deterministic JSON (sorted nodes/links) for committing snapshots
function stringifyRenderGraph(graph: RenderGraph): string

// Load a snapshot from a URL, object, or factory; null on failure
function loadRenderSnapshot(
  source: string | RenderGraph | (() => Promise<RenderGraph | null> | RenderGraph | null),
  options?: { fetchImpl?: typeof fetch; requirePositions?: boolean },  // requirePositions default true
): Promise<RenderGraph | null>

// Guards and palette helpers
function isRenderGraph(value: unknown): value is RenderGraph
function hasBakedPositions(graph: RenderGraph): boolean
function communityRanks(graph: CommunityGraph): Map<string, number>   // largest community = rank 0
const GREYSCALE_COMMUNITY_RAMP: readonly string[]
```

### Control Contract

Every renderer tier honors the shared **`GraphControlContract`** — `algorithm`, `filters`, `selectedNodeId` + `onSelectNode`, `onNavigate`, `labelFor`, `colors` — so switching tiers means passing the same options object.

```typescript
interface GraphControlFilters {
  communityIds?: string[]
  edgeKinds?: string[]
  nodeIds?: string[]
  minDegree?: number
}

// The one filter function every tier runs — visibility is identical across tiers
function applyControlFilters(graph: CommunityGraph | null | undefined, filters?: GraphControlFilters): CommunityGraph

// Shared legend data: { communityId, color, count }[]
function communityLegend(graph: CommunityGraph | null | undefined, colors?: readonly string[]): GraphLegendEntry[]
```

### SVG Renderer

```typescript
function renderCommunityGraph(
  container: HTMLElement,
  graph: CommunityGraph,
  options?: GraphRenderOptions,   // extends GraphControlContract
): GraphRenderHandle

interface GraphRenderOptions extends GraphControlContract {
  layoutOptions?: Omit<LayoutOptions, 'algorithm' | 'width' | 'height'>
  background?: string       // default '#fafafa'
  interactive?: boolean     // default true (pan/zoom/click)
  minScale?: number
  maxScale?: number
}

interface GraphRenderHandle {
  update(next: GraphRenderUpdate): void   // patch graph/filters/algorithm/selection/labels
  focus(nodeId: string | null): void
  destroy(): void
  readonly element: SVGSVGElement
}
```

Dependency-free DOM/SVG renderer for vanilla-JS hosts — no React required.

### GraphController

```typescript
class GraphController {
  constructor(db: GraphControllerDb, options?: GraphControllerOptions)
  getState(): GraphControllerState
  subscribe(listener: GraphControllerListener): () => void
  start(): Promise<void>
  refresh(): Promise<void>
  setMode(mode: GraphSourceMode): void
  setEmbeddingSetSelector(selector: EmbeddingSetSelector): void
  setCommunitySource(sourceId: string | null): void
  setFilters(filters: CommunityFilterDefinition): void
  recompute(): Promise<void>
  previewDynamicCommunity(filters: CommunityFilterDefinition): Promise<void>
  saveCurrentCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor>
}
```

Graph-source state machine: selects the source mode, loads/derives the `CommunityGraph` through core's repositories, and publishes `GraphControllerState` to subscribers. This is the package's one dependency on `@fortemi/core`; the React `useGraphController` hook wraps it.

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
  executionMode?: 'main' | 'worker'
  createWorker?: () => Worker
  snapshotUrl?: string
  snapshotExpectations?: DbSnapshotExpectations
  children: React.ReactNode
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `persistence` | `PersistenceMode` | Yes | Storage backend for the underlying PGlite instance |
| `archiveName` | `string` | No | Archive name; uses a default when omitted |
| `executionMode` | `'main' \| 'worker'` | No | Run PGlite on the main thread (default) or in a worker |
| `createWorker` | `() => Worker` | No | Worker factory for `executionMode: 'worker'` |
| `snapshotUrl` | `string` | No | Restore from a physical data-dir snapshot (#187) instead of migrating an empty DB — fetches `<url>` + `<url>.meta.json`, verifies the stamp, then loads pre-indexed (no migration/import/HNSW build). Main mode only. |
| `snapshotExpectations` | `DbSnapshotExpectations` | No | Override the snapshot version-compatibility expectations |
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

Returns a `createNote` function that constructs a `NotesRepository` from context and calls `NotesRepository.create()`. The repository emits `note.created` and queues post-creation jobs.

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

---

#### `useRelatedNotes(noteId, limit?)`

```typescript
function useRelatedNotes(noteId: string, limit?: number): {
  links: RelatedNote[]
  loading: boolean
}

interface RelatedNote {
  noteId: string
  title: string | null
  confidence: number | null
  linkType: string
  direction: 'outbound' | 'inbound'
}
```

Returns semantically linked notes for the given note. Merges outbound and inbound links, deduplicates, and sorts by confidence descending. Auto-refreshes when a `linking` job completes for this note.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `noteId` | `string` | required | Note to find related notes for |
| `limit` | `number` | `3` | Maximum number of related notes to return |

---

#### `useNoteConcepts(noteId)`

```typescript
function useNoteConcepts(noteId: string): {
  concepts: NoteConcept[]
  loading: boolean
}

interface NoteConcept {
  conceptId: string
  prefLabel: string
  schemeName: string
  schemeId: string
}
```

Returns SKOS concepts assigned to a note via the `note_skos_tag` table. Joins through `skos_concept` and `skos_scheme` to provide full label and scheme context. Auto-refreshes when a `concept_tagging` job completes for this note.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `noteId` | `string` | required | Note to retrieve concepts for |

---

#### `useNoteProvenance(noteId)`

```typescript
function useNoteProvenance(noteId: string): {
  events: ProvenanceEvent[]
  loading: boolean
}

interface ProvenanceEvent {
  timestamp: Date
  type: 'created' | 'job' | 'revision'
  label: string
  detail?: string
}
```

Aggregates a chronological provenance timeline from existing data: note creation timestamp, completed job queue entries, and user/AI revisions. No schema changes required — uses `job_queue` and `note_revision` tables. Auto-refreshes when any job completes for this note.

Job results are summarized (e.g., `"3 links found"`, `"384-dim vector"`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `noteId` | `string` | required | Note to retrieve provenance timeline for |

---

#### `useExportShard()`

```typescript
function useExportShard(): {
  exportShard: (options?: ExportOptions) => Promise<void>
  isExporting: boolean
  progress: ExportProgress | null
  error: Error | null
}
```

Exports the current archive as a Knowledge Shard and triggers a browser download.

---

#### `useImportShard()`

```typescript
function useImportShard(): {
  importShard: (file: File, strategy?: ConflictStrategy) => Promise<ImportResult>
  importFromUrl: (url: string, strategy?: ConflictStrategy, prefetchOptions?: PrefetchOptions) => Promise<ImportResult>
  isImporting: boolean
  progress: ImportProgress | null
  error: Error | null
  result: ImportResult | null
}
```

Imports a Knowledge Shard from a user-selected file or static URL. Warmed URLs from `useShardPrefetch` reuse prefetched bytes.

---

#### `useShardPrefetch()`

```typescript
function useShardPrefetch(): {
  prefetch: (url: string, options?: PrefetchOptions) => Promise<PrefetchResult>
  isPrefetched: (url: string) => boolean
  warming: Record<string, boolean>
  error: Error | null
}
```

Warms static shard bytes in the background and optionally verifies SHA-256 before an import click.

---

#### `useGpuCapabilities()`

```typescript
function useGpuCapabilities(): {
  caps: GpuCapabilities | null
  vramTier: VramTier | null
  isDetecting: boolean
  error: Error | null
}
```

Detects WebGPU capabilities and derives a VRAM tier for local inference planning.

---

#### `useInferenceCapabilities()`

```typescript
function useInferenceCapabilities(): {
  capabilities: InferenceCapabilities | null
  loading: boolean
  error: Error | null
}
```

Detects browser and hardware inference capabilities, including WebGPU/WebNN/Chrome AI availability.

---

#### `useLocalDiscovery(options?)`

```typescript
function useLocalDiscovery(options?: UseLocalDiscoveryOptions): {
  providers: DiscoveredProvider[]
  discovering: boolean
  error: Error | null
  refresh: () => void
}
```

Probes local inference servers on mount and on the configured interval.

---

#### `useEmbeddingPipeline(loader)`

```typescript
function useEmbeddingPipeline(loader: EmbedFunctionLoader): {
  embedFunction: EmbedFunction | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  progress: string
  error: Error | null
  load: () => void
  unload: () => void
}
```

Loads a host-provided embedding function on demand and registers it with `@fortemi/core`.

---

#### `useEmbeddingWorker(transport, options?)`

```typescript
function useEmbeddingWorker(
  transport: EmbedTransportPort,
  options?: EmbedWorkerOptions
): {
  status: 'idle' | 'connected'
  connect: () => void
  disconnect: () => void
}
```

Wires a host-owned `Worker` or `MessagePort` into the core embed function so query and job embedding run off the main thread.

---

### Graph and community hooks

#### `useEmbeddingSets()`

```typescript
function useEmbeddingSets(): {
  embeddingSets: EmbeddingSetDescriptor[]
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
  create: (input: EmbeddingSetCreateInput) => Promise<EmbeddingSetRow>
  createVirtualDefinition: (input: VirtualEmbeddingSetDefinition) => Promise<EmbeddingSetRow>
}
```

Lists physical and virtual embedding-set descriptors and creates new physical sets or durable virtual definitions.

#### `useSimilarityGraph(embeddingSet, options?)`

```typescript
function useSimilarityGraph(
  embeddingSet: string | EmbeddingSetSelector | null | undefined,
  options?: SimilarityGraphOptions & { autoRefresh?: boolean }
): {
  graph: CommunityGraph | null
  graphSource: SimilarityGraphResult['graphSource'] | null
  cache: SimilarityGraphResult['cache'] | null
  freshness: SimilarityGraphResult['freshness'] | null
  loading: boolean
  error: Error | null
  refresh: () => Promise<SimilarityGraphResult | null>
  recompute: () => Promise<SimilarityGraphResult | null>
  markStale: (reason: string) => Promise<void>
}
```

Loads cached precomputed similarity graphs when available, falls back to live computation, and exposes cache/freshness state for UI decisions.

#### `useCommunities()`

```typescript
function useCommunities(): {
  sources: CommunitySourceDescriptor[]
  activeSourceId: string | null
  summaries: CommunitySummary[]
  assignments: Map<string, CommunityAssignmentView>
  loading: boolean
  error: Error | null
  preview: (filters: CommunityFilterDefinition) => Promise<CommunityAssignmentView[]>
  save: (input: CommunityCreateInput) => Promise<CommunitySourceDescriptor>
  rerun: (sourceId: string) => Promise<CommunityAssignmentView[]>
  setActiveSource: (sourceId: string | null) => void
  refresh: (sourceId?: string | null) => Promise<void>
}
```

Works with persisted community sources and unsaved dynamic previews for search-derived or manually authored groupings.

#### `useGraphController(options?)`

```typescript
function useGraphController(options?: UseGraphControllerOptions): {
  mode: 'citations' | 'topics' | 'precomputed' | 'dynamic-search' | 'user-authored'
  graph: CommunityGraph | null
  graphSource?: SimilarityGraphResult['graphSource'] | { id: string; name: string }
  communitySource?: CommunitySourceDescriptor
  embeddingSetSelector?: EmbeddingSetSelector
  filters?: CommunityFilterDefinition
  layout: GraphLayoutState
  status: GraphControllerStatus
  transition?: GraphTransitionState
  setMode: (mode: GraphSourceMode) => void
  setEmbeddingSetSelector: (selector: EmbeddingSetSelector) => void
  setCommunitySource: (sourceId: string | null) => void
  setFilters: (filters: CommunityFilterDefinition) => void
  refresh: () => Promise<void>
  recompute: () => Promise<void>
  previewDynamicCommunity: (filters: CommunityFilterDefinition) => Promise<void>
  saveCurrentCommunity: (input: CommunityCreateInput) => Promise<CommunitySourceDescriptor>
}
```

Coordinates graph-source switching for citation, topic, precomputed, dynamic-search, and user-authored graph views without exposing raw SQL or graphology internals to React UI code.

#### `useCapabilitySetup(options)`

```typescript
function useCapabilitySetup(options: UseCapabilitySetupOptions): {
  ready: boolean
  error: Error | null
}
```

Registers host-provided capability loaders and auto-enables previously enabled capabilities from local storage unless `autoEnable` is supplied.

#### `useAiwgIndex(initialIndex?)`

```typescript
function useAiwgIndex(initialIndex?: AiwgFortemiIndexExport): {
  index: AiwgFortemiIndexExport | null
  chunkedManifest: AiwgFortemiChunkManifest | null
  counts: Record<string, number>
  data: AiwgIndexQueryResult | AiwgChunkedIndexQueryResult | null
  error: Error | null
  reviewDecisions: AiwgReviewDecision[]
  loadIndex: (value: unknown) => AiwgFortemiIndexExport
  loadChunkedIndex: (manifest: unknown, loader: AiwgChunkedIndexLoader, options?: AiwgChunkedIndexLoadOptions) => AiwgFortemiChunkManifest
  search: (query?: string, options?: AiwgIndexQueryOptions) => AiwgIndexQueryResult
  searchChunked: (query?: string, options?: AiwgChunkedIndexQueryOptions) => Promise<AiwgChunkedIndexQueryResult>
  getRecord: (id: string) => Promise<AiwgFortemiRecord>
  clearChunkCache: () => void
  setReviewDecision: (input: AiwgReviewInput) => AiwgReviewDecision
  clearReviewDecision: (itemId: string) => void
  exportReviewDecisions: () => AiwgReviewDecisionExport
  toCommunityGraph: (options?: AiwgIndexGraphOptions) => CommunityGraph
}
```

Loads whole or chunked AIWG Fortemi index exports, searches them, tracks review decisions, and projects loaded indexes into community graph data.

#### `useShard(source, options?)`

```typescript
function useShard(source: ShardReaderSource, options?: OpenShardOptions): {
  reader: ShardReader | null
  manifest: ShardManifest | null
  loading: boolean
  error: Error | null
  listNotes: (options?: ShardListOptions) => Promise<{ items: ShardReaderNote[]; total: number }>
  getNote: (id: string) => Promise<ShardReaderNote | null>
  search: (query: string, options?: ShardSearchOptions) => Promise<ShardSearchResult>
  linksOf: (id: string) => Promise<ShardLink[]>
  conceptsOf: (id: string) => Promise<ShardSkosConcept[]>
  relationsOf: (conceptId: string) => Promise<ShardSkosRelation[]>
  provenanceOf: (id: string) => Promise<ShardProvenanceEdge[]>
  getNoteFull: (id: string) => Promise<ShardNoteFull | null>
  semantic: (query: string, k?: number) => Promise<Array<{ note: ShardReaderNote; score: number }>>
}
```

Opens a Knowledge Shard for in-place, read-only browsing and search without importing it into PGlite.

#### `useRemote(config)`

```typescript
function useRemote(config: RemoteBackendConfig): {
  backend: DataBackend
  loading: boolean
  error: Error | null
  listNotes: (options?: BackendListOptions) => Promise<{ items: BackendNote[]; total: number }>
  getNote: (id: string) => Promise<BackendNote | null>
  search: (query: string, options?: BackendSearchQueryOptions) => Promise<BackendSearchResult>
  getNoteFull: (id: string) => Promise<BackendNoteFull | null>
  linksOf: (id: string) => Promise<BackendLink[]>
  conceptsOf: (id: string) => Promise<BackendConcept[]>
  provenanceOf: (id: string) => Promise<BackendProvenanceEdge[]>
  semantic: (query: string, k?: number) => Promise<BackendSearchHit[]>
  manageNote: (input: unknown) => Promise<unknown>
}
```

Wraps `createRemoteBackend(config)` for React and exposes the Fortemi server-tier `DataBackend` surface with shared loading and error state.

---

### Graph Views and Subpath Exports

Three renderer tiers over the same `@fortemi/graph` data, each on its own subpath so heavy dependencies never enter a consumer's bundle unless imported:

| Subpath | Component | Extra deps | Best for |
|---|---|---|---|
| `@fortemi/react/graph` | `GraphView` | none (PGlite-free; React + `@fortemi/graph` only) | Static SVG rendering, docs-map/static tenants |
| `@fortemi/react/graph-2d` | `SigmaGraphView` | `sigma` + `graphology` + `graphology-layout-forceatlas2` (optional peers, lazy-loaded) | Live force settling, camera focus, LOD labels |
| `@fortemi/react/graph-3d` | `ForceGraph3DView` | `react-force-graph-3d` + `three` (optional peers, lazy via `React.lazy`) | Orbitable 3D force graph, 2D/3D toggle |

`GraphView` is also re-exported from the package root; `SigmaGraphView` and `ForceGraph3DView` are subpath-only, so their renderers never enter the root module graph. Import `GraphView` from `@fortemi/react/graph` (rather than the root) when you also want to keep PGlite out of your bundle.

#### `GraphView`

```typescript
interface GraphViewProps {
  graph: CommunityGraph | null
  layout?: Partial<GraphLayoutState>
  filters?: GraphViewFilters
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
  onNavigate?: (nodeId: string) => void
  labelFor?: (nodeId: string) => string
  draggableNodes?: boolean
  width?: number
  height?: number
  style?: CSSProperties
}
```

Static SVG renderer built on `layoutCommunityGraph`/`filterCommunityGraph`. Carries no runtime dependency on `@fortemi/core` (type-only `CommunityGraph` import, erased at build).

#### `SigmaGraphView`

```typescript
interface SigmaGraphViewProps {
  graph: CommunityGraph | RenderGraph | null
  snapshot?: string | RenderGraph        // URL or prebaked RenderGraph; skips live layout
  filters?: GraphControlFilters
  labelFor?: (id: string) => string
  palette?: CommunityPalette
  onSelectNode?: (nodeId: string) => void
  onOpenNode?: (nodeId: string) => void
  settleMs?: number                      // ForceAtlas2 settle duration
  theme?: Partial<SigmaTheme>
  height?: number | string
  style?: CSSProperties
}
```

Interactive 2D explorer backed by Sigma + graphology ForceAtlas2, dynamically imported on mount. Renders an install hint if the optional peers are missing.

#### `ForceGraph3DView`

```typescript
interface ForceGraph3DViewProps {
  graph: CommunityGraph | RenderGraph | null
  snapshot?: string | RenderGraph
  filters?: GraphControlFilters
  labelFor?: (id: string) => string
  palette?: CommunityPalette
  onSelectNode?: (nodeId: string) => void
  onOpenNode?: (nodeId: string) => void
  theme?: Partial<ForceGraph3DTheme>
  height?: number | string
  style?: CSSProperties
}
```

3D force-directed view backed by `react-force-graph-3d` (Three.js), loaded lazily so Three only ships when the view mounts. Accepts the same data and `GraphControlFilters` as the 2D tiers — 2D/3D parity by construction.
