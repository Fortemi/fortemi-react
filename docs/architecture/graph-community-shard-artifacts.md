# Graph and Community Shard Artifacts

Status: proposed for #135 review
Depends on: #129, #132, #133, #134

This document defines the planning contract for persisted graph and community
artifacts in Knowledge Shards. It does not implement import/export behavior.
Future construction should preserve Fortemi server capability parity unless an
intentional divergence is recorded.

## Goals

- Preserve stable precomputed graph edges and community assignments for offline
  clients.
- Keep graph artifacts inspectable, streamable, and independently validated.
- Separate persisted derived artifacts from runtime-only dynamic UI state.
- Carry enough provenance to detect stale graph/community data after import.
- Support citation/link graphs and embedding-set similarity/topic graphs.

## Shard Components

Use graph-specific files rather than one opaque derived-artifact bucket.

| File | Format | Purpose |
| --- | --- | --- |
| `graph_sources.json` | JSON array | Graph source descriptors and provenance |
| `graph_edges.jsonl` | JSONL | Persisted edge rows for source graphs |
| `communities.json` | JSON array | Community-set and community metadata |
| `community_assignments.jsonl` | JSONL | Node-to-community assignment rows |

All four files are optional. Importers must ignore unknown components and
continue importing primary notes, links, embeddings, and embedding sets.

## `graph_sources.json`

```ts
export interface ShardGraphSource {
  id: string
  name: string
  kind: 'link' | 'similarity' | 'search' | 'manual' | 'imported'
  source_table?: 'link' | 'embedding' | 'manual'
  embedding_set_id?: string | null
  virtual_set_id?: string | null
  model?: string | null
  dimension?: number | null
  truncate_dimension?: number | null
  metric?: 'cosine' | 'inner_product' | 'l2' | null
  algorithm?: string | null
  parameters?: Record<string, unknown>
  input_hash: string
  freshness: ShardArtifactFreshness
  created_at: string
}
```

Example:

```json
{
  "id": "graph-topic-ai-summary-k10",
  "name": "AI summary topics k=10",
  "kind": "similarity",
  "source_table": "embedding",
  "embedding_set_id": "emb-ai-summary",
  "virtual_set_id": null,
  "model": "all-MiniLM-L6-v2",
  "dimension": 384,
  "metric": "cosine",
  "algorithm": "knn",
  "parameters": { "k": 10, "minSimilarity": 0.72 },
  "input_hash": "sha256:...",
  "freshness": { "status": "fresh", "checked_at": "2026-05-26T00:00:00Z" },
  "created_at": "2026-05-26T00:00:00Z"
}
```

## `graph_edges.jsonl`

```ts
export interface ShardGraphEdge {
  graph_source_id: string
  from_note_id: string
  to_note_id: string
  weight: number
  kind: 'link' | 'similarity' | 'manual'
  rank?: number | null
  metadata?: Record<string, unknown>
}
```

Rules:

- `from_note_id` and `to_note_id` use shard note IDs.
- Similarity edges should be undirected and stored once using deterministic
  lexical note ordering.
- `rank` records kNN neighbor rank when available.
- `metadata` may carry source link ID, distance, original score, or server
  provenance.

## `communities.json`

```ts
export interface ShardCommunitySet {
  id: string
  graph_source_id: string
  name: string
  source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
  algorithm?: string | null
  parameters?: Record<string, unknown>
  input_hash: string
  freshness: ShardArtifactFreshness
  communities: ShardCommunity[]
  created_at: string
}

export interface ShardCommunity {
  id: string
  label?: string | null
  rank?: number | null
  size?: number | null
  confidence?: number | null
  representative_note_ids?: string[]
  metadata?: Record<string, unknown>
}
```

`communities.json` stores community metadata, not every membership row. Membership
belongs in `community_assignments.jsonl`.

## `community_assignments.jsonl`

```ts
export interface ShardCommunityAssignment {
  community_set_id: string
  community_id: string
  note_id: string
  confidence?: number | null
  source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
  metadata?: Record<string, unknown>
}
```

Rules:

- Multiple community sets may assign the same note differently.
- User-authored assignments are first-class user data and must not be
  invalidated by graph recompute.
- Dynamic communities are exported only when explicitly saved as
  `dynamic-snapshot`.

## Freshness Metadata

```ts
export interface ShardArtifactFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  checked_at?: string
  stale_reason?: string
  source_hashes?: {
    notes?: string
    links?: string
    embeddings?: string
    embedding_set_members?: string
    virtual_set_definition?: string
    parameters?: string
  }
}
```

Freshness is `unknown` after import unless the importer can recompute and match
the relevant source hashes. A reader should mark artifacts stale when any of
these change:

- link rows for link-derived graphs;
- embedding vectors for similarity graphs;
- embedding-set membership;
- virtual embedding-set definitions;
- graph parameters such as `k`, `minSimilarity`, metric, or truncation;
- community algorithm or parameters.

## Manifest Entries and Counts

`manifest.json` should list each file with checksums and counts:

```ts
export interface ShardManifestCounts {
  graph_sources?: number
  graph_edges?: number
  community_sets?: number
  communities?: number
  community_assignments?: number
}
```

Recommended manifest component names:

- `graph_sources`
- `graph_edges`
- `communities`
- `community_assignments`

Counts should mean:

- `graph_sources`: number of source descriptors;
- `graph_edges`: number of JSONL edge rows;
- `community_sets`: number of community-set objects in `communities.json`;
- `communities`: total nested community metadata rows;
- `community_assignments`: number of JSONL assignment rows.

## Conflict Behavior

Import should key artifacts by stable IDs:

- `graph_sources.id`
- `community_sets.id`
- `(community_set_id, note_id)` for assignments
- `(graph_source_id, from_note_id, to_note_id, kind)` for edges

Recommended conflict policies:

- `skip`: keep existing artifact and report skipped rows;
- `replace`: replace the full graph source or community set atomically;
- `keep-newer`: prefer the artifact with later `created_at`;
- `rename`: import with a generated ID suffix when both artifacts should
  coexist.

Partial replacement is discouraged for graph/community artifacts because stale
edges or assignments can silently corrupt rendered communities.

## Runtime-Only vs Persisted

Persisted artifacts:

- precomputed citation/link graph edges;
- precomputed similarity graph edges;
- precomputed community snapshots;
- explicitly saved dynamic community snapshots;
- user-authored communities.

Runtime-only state:

- active UI graph mode;
- transient search result communities;
- unsaved layout positions;
- hover/selection state;
- temporary force-layout simulation state;
- in-progress graph exploration state.

Runtime-only state should not be written to Knowledge Shards unless the user
explicitly saves it as a durable community, graph, or snapshot.

## Downgrade Compatibility

Older readers should ignore unknown graph/community files. Newer readers should
preserve unsupported graph source kinds or community algorithms as unresolved
metadata rather than dropping them during a round trip.

If a graph references notes, embeddings, or embedding sets not present in the
same archive, import should mark the artifact `stale` or `unknown` and report a
non-fatal warning.

## Test Scenarios for Construction

- exports and imports all four graph artifact files with manifest counts;
- round-trips a link graph source and community assignments;
- round-trips a similarity graph source with embedding-set metadata;
- marks imported artifacts `unknown` when source hashes cannot be validated;
- marks artifacts `stale` after link, embedding, membership, or parameter
  changes;
- keeps user-authored communities valid across graph recompute;
- ignores unsupported graph source kinds without failing shard import;
- rejects partial replacement when edge or assignment rows conflict under
  atomic replacement policy;
- preserves unresolved metadata during export after import.

## Follow-Up Construction

- #138 should write cached similarity edges through `graph_sources.json` and
  `graph_edges.jsonl`.
- #136 should write saved dynamic and user-authored communities through
  `communities.json` and `community_assignments.jsonl`.
- #129 should consume imported community sets without recomputing when a fresh
  compatible artifact exists.
