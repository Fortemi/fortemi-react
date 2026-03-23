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
          <small>Rank: {result.rank.toFixed(3)} | Tags: {result.tags.join(', ')}</small>
        </div>
      ))}
      <p>{data?.total ?? 0} results</p>
    </div>
  )
}
```

### Text Search with Filters

```typescript
await search('machine learning', {
  tags: ['ai', 'research'],        // filter by tags (ANY match)
  collection_id: 'col-uuid-here',  // filter by collection
  limit: 10,                       // results per page (default: 20, max: 100)
  offset: 0,                       // pagination offset
})
```

### Semantic Search (Direct Repository)

The `useSearch` hook currently exposes text search only. For semantic and hybrid search, use the `SearchRepository` directly:

```typescript
import { SearchRepository, getEmbedFunction } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

function SemanticSearch() {
  const { db, capabilityManager } = useFortemiContext()

  const handleSearch = async (query: string) => {
    const embedFn = getEmbedFunction()
    if (!embedFn || !capabilityManager.isReady('semantic')) {
      // Fall back to text search
      const repo = new SearchRepository(db, false)
      return repo.search(query)
    }

    // Generate embedding for the search query
    const [queryEmbedding] = await embedFn([query])

    const repo = new SearchRepository(db, true)
    // Pure semantic search (no text query, just vector similarity)
    return repo.semanticSearch(queryEmbedding, { limit: 20 })
  }
}
```

### Hybrid Search (BM25 + Vector RRF)

Hybrid search combines both text and vector signals using Reciprocal Rank Fusion:

```typescript
const embedFn = getEmbedFunction()
const [queryEmbedding] = await embedFn([query])

const repo = new SearchRepository(db, true)
// Both query text AND embedding provided = hybrid mode
const results = await repo.search(query, { limit: 20 }, queryEmbedding)
```

The routing logic inside `SearchRepository.search()`:
- Query text + embedding provided = **hybrid** (RRF fusion)
- Embedding only (empty query) = **semantic** (vector cosine)
- Query text only = **text** (BM25 tsvector)
- Empty query, no embedding = **recent notes** (ordered by created_at DESC)

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
})
```

Note: The `searchTool` function currently only supports `mode: 'text'`. Semantic and hybrid modes through the tool interface are planned. Use `SearchRepository` directly for semantic/hybrid search.

## Search Response Format

All search modes return the same `SearchResponse` shape, matching the fortemi server format:

```typescript
interface SearchResponse {
  results: SearchResult[]
  total: number          // total matching results (before pagination)
  query: string          // echo of the search query
  mode: 'text'           // search mode used
  semantic_available: boolean  // true if semantic capability is loaded
  limit: number
  offset: number
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

User input is parsed with `plainto_tsquery('english', query)` which:
- Applies English stemming (e.g., "running" matches "run")
- Removes English stop words
- Treats all terms as AND (all must match)
- Handles special characters safely (no injection risk)

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
| `collection_id` | `string` | Text mode | Notes must belong to this collection |
| `limit` | `number` | All modes | Results per page (1-100, default: 20) |
| `offset` | `number` | All modes | Pagination offset (default: 0) |

### Not Yet Implemented

The following filters exist in the fortemi server but are not yet available in fortemi-react search:

| Filter | Server Behavior | Status |
|--------|----------------|--------|
| `date_from` / `date_to` | Filter by creation date range | Not implemented |
| `is_starred` | Only starred notes | Available on `NoteListOptions` but not `SearchOptions` |
| `is_archived` | Include archived notes | Available on `NoteListOptions` but not `SearchOptions` |
| `sort` | Sort results by field | Text mode uses rank; no override |
| `format` | Filter by note format (markdown, plain, etc.) | Not implemented |
| `source` | Filter by note source (manual, mcp, import) | Not implemented |
| `visibility` | Filter by visibility level | Not implemented |
| `collection_id` on semantic/hybrid | Collection filter on vector search | Text mode only currently |

See the [fortemi server repository](https://git.integrolabs.net/Fortemi/fortemi) for the full search specification. The server's `SearchOptions` type in `src/search/types.rs` is the canonical reference for all filter parameters.

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

The `SearchResponse.mode` field is currently always `'text'` regardless of the actual search mode used. This is a known divergence from the server which returns the actual mode. The `semantic_available` boolean correctly indicates whether the semantic capability is loaded.

## Differences from fortemi Server

| Feature | Server | fortemi-react | Notes |
|---------|--------|--------------|-------|
| Text search (BM25) | Full | Full | Identical tsvector/tsquery implementation |
| Semantic search (cosine) | Full | Full | Same pgvector HNSW, same distance metric |
| Hybrid search (RRF k=60) | Full | Full | Same algorithm and k constant |
| Search filters | 10+ filters | 4 filters | tags, collection_id, limit, offset implemented; date range, starred, format, source pending |
| Response.mode field | Reflects actual mode | Always 'text' | Known divergence |
| Phrase search | `phraseto_tsquery` | `plainto_tsquery` only | Phrase search not implemented |
| Search suggestions | Autocomplete from tsvector | Not implemented | |
| Search history | Stored in DB | Not implemented | |
| Faceted results | Tag/collection counts | Not implemented | |

For the complete server search specification, see:
- **Search types**: `fortemi/src/search/types.rs`
- **Search service**: `fortemi/src/search/service.rs`
- **Filter definitions**: `fortemi/src/search/filters.rs`
