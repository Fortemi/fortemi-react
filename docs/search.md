# Search

fortemi-react provides three search modes that mirror the fortemi server's search subsystem: full-text search (BM25), semantic vector search (pgvector cosine), and hybrid search (RRF fusion). All modes run entirely in-browser via PGlite.

## Search Modes

| Mode | How It Works | Requires | Status |
|------|-------------|----------|--------|
| **text** | PostgreSQL `tsvector`/`tsquery` with BM25 ranking | Nothing (default) | Fully implemented |
| **semantic** | pgvector HNSW cosine distance on note embeddings | Semantic capability enabled, embeddings generated | Implemented |
| **hybrid** | BM25 + vector combined via Reciprocal Rank Fusion (k=60) | Semantic capability + embeddings | Implemented |

## Quick Start

### Text Search (React Hook)

The `useSearch` hook automatically dispatches to text, semantic, or hybrid search based on whether the semantic capability is ready:

```typescript
import { useSearch } from '@fortemi/react'

function SearchPage() {
  const { data, loading, search, clear } = useSearch()

  const handleSearch = async (query: string) => {
    if (query.trim()) {
      await search(query)
    } else {
      clear()
    }
  }

  return (
    <div>
      <input onChange={(e) => handleSearch(e.target.value)} placeholder="Search notes..." />
      {loading && <p>Searching...</p>}
      {data?.results.map((result) => (
        <div key={result.id}>
          <h3>{result.title ?? 'Untitled'}</h3>
          <p dangerouslySetInnerHTML={{ __html: result.snippet }} />
          <small>
            Mode: {data.mode} | Rank: {result.rank.toFixed(3)} | Tags: {result.tags.join(', ')}
          </small>
        </div>
      ))}
      <p>{data?.total ?? 0} results (mode: {data?.mode})</p>
    </div>
  )
}
```

When semantic capability is enabled, `useSearch` automatically:
1. Checks `capabilityManager.isReady('semantic')`
2. Calls `getEmbedFunction()` to generate a query embedding
3. Passes the embedding to `SearchRepository.search()`, which dispatches to hybrid (if query text present) or semantic (if query empty)

When semantic is not enabled, only text search is used.

### Search with Filters

```typescript
await search('machine learning', {
  tags: ['ai', 'research'],        // filter by tags (ANY match)
  collection_id: 'col-uuid-here',  // filter by collection
  date_from: new Date('2026-01-01'), // filter by creation date range
  date_to: new Date('2026-03-31'),
  is_starred: true,                 // only starred notes
  is_archived: false,               // exclude archived notes
  format: 'markdown',               // filter by note format
  source: 'user',                   // filter by note source
  visibility: 'private',            // filter by visibility level
  limit: 10,                        // results per page (default: 20, max: 100)
  offset: 0,                        // pagination offset
  include_facets: true,             // include tag/collection aggregate counts
})
```

### Phrase Search

Wrap terms in double quotes for exact phrase matching:

```typescript
await search('"machine learning"')  // Uses phraseto_tsquery — matches exact phrase
await search('machine learning')    // Uses plainto_tsquery — matches both words (AND)
```

Phrase search is detected automatically when the query contains `"` characters.

### Search History and Autocomplete

```typescript
import { useSearchHistory, useSearchSuggestions } from '@fortemi/react'

function SearchWithSuggestions() {
  const { history, addEntry, clearHistory } = useSearchHistory()
  const { suggestions, getSuggestions, clearSuggestions } = useSearchSuggestions(history)

  const handleInput = (value: string) => {
    getSuggestions(value) // Get prefix-matched suggestions
  }

  const handleSearch = (query: string) => {
    addEntry(query) // Save to history
    clearSuggestions()
    // ... execute search
  }

  return (
    <div>
      <input onChange={(e) => handleInput(e.target.value)} />
      {suggestions.map((s) => (
        <div key={s.text} onClick={() => handleSearch(s.text)}>
          {s.text} <small>({s.source})</small>
        </div>
      ))}
    </div>
  )
}
```

`useSearchHistory` persists to localStorage (survives archive switches). `useSearchSuggestions` loads vocabulary from `ts_stat` on mount and merges with history for prefix-matched suggestions.

### Faceted Results

When `include_facets: true` is passed, the response includes aggregate counts:

```typescript
const result = await search('machine learning', { include_facets: true })

console.log(result.facets)
// {
//   tags: [{ tag: 'ai', count: 15 }, { tag: 'research', count: 8 }, ...],
//   collections: [{ id: 'col-1', name: 'Papers', count: 12 }, ...]
// }
```

Facets are computed from the full (unpaginated) result set for accurate counts.

### Direct Repository Usage

For fine-grained control, use `SearchRepository` directly:

```typescript
import { SearchRepository, getEmbedFunction } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

function AdvancedSearch() {
  const { db, capabilityManager } = useFortemiContext()

  const handleSearch = async (query: string) => {
    const semanticReady = capabilityManager.isReady('semantic')
    const repo = new SearchRepository(db, semanticReady)

    if (semanticReady) {
      const embedFn = getEmbedFunction()
      if (embedFn) {
        const [queryEmbedding] = await embedFn([query])
        // Hybrid search (text + vector)
        return repo.search(query, { limit: 20 }, queryEmbedding)
      }
    }

    // Text-only search
    return repo.search(query, { limit: 20 })
  }
}
```

### MCP Tool Search

```typescript
import { searchTool } from '@fortemi/core'

// Via tool function (Zod-validated input)
const results = await searchTool(db, {
  query: 'knowledge management',
  mode: 'text',     // 'text' | 'semantic' | 'hybrid'
  limit: 20,
  offset: 0,
  tags: ['research'],
  collection_id: 'optional-id',
  date_from: '2026-01-01',
  is_starred: true,
  include_facets: true,
})
```

Note: The `searchTool` function currently only supports `mode: 'text'`. Semantic and hybrid modes through the tool interface are planned. Use `SearchRepository` directly for semantic/hybrid search.

## Search Response Format

All search modes return the same `SearchResponse` shape, matching the fortemi server format:

```typescript
interface SearchFacets {
  tags: { tag: string; count: number }[]
  collections: { id: string; name: string; count: number }[]
}

interface SearchResponse {
  results: SearchResult[]
  total: number          // total matching results (before pagination)
  query: string          // echo of the search query
  mode: 'text' | 'semantic' | 'hybrid'  // actual search mode used
  semantic_available: boolean  // true if semantic capability is loaded
  limit: number
  offset: number
  facets?: SearchFacets  // present when include_facets: true
}

interface SearchResult {
  id: string             // note UUIDv7
  title: string | null
  snippet: string        // highlighted excerpt (<mark> tags for text mode)
  rank: number           // relevance score (BM25 rank, cosine similarity, or RRF score)
  created_at: Date
  updated_at: Date
  tags: string[]         // note's tags included for display
}
```

## Full-Text Search Details

### Indexing

Notes are indexed using PostgreSQL's built-in tsvector system:

- **Title** — stored as a precomputed `tsv` column on the `note` table (weight A, higher priority)
- **Content** — computed at query time from `note_revised_current.content` (weight B)
- **Language** — English dictionary (`'english'` configuration) for stemming and stop words

### Query Parsing

User input is parsed with `plainto_tsquery('english', query)` (or `phraseto_tsquery` for quoted phrases) which:
- Applies English stemming (e.g., "running" matches "run")
- Removes English stop words
- Treats all terms as AND (all must match)
- Handles special characters safely (no injection risk)
- Quoted phrases use `phraseto_tsquery` for adjacency matching (e.g., `"machine learning"` matches the exact phrase)

### Ranking

Results are ranked by `ts_rank` combining the weighted title and content vectors. Title matches rank higher than content-only matches.

```sql
ts_rank(
  setweight(n.tsv, 'A') ||
  setweight(to_tsvector('english', coalesce(c.content, '')), 'B'),
  plainto_tsquery('english', $1)
)
```

### Snippets

Highlighted snippets are generated by `ts_headline` with these settings:
- `StartSel=<mark>`, `StopSel=</mark>` — HTML highlighting
- `MaxWords=35`, `MinWords=15` — snippet length control

Render snippets with `dangerouslySetInnerHTML` or sanitize the `<mark>` tags.

## Semantic Search Details

### Prerequisites

1. **Enable Semantic capability** in Settings (downloads all-MiniLM-L6-v2, ~23MB)
2. **Generate embeddings** for notes (click "Generate Embedding" on each note, or embeddings auto-queue on note creation when capability is enabled)

### How It Works

1. Note content is chunked via `chunkText()` (overlapping windows)
2. Each chunk is embedded to a 384-dimensional vector via transformers.js
3. Chunk embeddings are averaged and normalized into one vector per note
4. Stored in the `embedding` table with HNSW index for fast cosine search
5. At query time, the search query is embedded with the same model
6. pgvector's `<=>` operator finds nearest neighbors by cosine distance

### Embedding Model

| Property | Value |
|----------|-------|
| Model | `Xenova/all-MiniLM-L6-v2` |
| Dimensions | 384 |
| Download size | ~23 MB |
| Index type | HNSW (via pgvector) |
| Distance metric | Cosine (`<=>` operator) |
| Runtime | transformers.js (WASM, no GPU needed) |

## Hybrid Search Details

### Reciprocal Rank Fusion (RRF)

Hybrid search runs BM25 and vector search independently, then merges results using RRF with k=60:

```
RRF_score(d) = sum( 1 / (k + rank_i(d)) ) for each ranker i
```

Where:
- `k = 60` (standard RRF constant, matching fortemi server)
- `rank_i(d)` is the 0-based position of document d in ranker i's results
- Documents appearing in both rankers get boosted scores
- Top 100 candidates from each ranker before fusion

This produces results that balance keyword precision (BM25) with semantic understanding (vector), without requiring manual weight tuning.

## Filter Options

### Available Filters

| Filter | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `tags` | `string[]` | All modes | Notes must have ANY of the specified tags |
| `collection_id` | `string` | All modes | Notes must belong to this collection |
| `date_from` | `Date` | All modes | Notes created on or after this date |
| `date_to` | `Date` | All modes | Notes created on or before this date |
| `is_starred` | `boolean` | All modes | Filter by starred status |
| `is_archived` | `boolean` | All modes | Filter by archived status |
| `format` | `string` | All modes | Filter by note format (`'markdown'`, `'plain'`, `'html'`) |
| `source` | `string` | All modes | Filter by note source (`'user'`, `'mcp'`, `'import'`, `'api'`) |
| `visibility` | `string` | All modes | Filter by visibility (`'private'`, `'shared'`, `'public'`) |
| `include_facets` | `boolean` | All modes | Include tag/collection aggregate counts (default: false) |
| `limit` | `number` | All modes | Results per page (1-100, default: 20) |
| `offset` | `number` | All modes | Pagination offset (default: 0) |

All filters apply uniformly across text, semantic, and hybrid search modes via the shared `buildNoteConditions()` helper.

### Shared Condition Builder

Filters are generated by a shared `buildNoteConditions()` function used by both `SearchRepository` and `NotesRepository`. This prevents drift between the two repositories and makes adding future filters trivial:

```typescript
import { buildNoteConditions } from '@fortemi/core'

const { conditions, params, nextIdx } = buildNoteConditions(
  { tags: ['ai'], is_starred: true, date_from: new Date('2026-01-01') },
  1, // starting parameter index
)
// conditions: ['n.deleted_at IS NULL', 'EXISTS (...)', 'n.is_starred = $2', 'n.created_at >= $3']
// params: [['ai'], true, Date]
```

## Empty Query Behavior

When the search query is empty or whitespace-only:
- **No embedding provided**: Returns recent notes ordered by `created_at DESC`
- **Embedding provided**: Runs pure semantic search (find notes similar to the embedding vector)

This matches the fortemi server's behavior where an empty search bar shows the most recent notes.

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Text search (10k notes) | < 200ms | GIN index on tsvector |
| Semantic search (10k embeddings) | < 500ms | HNSW index on pgvector |
| Hybrid search (10k notes + embeddings) | < 1s | Two queries + RRF fusion |
| Embedding generation | < 2s per chunk | transformers.js WASM |

These targets match the fortemi server's performance expectations documented in `supplementary-requirements.md` (PERF-003).

## Architecture Notes

### Deleted Notes

All search modes automatically exclude soft-deleted notes (`n.deleted_at IS NULL`). There is no option to search deleted notes — this matches the server behavior.

### Tag Enrichment

Search results include the note's tags in every mode. Tags are fetched in a single batch query after the main search to avoid N+1 queries.

### Mode Field

The `SearchResponse.mode` field correctly reflects the actual search mode used: `'text'`, `'semantic'`, or `'hybrid'`. The `semantic_available` boolean indicates whether the semantic capability is loaded.

## Parity with fortemi Server

| Feature | Server | fortemi-react | Notes |
|---------|--------|--------------|-------|
| Text search (BM25) | Full | Full | Identical tsvector/tsquery implementation |
| Semantic search (cosine) | Full | Full | Same pgvector HNSW, same distance metric |
| Hybrid search (RRF k=60) | Full | Full | Same algorithm and k constant |
| Search filters | 10+ filters | 12 filters | tags, collection_id, date_from, date_to, is_starred, is_archived, format, source, visibility, include_facets, limit, offset |
| Response.mode field | Reflects actual mode | Reflects actual mode | Full parity |
| Phrase search | `phraseto_tsquery` | `phraseto_tsquery` | Full parity — triggered by quoted input |
| Search suggestions | Autocomplete from tsvector | `useSearchSuggestions` hook | Client-side prefix matching from `ts_stat` vocabulary |
| Search history | Stored in DB | `useSearchHistory` hook | localStorage (survives archive switches) |
| Faceted results | Tag/collection counts | `include_facets` option | Top 20 tags and collections by count |

For the complete server search specification, see:
- **Search types**: `fortemi/src/search/types.rs`
- **Search service**: `fortemi/src/search/service.rs`
- **Filter definitions**: `fortemi/src/search/filters.rs`
