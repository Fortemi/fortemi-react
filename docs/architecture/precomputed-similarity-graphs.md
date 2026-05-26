# Precomputed Similarity Graphs

Status: proposed for #138 review
Depends on: #132, #134, #135

This document defines the planning contract for cached and precomputed
similarity graphs over physical or virtual embedding sets. It does not
implement runtime caching. Future construction should preserve Fortemi server
capability parity unless an intentional divergence is recorded.

## Goals

- Avoid recomputing kNN/topic edges on every graph load for large corpora.
- Reuse the same graph output shape as live `buildSimilarityGraph()`.
- Support physical, filter, and virtual embedding-set selectors.
- Make stale cached graphs explicit and refreshable.
- Feed precomputed edges into the #129 community graph APIs.
- Round-trip durable cached graph artifacts through #135 shard files when
  explicitly exported.

## Public Option Names

`minSimilarity` is canonical. `threshold` should be accepted as a compatibility
alias at API boundaries and normalized before cache keys are computed.

```ts
export interface SimilarityGraphRequest {
  selector: EmbeddingSetSelector
  k?: number
  minSimilarity?: number
  threshold?: number
  metric?: 'cosine' | 'inner_product' | 'l2'
  source?: 'cache-preferred' | 'live-only' | 'cache-only'
}
```

Normalization:

- if both `minSimilarity` and `threshold` are present and differ, reject with
  `conflicting-threshold`;
- otherwise set `minSimilarity = minSimilarity ?? threshold ?? -1`;
- serialize only `minSimilarity` into cache keys and shard artifacts.

## Cache Key Inputs

```ts
export interface SimilarityGraphCacheKey {
  selectorHash: string
  resolvedEmbeddingSetId?: string
  virtualSetId?: string
  k: number
  minSimilarity: number
  metric: 'cosine' | 'inner_product' | 'l2'
  model: string
  dimension: number
  truncateDimension?: number | null
  memberHash: string
  vectorHash: string
  parameterHash: string
}
```

The cache key must change when any of these change:

- selector definition;
- physical embedding set membership;
- virtual set resolved membership;
- embedding vectors;
- model, dimension, or truncation metadata;
- `k`, `minSimilarity`, metric, or algorithm version.

## Repository Behavior

```ts
export interface SimilarityGraphRepository {
  getCachedSimilarityGraph(request: SimilarityGraphRequest): Promise<CachedSimilarityGraph | null>
  buildSimilarityGraphLive(request: SimilarityGraphRequest): Promise<CommunityGraph>
  buildOrLoadSimilarityGraph(request: SimilarityGraphRequest): Promise<SimilarityGraphResult>
  saveSimilarityGraphArtifact(result: SimilarityGraphResult): Promise<void>
  markSimilarityGraphStale(graphSourceId: string, reason: string): Promise<void>
}

export interface SimilarityGraphResult {
  graph: CommunityGraph
  graphSource: ShardGraphSourceLike
  cache: 'hit' | 'miss-live-built' | 'stale-live-built' | 'live-only'
  freshness: 'fresh' | 'stale' | 'unknown'
}
```

Default behavior should be `cache-preferred`:

1. Resolve the embedding-set selector.
2. Normalize options and compute cache key.
3. Return a fresh cached graph when one exists.
4. If no cache exists, compute live and optionally persist the artifact.
5. If cache exists but is stale, compute live unless `source: 'cache-only'`.
6. If `source: 'live-only'`, bypass cache read/write.

`cache-only` should return a typed cache-miss/stale error instead of silently
falling back to live compute.

## React Hook Behavior

```ts
export interface UseSimilarityGraphOptions extends SimilarityGraphRequest {
  autoRefresh?: boolean
  persistComputedGraph?: boolean
}

export interface UseSimilarityGraphResult {
  graph: CommunityGraph | null
  graphSource?: ShardGraphSourceLike
  loading: boolean
  error: Error | null
  cache: 'hit' | 'miss-live-built' | 'stale-live-built' | 'live-only' | null
  freshness: 'fresh' | 'stale' | 'unknown' | null
  refresh(): Promise<SimilarityGraphResult | null>
  recompute(): Promise<SimilarityGraphResult | null>
  markStale(reason: string): Promise<void>
}
```

Hooks should expose cache/freshness state so UI can show whether a topical graph
is precomputed, live-computed, stale, or unavailable. `recompute()` should force
live rebuild and artifact replacement when persistence is enabled.

## Shard Mapping

Persisted similarity graphs should use #135 components:

- `graph_sources.json`: one source descriptor per cached graph;
- `graph_edges.jsonl`: edge rows keyed by `graph_source_id`;
- `communities.json`: optional precomputed community metadata over the graph;
- `community_assignments.jsonl`: optional node assignments.

`graph_sources.parameters` should include normalized `k`, `minSimilarity`,
metric, algorithm version, selector hash, and source kind. Do not serialize
`threshold` except as raw provenance metadata if imported from a legacy source.

## Community Composition

Precomputed similarity edges feed #129 by returning the same `CommunityGraph`
shape as live graph generation. Community APIs should be able to:

- detect communities live over cached edges;
- load precomputed community assignments for the same graph source;
- prefer fresh precomputed assignments when available;
- fall back to deterministic local community detection when assignments are
  stale, missing, or unsupported.

## Invalidation Rules

Mark a cached similarity graph stale when:

- embedding rows for the selected physical set change;
- embedding-set membership changes;
- virtual set definition changes;
- materialized virtual membership snapshot changes;
- model/dimension/truncation metadata changes;
- graph parameters change;
- graph algorithm version changes.

Stale graphs may remain inspectable, but default graph loading should recompute
when possible. Imported graphs with unvalidated hashes should start as
`unknown`, not `fresh`.

## Ownership

- Local PGlite can own small/medium graph cache artifacts for offline use.
- Fortemi server can own large graph precompute jobs, diagnostics, and refresh
  scheduling.
- Knowledge Shards can carry graph artifacts when explicitly included.
- Runtime UI layout state remains outside the graph cache unless separately
  saved by the user.

## Test Scenarios for Construction

- cache miss computes live graph and returns `miss-live-built`;
- fresh cache hit returns graph without live kNN queries;
- stale cache returns `stale-live-built` when live fallback is allowed;
- `cache-only` rejects stale or missing graphs without live fallback;
- `live-only` bypasses cache read and write;
- `threshold` is accepted as alias and normalized to `minSimilarity`;
- conflicting `threshold` and `minSimilarity` values reject;
- virtual selector cache key changes when definition changes;
- membership/vector/model/parameter changes mark graph stale;
- exported cached graph imports through #135 graph source and edge files;
- cached edges compose with community detection and precomputed assignments.

## Follow-Up Construction

- #132 should accept `threshold` as an alias for `minSimilarity`.
- #134 selector definitions should drive cache key normalization.
- #135 shard artifacts should store persisted cached graph edges.
- #129 should consume cached similarity edges as an arbitrary graph source.
