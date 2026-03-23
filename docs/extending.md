# Extending fortemi-react

This guide covers the primary extension points in `@fortemi/react` and `@fortemi/core`. Each section shows the exact pattern to follow, with references to the production code those patterns were drawn from.

## Prerequisites

- `@fortemi/core` and `@fortemi/react` installed
- A working `FortemiProvider` wrapping your component tree
- TypeScript with strict mode

---

## 1. Custom Tool Functions

Tool functions are the boundary between external callers (the Plinyverse bridge, MCP hosts, or your own UI code) and the repository layer. Every tool validates its input with a Zod schema before touching the database.

**Pattern:** define a Zod schema, export the inferred type, write an async function that parses raw input and delegates to a repository.

```typescript
// src/tools/rate-note.ts

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from '@fortemi/core'
import { z } from 'zod'
import { generateId } from '@fortemi/core'

// 1. Define and export the schema
export const RateNoteInputSchema = z.object({
  note_id: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
})

export type RateNoteInput = z.infer<typeof RateNoteInputSchema>

export interface RateNoteResult {
  rating_id: string
  note_id: string
  rating: number
}

// 2. Write the tool function
export async function rateNote(
  db: PGlite,
  rawInput: unknown,
  events?: TypedEventBus,
): Promise<RateNoteResult> {
  // Always parse at the tool boundary — never trust rawInput
  const input = RateNoteInputSchema.parse(rawInput)

  const id = generateId()
  await db.query(
    `INSERT INTO note_rating (id, note_id, rating, comment, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (note_id) DO UPDATE SET rating = $3, comment = $4`,
    [id, input.note_id, input.rating, input.comment ?? null],
  )

  // Emit an event so React hooks can refresh automatically
  events?.emit('note.updated', { id: input.note_id })

  return { rating_id: id, note_id: input.note_id, rating: input.rating }
}
```

```typescript
// src/tools/index.ts — add exports alongside built-in tools

export { rateNote, RateNoteInputSchema } from './rate-note.js'
export type { RateNoteInput, RateNoteResult } from './rate-note.js'
```

**Key rules:**

- The function signature is always `(db: PGlite, rawInput: unknown, events?: TypedEventBus): Promise<YourResult>`.
- Call `YourSchema.parse(rawInput)` as the first statement. If the input is invalid, Zod throws a `ZodError` and nothing runs.
- `events` is optional — the tool must work without it (tests pass `undefined`).
- Return a plain object; callers serialize it as needed.

---

## 2. Custom Job Handlers

The `JobQueueWorker` processes rows from the `job_queue` table in priority order. You register a handler for a job type and the worker dispatches to it automatically.

**Handler signature:**

```typescript
type JobHandler = (job: Job, db: PGlite) => Promise<unknown>
```

where `Job` carries `id`, `note_id`, `job_type`, `retry_count`, and related fields.

### Writing a handler

```typescript
// src/jobs/summarize-handler.ts

import type { PGlite } from '@electric-sql/pglite'
import { getLlmFunction } from '@fortemi/core'

interface SummarizeJob {
  id: string
  note_id: string
  job_type: string
  retry_count: number
  [key: string]: unknown
}

export async function summarizeHandler(
  job: SummarizeJob,
  db: PGlite,
): Promise<unknown> {
  // 1. Load required data
  const result = await db.query<{ content: string }>(
    `SELECT content FROM note_revised_current WHERE note_id = $1`,
    [job.note_id],
  )
  if (result.rows.length === 0) {
    throw new Error(`No content for note ${job.note_id}`)
  }

  const llmFn = getLlmFunction()
  if (!llmFn) {
    return { skipped: true, reason: 'llm capability not ready' }
  }

  // 2. Process
  const summary = await llmFn(
    `Summarize in two sentences:\n\n${result.rows[0].content.slice(0, 2000)}`,
    { maxTokens: 120, temperature: 0.3 },
  )

  // 3. Persist the result
  await db.query(
    `UPDATE note SET summary = $1, updated_at = now() WHERE id = $2`,
    [summary.trim(), job.note_id],
  )

  return { summary_length: summary.length }
}
```

### Registering the handler and enqueuing jobs

Register before calling `worker.start()`. The worker skips job types that have no registered handler, so order matters.

```typescript
import {
  JobQueueWorker,
  enqueueJob,
  titleGenerationHandler,
  aiRevisionHandler,
} from '@fortemi/core'
import { summarizeHandler } from './jobs/summarize-handler.js'

// In your setup code (or inside a React hook alongside useJobQueue)
const worker = new JobQueueWorker(db, events, { pollIntervalMs: 5000 }, capabilityManager)

// Register built-in handlers
worker.registerHandler('title_generation', titleGenerationHandler)
worker.registerHandler('ai_revision', aiRevisionHandler)

// Register your custom handler
worker.registerHandler('summarize', summarizeHandler)

worker.start()

// Enqueue a summarize job for a note
await enqueueJob(db, {
  noteId: 'note-uuid-here',
  jobType: 'summarize' as never,  // cast needed until you extend JobType
  priority: 4,                     // lower number = higher priority
  requiredCapability: 'llm',       // worker skips if 'llm' capability is not ready
})
```

**Key rules:**

- Return a value (or `{ skipped: true, reason: '...' }`) — the worker serializes the return value into `job_queue.result`.
- Throw an error to trigger the retry/failure logic. The worker increments `retry_count` and re-queues up to `max_retries` (default 3).
- Check for optional dependencies (LLM, embeddings) at the start of the handler and return a skipped result rather than throwing if they are unavailable.
- Never mark jobs complete or failed yourself — the worker manages all status transitions.

---

## 3. Custom Capability Modules

Capabilities are opt-in WASM modules tracked by `CapabilityManager`. A capability loader is an async function registered with `manager.registerLoader()`. The manager calls it when `manager.enable(name)` is invoked and transitions the state machine accordingly.

The built-in capability names are `'semantic' | 'llm' | 'audio' | 'vision' | 'pdf'`. Custom capabilities follow the same pattern but use their own registration key. Note that `CapabilityManager` is initialized with those five names — if you need a capability gated on a name outside that set, pass the name as a `requiredCapability` string in `enqueueJob` and check `manager.isReady()` manually in your handler, or contribute a new `CapabilityName` to the type.

### Writing a loader

```typescript
// src/capabilities/ocr-loader.ts

import type { CapabilityManager } from '@fortemi/core'

let ocrEngine: OcrEngine | null = null

export function getOcrEngine(): OcrEngine | null {
  return ocrEngine
}

/**
 * Register the OCR capability loader.
 * Called once at startup; the loader runs when manager.enable('vision') is invoked.
 */
export function registerOcrCapability(manager: CapabilityManager): void {
  manager.registerLoader('vision', async () => {
    // Report progress so the UI can show a loading indicator
    manager.setProgress('vision', 'Loading OCR model...')

    // Load your WASM module or remote model here
    const { createEngine } = await import('./ocr-engine.js')
    ocrEngine = await createEngine({ language: 'eng' })

    manager.setProgress('vision', 'OCR ready')
  })
}

export function unregisterOcrCapability(): void {
  ocrEngine = null
}
```

### Enabling the capability

```typescript
import { CapabilityManager } from '@fortemi/core'
import { registerOcrCapability } from './capabilities/ocr-loader.js'

// capabilityManager is available from useFortemiContext() in React
// or from createFortemi() in non-React code

registerOcrCapability(capabilityManager)

// Trigger loading — the loader runs asynchronously
await capabilityManager.enable('vision')

// Check state before depending on it
if (capabilityManager.isReady('vision')) {
  const engine = getOcrEngine()
  // ...
}
```

**State machine summary:**

```
unloaded -> loading  (enable called)
loading  -> ready    (loader resolves)
loading  -> error    (loader throws)
ready    -> disabled (disable called)
error    -> loading  (enable called again — retry)
```

**Key rules:**

- `registerLoader` must be called before `enable`. If `enable` is called with no registered loader the capability transitions directly to `ready` without running any initialization.
- The loader must not call `markReady` or `markError` itself — those methods exist for external bridge protocols. Let the loader simply resolve or throw.
- Use `manager.setProgress(name, message)` and `manager.reportProgress(name, pct)` to communicate loading status to the UI.
- The `capability.loading`, `capability.ready`, and `capability.disabled` events are emitted automatically — subscribe via `events.on('capability.ready', ...)` to react to state changes.

---

## 4. Custom React Hooks

Custom hooks follow the same pattern as the built-in hooks: call `useFortemiContext()` to get `db` and `events`, perform an initial data fetch, then subscribe to relevant events and re-fetch when they fire.

```typescript
// src/hooks/useNoteRatings.ts

import { useState, useEffect, useCallback } from 'react'
import { useFortemiContext } from '@fortemi/react'

export interface NoteRating {
  id: string
  note_id: string
  rating: number
  comment: string | null
  created_at: Date
}

export function useNoteRatings(noteId: string | null) {
  const { db, events } = useFortemiContext()
  const [ratings, setRatings] = useState<NoteRating[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    if (!noteId) {
      setRatings([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const result = await db.query<NoteRating>(
        `SELECT * FROM note_rating WHERE note_id = $1 ORDER BY created_at DESC`,
        [noteId],
      )
      setRatings(result.rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [db, noteId])

  useEffect(() => {
    void refresh()

    // Subscribe to events that signal the data may have changed.
    // Always capture the IDisposable returned by events.on() and
    // call .dispose() in the cleanup function.
    const subs = [
      events.on('note.updated', (e) => { if (e.id === noteId) void refresh() }),
      events.on('job.completed', (e) => { if (e.noteId === noteId) void refresh() }),
    ]

    return () => subs.forEach(s => s.dispose())
  }, [refresh, events, noteId])

  return { ratings, loading, error, refresh }
}
```

**Usage:**

```tsx
import { useNoteRatings } from './hooks/useNoteRatings.js'

function NoteDetail({ id }: { id: string }) {
  const { ratings, loading } = useNoteRatings(id)

  if (loading) return <p>Loading ratings...</p>
  return (
    <ul>
      {ratings.map(r => (
        <li key={r.id}>{r.rating}/5 — {r.comment}</li>
      ))}
    </ul>
  )
}
```

**Key rules:**

- Always call `events.on(...)` inside `useEffect` and always return the cleanup function that calls `.dispose()` on every subscription. Leaking subscriptions causes memory growth and stale refreshes.
- Use `useCallback` for `refresh` so the `useEffect` dependency array is stable. If `refresh` changes identity on every render, the effect fires in a loop.
- Wildcard subscriptions (`events.on('note.*', handler)`) fire for any event whose prefix matches. Use them when you want to refresh on any note mutation regardless of sub-type.
- Do not call `events.emit` from a hook unless you are implementing a mutation hook alongside a read hook.

---

## 5. Database Migrations

Migrations are plain objects with a `version` number, a `name` string, and a `sql` string. The `MigrationRunner` tracks applied versions in `schema_version` and only runs migrations with a version number higher than the current maximum.

**Rules — follow these without exception:**

- Never modify an existing migration file. It has already run in production databases.
- Never reuse a version number.
- Append only: the next migration is always `current_max + 1`.
- The current highest version is `0004_embeddings` (version 4). Your first custom migration is version 5.

### Writing a migration

```typescript
// src/migrations/0005_note_ratings.ts

import type { Migration } from '@fortemi/core'

export const migration0005: Migration = {
  version: 5,
  name: '0005_note_ratings',
  sql: `
    CREATE TABLE IF NOT EXISTS note_rating (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (note_id)
    );

    CREATE INDEX IF NOT EXISTS idx_note_rating_note ON note_rating(note_id);
  `,
}
```

### Registering the migration

Pass the combined migration array to `MigrationRunner.apply()`. The runner is idempotent — already-applied migrations are skipped.

```typescript
import { MigrationRunner, allMigrations } from '@fortemi/core'
import { migration0005 } from './migrations/0005_note_ratings.js'

const runner = new MigrationRunner(db, events)
await runner.apply([...allMigrations, migration0005])
```

If you are using `ArchiveManager` or `createFortemi()`, call `MigrationRunner` explicitly after the database is open but before any repository operations.

---

## 6. Custom Event Types

`TypedEventBus` is typed through the `EventMap` interface. To add custom events with full type safety, extend the interface via declaration merging.

```typescript
// src/events.d.ts  (or any .ts file loaded before your event code)

import '@fortemi/core'

declare module '@fortemi/core' {
  interface EventMap {
    'rating.created': { noteId: string; rating: number }
    'rating.updated': { noteId: string; rating: number }
    'rating.deleted': { noteId: string }
  }
}
```

After this declaration merging is in place, `events.emit` and `events.on` are fully typed for your custom events:

```typescript
import { TypedEventBus } from '@fortemi/core'

const events = new TypedEventBus()

// TypeScript infers the payload shape from the event name
events.on('rating.created', ({ noteId, rating }) => {
  console.log(`Note ${noteId} rated ${rating}/5`)
})

// emit is also type-checked — wrong payload shape is a compile error
events.emit('rating.created', { noteId: 'abc', rating: 4 })
```

Wildcard subscriptions work with custom events without any additional setup:

```typescript
// Fires for rating.created, rating.updated, and rating.deleted
events.on('rating.*', (payload) => {
  console.log('rating event:', payload)
})
```

**Key rules:**

- Use `namespace.action` naming (e.g., `rating.created`) to take advantage of the wildcard prefix matching.
- Place declaration merging in a file that TypeScript includes in its compilation — typically a `.d.ts` file or any `.ts` file referenced from `tsconfig.json`.
- The `TypedEventBus` instance itself does not need modification. The type augmentation affects only TypeScript's type checking, not runtime behavior.

---

## 7. Format Parity Testing

Format parity tests verify that your new tables and fields have the same column names and JavaScript types as the server-side Rust implementation. They use the `matchServerShape` helper and a JSON fixture file extracted from the server.

**Test pattern:** create a fixture file, insert a representative row, read it back, and compare the shape.

### Step 1: Create a fixture file

```json
// src/__tests__/format-parity/fixtures/note_rating.json
[
  {
    "id": "019577b4-a7c0-7000-8000-000000000099",
    "note_id": "019577b4-a7c0-7000-8000-000000000002",
    "rating": 4,
    "comment": "Very useful",
    "created_at": "2026-03-22T10:00:00.000Z"
  }
]
```

The fixture represents a real row from the server's database. Every field that the server returns must appear in the fixture. The `matchServerShape` helper compares field names and value types (not values), treating `null` as compatible with any type.

### Step 2: Write the test

```typescript
// src/__tests__/format-parity/format-parity.test.ts
// Add inside the existing describe('Format Parity', ...) block

import { loadServerFixture, matchServerShape } from './helpers.js'

it('note_rating table shape matches server', async () => {
  // Insert a fixture row
  await db.query(
    `INSERT INTO note_rating (id, note_id, rating, comment, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      '019577b4-a7c0-7000-8000-000000000099',
      '019577b4-a7c0-7000-8000-000000000002',  // must exist in the test db
      4,
      'Very useful',
      '2026-03-22T10:00:00.000Z',
    ],
  )

  // Read it back
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM note_rating WHERE id = '019577b4-a7c0-7000-8000-000000000099'`,
  )

  // Load the server fixture
  const serverFixture = loadServerFixture('note_rating')

  // Compare shapes
  const comparison = matchServerShape(result.rows[0], serverFixture[0])

  expect(comparison.missing).toEqual([])    // No fields the server has that we don't
  expect(comparison.extra).toEqual([])      // No fields we have that the server doesn't
  expect(comparison.typeMismatch).toEqual([]) // No type disagreements
})
```

**Key rules:**

- `matchServerShape` treats `Date` objects (returned by PGlite for `TIMESTAMPTZ`) and ISO strings (returned by the server) as the same type — the helper normalizes them both to `'string'`.
- If your table has JSONB columns, PGlite may return them as a string or as a parsed object depending on the query. Normalize before comparing: `if (typeof row.my_column === 'string') row.my_column = JSON.parse(row.my_column)`.
- The test database is shared across tests in the file. Insert rows with UUIDs that do not collide with rows inserted by other tests.
- Run format parity tests against a real PGlite instance with all migrations applied, exactly as the existing tests do in `beforeAll`.

---

## 8. Service Worker Routes

Custom routes intercept `fetch` events in the Service Worker and return JSON responses without a network round-trip. Each route is a `RouteHandler` object with a `method`, a `RegExp` `pattern`, and an async `handler` function.

### Writing a route

```typescript
// src/service-worker/custom-routes.ts

import type { RouteHandler } from '@fortemi/core'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status)
}

/**
 * Returns custom routes to merge with the built-in route list.
 *
 * Patterns must not overlap with the built-in /api/v1/ routes defined
 * in @fortemi/core's createRoutes(). Use a distinct prefix or sub-path.
 *
 * The handler receives:
 *   request — the original Request object
 *   match   — the RegExpMatchArray from pattern.exec(pathname)
 *   params  — the URL's search parameters
 */
export function createCustomRoutes(): RouteHandler[] {
  return [
    // GET /api/v1/notes/:id/rating
    {
      method: 'GET',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/rating\/?$/,
      handler: async (request, match, params) => {
        const noteId = match[1]
        if (!noteId) return errorResponse('Missing note ID', 400)

        // The SW does not have direct DB access in this implementation.
        // Return the data shape your UI expects; wire real DB access when
        // the PGlite worker client is available in the SW context.
        return errorResponse('Database not connected in SW context', 503)
      },
    },

    // POST /api/v1/notes/:id/rating
    {
      method: 'POST',
      pattern: /^\/api\/v1\/notes\/([^/]+)\/rating\/?$/,
      handler: async (request, match) => {
        const noteId = match[1]
        if (!noteId) return errorResponse('Missing note ID', 400)

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return errorResponse('Invalid JSON body', 400)
        }

        // Validate and process body here
        return errorResponse('Database not connected in SW context', 503)
      },
    },
  ]
}
```

### Registering routes in the Service Worker

The built-in SW entry point (`sw.ts`) calls `createRoutes()` once at module load. To add custom routes, either merge them into a single array before the fetch listener runs, or replace `sw.ts` with your own entry point:

```typescript
// src/service-worker/sw-custom.ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { createRoutes, matchRoute } from '@fortemi/core'
import { createCustomRoutes } from './custom-routes.js'

// Merge built-in routes with your custom routes.
// More specific patterns should come first; matchRoute returns the first match.
const routes = [...createCustomRoutes(), ...createRoutes()]

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/mcp/')) {
    event.respondWith(handleRequest(event.request, url))
  }
})

async function handleRequest(request: Request, url: URL): Promise<Response> {
  const route = matchRoute(routes, request, url)
  if (route) {
    const match = url.pathname.match(route.pattern)!
    return route.handler(request, match, url.searchParams)
  }
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

Point your Vite (or other bundler) config at `sw-custom.ts` instead of the default SW entry.

**Key rules:**

- `matchRoute` returns the first matching route in the array. Place more specific patterns before broader ones. For example, `/notes/:id/rating` must appear before `/notes/:id` or the latter will match first.
- Route patterns match `url.pathname` only — query parameters arrive separately as `URLSearchParams` via the `params` argument.
- The handler must always return a `Response`. Throwing an unhandled error inside a handler will cause the browser to surface a network error to the caller.
- The SW runs in a separate context without direct PGlite access. Full DB wiring in the SW requires the `PGliteWorkerClient` from `@fortemi/core`.
