# Example Applications

Fortemi ships with four example applications that demonstrate how to build different types of apps on top of the fortemi data layer. All examples run at `pnpm dev` (http://localhost:5173) — click **Examples** in the header to access them.

Each example includes a **Load Sample Data** button so you can see it working immediately without entering data manually.

---

## Architecture Pattern: Tag-Scoped Applications

Every example is built around a single core pattern: **tag-scoped data**. Each application assigns every note it creates an `app:*` tag (such as `app:research` or `app:flashcard`). All reads filter by that same tag. The result is logical separation within a shared database.

```typescript
const APP_TAG = 'app:myapp'

// Creating scoped data
await createNote({ content: '...', tags: ['topic-tag', APP_TAG] })

// Querying scoped data
const { data } = useNotes({ tags: [APP_TAG] })
await search(query, { tags: [APP_TAG], include_facets: true })

// Display facets without the app tag
facets.tags.filter(f => f.tag !== APP_TAG)
```

This produces several useful properties:

- Notes created by one example app do not appear in another example app's list or search results.
- The **main app** (the Notes view) sees all notes regardless of tag — demonstrating that the same database serves multiple views simultaneously.
- Facet displays strip the `app:*` tag from visible results, since it is an internal scope marker rather than a user-facing label.

In production, this pattern can represent namespaces, tenant identifiers, or feature-area boundaries. Logical separation requires no database partitioning.

---

## The Examples

### 1. Research Paper Organizer

**Type:** Record keeper
**File:** `apps/standalone/src/examples/ResearchOrganizer.tsx`
**Tag:** `app:research`
**Seed data:** 5 ML and AI research paper abstracts

This example demonstrates the core fortemi search stack: faceted results, phrase search, search history replay, and starred filtering. It is the clearest illustration of how tag scoping works, because the UI is straightforward enough that all the data-layer behavior is visible.

**Features demonstrated:**
- Faceted search results via `include_facets: true` — tag chips appear above results and are clickable filters
- Phrase search — wrapping a query in quotes performs exact-phrase matching via PostgreSQL's `tsquery`
- Search history replay — recent queries appear below the search box and can be re-run with one click
- Starred filter — a checkbox toggles `is_starred` filtering without rewriting the query

**Key APIs:** `useSearch` with `include_facets`, `useSearchHistory`, `useCreateNote`, `useNotes` with `tags` filter

---

### 2. Flashcard Quiz

**Type:** Application
**File:** `apps/standalone/src/examples/FlashcardQuiz.tsx`
**Tag:** `app:flashcard`
**Seed data:** 6 computer science and algorithms question-and-answer cards

This example shows fortemi being used as an application engine rather than a record keeper. Notes store question-and-answer pairs (question in the title, answer in the content). The app has two distinct modes — browse and study — and uses fortemi's semantic linking to suggest related cards during a study session.

When you study a card, the **Study next** panel is populated by `useRelatedNotes`, which queries the `note_links` table. Those links are computed by the job queue's linking job after `enqueueFullWorkflow` runs. The study experience is therefore powered directly by the data layer, not by any hand-coded recommendation logic.

**Features demonstrated:**
- Search as application engine — the browse mode uses `useSearch` to filter cards by topic
- Semantic linking for study suggestions — `useRelatedNotes` drives the "Study next" panel
- Browse and study mode switching — one component handles both UX states
- Full workflow pipeline — `enqueueFullWorkflow` is called on card creation so embeddings and links are generated

**Key APIs:** `useSearch`, `useRelatedNotes`, `useNote`, `enqueueFullWorkflow`, `useFortemiContext`

---

### 3. Writing Prompt Engine

**Type:** Application
**File:** `apps/standalone/src/examples/WritingPrompts.tsx`
**Tag:** `app:prompts`
**Seed data:** 8 fiction writing prompts across multiple genres

This example demonstrates semantic search as a discovery interface. Instead of searching for a specific phrase, the user types a mood or theme (for example, "ocean mystery" or "someone who disappears") and the search engine returns prompts that match by meaning rather than keyword overlap. The data layer is the application — there is no other logic driving the discovery experience.

Tag facets serve as genre filters. Prompt cards are collapsed by default and expand on click, which is a useful pattern for browsing content-heavy results.

**Features demonstrated:**
- Semantic search for creative discovery — meaning-based matching, not keyword matching
- Tag facets as genre filters — `include_facets: true` surfaces genre tags as clickable chips
- Expandable result cards — click to reveal full prompt text
- Full workflow for embedding — `enqueueFullWorkflow` is called on add so new prompts are immediately searchable by meaning

**Key APIs:** `useSearch`, `useCreateNote`, `useNotes`, `enqueueFullWorkflow`

---

### 4. Personal Journal

**Type:** Record keeper
**File:** `apps/standalone/src/examples/JournalApp.tsx`
**Tag:** `app:journal`
**Seed data:** 4 reflective journal entries

This example demonstrates the job queue pipeline end to end. When you write an entry and save it, the job queue runs in the background to generate a title and an AI revision. Clicking an entry in the list expands a side-by-side panel showing the original content alongside the AI-revised version, along with generation metadata (generation count, model used, whether the note has been user-edited).

The search input demonstrates vocabulary-based autocomplete via `useSearchSuggestions`, which draws on prior search history to surface suggestions as the user types.

**Features demonstrated:**
- Job queue pipeline — title generation (priority 2) and AI revision (priority 8) run automatically after save
- Side-by-side original vs. AI-revised content — uses `note.original.content` and `note.current.content`
- Revision history — `NotesRepository.getRevisions` retrieves all past revisions for a note
- Search suggestions with vocabulary autocomplete — `useSearchSuggestions` derives suggestions from `useSearchHistory`

**Key APIs:** `useCreateNote`, `useNotes`, `useSearch`, `useSearchHistory`, `useSearchSuggestions`, `useNote`, `NotesRepository.getRevisions`

---

## Building Your Own Application

### When to use fortemi

Fortemi is well suited to web applications that need one or more of the following:

- **Structured data with full-text search** — PostgreSQL's `tsvector`/`tsquery` runs in-browser via PGlite
- **Semantic and AI features without a server** — embeddings, LLM revision, and concept extraction all run locally
- **Offline-first persistence** — data persists locally in Chrome (OPFS), Firefox (IndexedDB), or in-memory for Safari
- **Multi-view data** — the same database can serve multiple application views simultaneously via tag scoping
- **Rich metadata** — tags, collections, SKOS concepts, provenance tracking, and revision history are built in

### Use case ideas

| Application | How it uses fortemi | Key APIs |
|-------------|---------------------|----------|
| **Personal CRM** | Store contacts and interactions as notes; search by relationship context | `useSearch`, `useRelatedNotes`, tags for categories |
| **Recipe manager** | Notes as recipes; semantic search finds similar dishes; SKOS concepts for cuisine types | `useSearch` (hybrid), `useNoteConcepts`, collections |
| **Meeting notes** | Capture meeting notes; AI generates summaries; link related meetings | `useCreateNote`, job queue, `useRelatedNotes` |
| **Bookmark manager** | Store URLs with descriptions; semantic search finds related bookmarks | `useSearch` (semantic), tags, faceted results |
| **Learning tracker** | Track lessons learned; AI extracts concepts; link related learnings | `enqueueFullWorkflow`, `useNoteConcepts`, `useRelatedNotes` |
| **Product feedback** | Collect user feedback; search by theme; tag by feature area | `useSearch`, `include_facets`, tag filtering |

### Best practices

1. **Use `app:*` tags for scoping** — keeps your app's data isolated without database partitioning.
2. **Run the full workflow on create** — `enqueueFullWorkflow(db, noteId)` triggers embeddings, concept extraction, title generation, and semantic linking in the background. Notes created without it will not appear in semantic search or the related-notes panel until the workflow runs.
3. **Enable capabilities on startup** — store user preferences in `localStorage` and re-enable them on return visits so users do not have to re-download models each session.
4. **Use faceted search** — `include_facets: true` returns tag and collection counts alongside results, enabling filter UIs without a separate query.
5. **Leverage semantic search** — let users search by meaning. Keyword search requires the user to remember exact terms; semantic search does not.
6. **Show provenance** — use `useNoteProvenance` to display the AI processing trail. Users often want to know whether content was generated or revised by the model.
7. **Display related notes** — `useRelatedNotes` turns any detail view into a discovery experience with no additional application logic.
8. **React to job completion** — hooks automatically re-render when relevant jobs complete. The UI stays current without polling.

### Minimal app template

The following is a self-contained component that creates scoped notes and searches them. It is a starting point, not a production template.

```typescript
import { useState, useCallback } from 'react'
import { enqueueFullWorkflow } from '@fortemi/core'
import { useCreateNote, useSearch, useNotes, useJobQueue, useFortemiContext } from '@fortemi/react'

const APP_TAG = 'app:myapp'

export function MyApp() {
  useJobQueue(2000) // Start the job queue worker (polls every 2 seconds)
  const { db } = useFortemiContext()
  const { createNote } = useCreateNote()
  const { data: searchData, search, clear } = useSearch()
  const { data: notes } = useNotes({ tags: [APP_TAG] })
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  const handleCreate = async () => {
    if (!input.trim()) return
    const note = await createNote({ content: input, tags: [APP_TAG] })
    await enqueueFullWorkflow(db, note.id) // AI revision → title → embedding → concepts → linking
    setInput('')
  }

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q)
    if (q.trim()) await search(q, { tags: [APP_TAG] })
    else clear()
  }, [search, clear])

  const items = query.trim() ? searchData?.results : notes?.items

  return (
    <div>
      {/* Create */}
      <textarea value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={handleCreate}>Add</button>

      {/* Search */}
      <input value={query} onChange={e => handleSearch(e.target.value)} placeholder="Search..." />

      {/* Display */}
      {items?.map((item: { id: string; title: string | null }) => (
        <div key={item.id}>{item.title ?? 'Untitled'}</div>
      ))}
    </div>
  )
}
```

---

## Capability Auto-Enable

The standalone app persists capability preferences in `localStorage` under `fortemi:enabled-capabilities`. On a first visit, both semantic (embeddings) and LLM capabilities are enabled by default. The LLM model selection is persisted separately under `fortemi:llm-model`.

To replicate this pattern in your own app:

```typescript
// On startup — re-enable capabilities from the previous session
const caps = JSON.parse(localStorage.getItem('my-app:caps') ?? '["semantic"]')
for (const cap of caps) {
  capabilityManager.enable(cap)
}

// After a capability toggle — persist the new state
capabilityManager.enable('semantic')
const enabled = capabilityManager.listAll().filter(c => c.state === 'ready').map(c => c.name)
localStorage.setItem('my-app:caps', JSON.stringify(enabled))
```

The `semantic` capability loads `Xenova/all-MiniLM-L6-v2` via transformers.js (WASM, works in all browsers). The `llm` capability loads a quantized model via WebLLM and requires WebGPU. On Linux, Chrome needs the `--enable-unsafe-webgpu` flag for WebGPU to be available.

---

## Dark Mode

The standalone app includes a light/dark mode toggle (moon/sun icon in the header). It applies `filter: invert(1) hue-rotate(180deg)` to the app container — a zero-configuration approach that inverts all colors without modifying any component styles. The preference is persisted in `localStorage` under `fortemi:theme`.
