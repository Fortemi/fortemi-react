# Getting Started with Fortemi React

This guide walks you through adding Fortemi knowledge management to a React application. By the end you will have a working integration that can create, list, and search notes stored locally in the browser — no server required.

---

## Prerequisites

- **Node.js 22 or later** — required by `@fortemi/core`
- **pnpm 10** — the workspace uses pnpm; `npm` and `yarn` also work for downstream consumers
- **React 19** — `@fortemi/react` targets the React 19 API (including the new JSX transform and `use` hook)

---

## Installation

Install both packages. `@fortemi/react` re-exports everything you need from `@fortemi/core`, but you should install `@fortemi/core` explicitly if you access its types or utilities directly.

```bash
pnpm add @fortemi/core @fortemi/react
```

`@fortemi/core` brings in `@electric-sql/pglite` as a dependency, which includes WebAssembly binaries. No additional configuration is needed for bundlers like Vite or webpack 5 — WASM is loaded at runtime via `WebAssembly.instantiateStreaming`.

---

## Quick Start

The following is a minimal working app. It wraps the tree in `FortemiProvider`, creates a note on button click, and renders the list of notes.

```tsx
// App.tsx
import { FortemiProvider, useCreateNote, useNotes } from '@fortemi/react'

function NoteBoard() {
  const { createNote, loading: creating } = useCreateNote()
  const { data, loading: fetching } = useNotes({ sort: 'created_at', order: 'desc' })

  async function handleCreate() {
    await createNote({ content: 'Hello from Fortemi', title: 'My first note' })
  }

  if (fetching) return <p>Loading notes...</p>

  return (
    <div>
      <button onClick={handleCreate} disabled={creating}>
        {creating ? 'Creating...' : 'New note'}
      </button>

      <ul>
        {data?.items.map((note) => (
          <li key={note.id}>
            <strong>{note.title ?? 'Untitled'}</strong>
            <time dateTime={note.created_at.toISOString()}>
              {note.created_at.toLocaleDateString()}
            </time>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function App() {
  return (
    <FortemiProvider persistence="opfs" archiveName="my-app">
      <NoteBoard />
    </FortemiProvider>
  )
}
```

---

## FortemiProvider

`FortemiProvider` is the root of the Fortemi tree. It initializes the embedded PGlite database, runs schema migrations, and makes the core services available to all hooks via React context.

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `persistence` | `'opfs' \| 'idb' \| 'memory'` | Yes | — | Storage backend (see below) |
| `archiveName` | `string` | No | `'default'` | Logical name for the database; used to namespace the storage path |
| `children` | `ReactNode` | Yes | — | The rest of your component tree |

### Persistence modes

| Mode | Storage | Browser support | Notes |
|------|---------|-----------------|-------|
| `'opfs'` | Origin Private File System | Chrome 86+, Edge 86+, Safari 15.2+ | Fastest. Uses the asynchronous Hierarchy Access API. Recommended for production. |
| `'idb'` | IndexedDB | All modern browsers including Firefox | Slightly slower than OPFS but universally supported. Good fallback. |
| `'memory'` | RAM only | All browsers | Data is lost on page refresh. Useful for tests and previews. |

To detect browser support at runtime and select a mode automatically:

```ts
function selectPersistence(): 'opfs' | 'idb' {
  return 'storage' in navigator && typeof StorageManager !== 'undefined'
    ? 'opfs'
    : 'idb'
}
```

### What FortemiProvider initializes

On mount, the provider:

1. Creates a `TypedEventBus` — an in-process pub/sub bus for note, job, and capability events
2. Opens an `ArchiveManager` with the selected persistence mode and archive name
3. Runs all schema migrations against the PGlite instance
4. Creates a `CapabilityManager` for optional WASM features (embeddings, LLM)
5. Creates a `BlobStore` scoped to the archive name for binary attachment storage

Once initialization completes, the provider makes five objects available via context to all child hooks:

```ts
interface FortemiContextValue {
  db: PGlite            // The PGlite database instance
  events: TypedEventBus // In-process event bus
  archiveManager: ArchiveManager
  capabilityManager: CapabilityManager
  blobStore: BlobStore
}
```

You can access this context directly with `useFortemiContext()` if you need lower-level access. All built-in hooks call it internally.

### Loading state

While initialization runs, `FortemiProvider` renders nothing (`null`). Wrap it in a `Suspense` boundary or a loading screen at the app shell level if you need to display a spinner:

```tsx
<Suspense fallback={<p>Starting database...</p>}>
  <FortemiProvider persistence="opfs">
    <App />
  </FortemiProvider>
</Suspense>
```

If initialization fails (for example, the browser blocks OPFS access), the provider throws an error that will be caught by the nearest error boundary.

---

## Your First Note

### Creating a note

`useCreateNote` returns a `createNote` function and loading/error state.

```tsx
import { useCreateNote } from '@fortemi/react'

function NewNoteForm() {
  const { createNote, loading, error } = useCreateNote()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const content = (form.elements.namedItem('content') as HTMLTextAreaElement).value

    const note = await createNote({
      content,
      title: 'Meeting notes',       // optional; omit to let auto-title run
      format: 'markdown',            // optional; defaults to 'markdown'
      tags: ['meetings', 'q1'],     // optional
    })

    console.log('Created note with id:', note.id)
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea name="content" required />
      {error && <p role="alert">{error.message}</p>}
      <button type="submit" disabled={loading}>Save</button>
    </form>
  )
}
```

The `NoteCreateInput` type:

```ts
interface NoteCreateInput {
  content: string
  title?: string
  format?: string       // 'markdown' | 'plain' | any custom format string
  source?: string       // e.g. 'web-clipper', 'import', 'user'
  visibility?: string   // 'private' | 'shared' (application-defined)
  tags?: string[]
  archive_id?: string   // target a specific archive by name
}
```

`createNote` returns a `NoteFull` object and emits a `note.created` event on the bus, which causes any active `useNotes` hooks to refresh automatically.

### Listing notes

`useNotes` accepts optional filter and pagination options and returns a paginated result. It subscribes to `note.created`, `note.updated`, `note.deleted`, `note.restored`, and `job.completed` events so the list stays current without manual polling.

```tsx
import { useNotes } from '@fortemi/react'

function NoteList() {
  const { data, loading, error, refresh } = useNotes({
    sort: 'updated_at',
    order: 'desc',
    limit: 20,
    offset: 0,
    tags: ['meetings'],          // filter to notes tagged 'meetings'
    is_starred: true,            // only starred notes
    include_deleted: false,      // exclude soft-deleted notes (default)
  })

  if (loading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>
  if (!data) return null

  return (
    <>
      <p>{data.total} notes</p>
      <ul>
        {data.items.map((note) => (
          <li key={note.id}>
            <span>{note.title ?? 'Untitled'}</span>
            <span>{note.tags.join(', ')}</span>
          </li>
        ))}
      </ul>
      {data.total > data.limit && (
        <button onClick={refresh}>Load more</button>
      )}
    </>
  )
}
```

`NoteListOptions` reference:

```ts
interface NoteListOptions {
  limit?: number
  offset?: number
  sort?: 'created_at' | 'updated_at' | 'title'
  order?: 'asc' | 'desc'
  is_starred?: boolean
  is_pinned?: boolean
  is_archived?: boolean
  include_deleted?: boolean
  include_archived?: boolean
  collection_id?: string
  tags?: string[]
}
```

Each item in `data.items` is a `NoteSummary`. To load the full content of a specific note, use `useNote(id)`:

```tsx
const { data: note, loading, error } = useNote(selectedId)
// note is NoteFull | null — includes note.original.content and note.current.content
```

---

## Search

`useSearch` exposes a `search` function that automatically selects the best available search mode. When semantic capability is enabled, it generates a query embedding and uses hybrid search (BM25 + vector RRF). Otherwise it falls back to text search.

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useSearch } from '@fortemi/react'

function SearchPanel() {
  const [query, setQuery] = useState('')
  const { data, loading, error, search, clear } = useSearch()

  const handleSearch = useCallback((q: string) => {
    if (!q.trim()) { clear(); return }
    search(q, { limit: 10 })
  }, [search, clear])

  // Debounce: search 300 ms after the user stops typing
  useEffect(() => {
    const timer = setTimeout(() => handleSearch(query), 300)
    return () => clearTimeout(timer)
  }, [query, handleSearch])

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notes..."
      />

      {loading && <p>Searching...</p>}
      {error && <p role="alert">{error.message}</p>}

      {data && (
        <p>
          {data.total} results (mode: {data.mode})
        </p>
      )}

      {data && (
        <ul>
          {data.results.map((result) => (
            <li key={result.id}>
              <strong>{result.title ?? 'Untitled'}</strong>
              <div dangerouslySetInnerHTML={{ __html: result.snippet }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

`search(query, options?)` accepts 12 filter parameters:

```ts
interface SearchOptions {
  limit?: number             // 1-100, default: 20
  offset?: number            // pagination offset
  tags?: string[]            // filter: notes with ANY of these tags
  collection_id?: string     // filter: notes in this collection
  date_from?: Date           // filter: created on or after
  date_to?: Date             // filter: created on or before
  is_starred?: boolean       // filter: starred status
  is_archived?: boolean      // filter: archived status
  format?: string            // filter: 'markdown' | 'plain' | 'html'
  source?: string            // filter: 'user' | 'mcp' | 'import' | 'api'
  visibility?: string        // filter: 'private' | 'shared' | 'public'
  include_facets?: boolean   // include tag/collection counts (default: false)
}
```

`SearchResponse` shape:

```ts
interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  mode: 'text' | 'semantic' | 'hybrid'  // actual search mode used
  semantic_available: boolean
  limit: number
  offset: number
  facets?: SearchFacets      // present when include_facets: true
}

interface SearchResult {
  id: string
  title: string | null
  snippet: string           // excerpt with match context (<mark> tags for text mode)
  rank: number              // relevance score (higher is more relevant)
  created_at: Date
  updated_at: Date
  tags: string[]
}
```

Additional search hooks: `useSearchHistory()` persists recent queries to localStorage, and `useSearchSuggestions(history)` provides prefix-matched autocomplete from the note vocabulary. See [Search](./search.md) for details.

---

## Next Steps

- **Hook reference** — Complete API for all hooks including `useNote`, `useUpdateNote`, `useDeleteNote`, `useTags`, `useCollections`, and `useJobQueue`: [hooks.md](./hooks.md)
- **Capabilities** — How to enable semantic search and LLM features using the `CapabilityManager` and built-in loaders: [capabilities.md](./capabilities.md)
- **Archives** — Working with named archives to isolate or switch datasets at runtime: [archives.md](./archives.md)
- **Job queue** — Background processing for title generation, auto-tagging, and embeddings with `useJobQueue`: [job-queue.md](./job-queue.md)
- **TypeScript types** — All exported types from `@fortemi/core` and `@fortemi/react`: [api-types.md](./api-types.md)
