# Phase 0: Embedding and Graph Ownership

Status: approved
Tracker: #133

This note records the approved Phase 0 ownership proposal for Fortemi React graph,
community, embedding-set, and Knowledge Shard work. It is a planning record for downstream construction; implementation issues should preserve the Fortemi capability/functionality parity constraint approved on #133.

## Goals

- Keep new feature designs in parity with Fortemi server capability and functionality unless an intentional divergence is recorded.

- Preserve `fortemi-react` as the browser/offline-first implementation over
  local PGlite and Knowledge Shards.
- Keep Fortemi server as the hosted orchestration layer for long-running graph
  and embedding jobs.
- Keep React APIs stable across local-only and server-backed runtimes.
- Use HotM as interaction evidence, but align data semantics with the richer
  Fortemi server model where compatibility or lifecycle behavior matters.

## Ownership Boundary

| Concern | Canonical owner | fortemi-react responsibility | Server-backed responsibility |
| --- | --- | --- | --- |
| Physical embedding sets | Shared contract, server model as reference | Store/query local set metadata, create local sets, scope local search/graph, shard-round-trip offline metadata | Create/manage full/filter sets, queue embedding jobs, track vector lifecycle |
| Virtual embedding sets | Shared contract | Represent inspectable definitions, resolve simple local criteria, pass advanced definitions to adapters | Resolve criteria requiring server indexes, access controls, or background computation |
| Embeddings | Runtime-specific storage | Store local vectors scoped by `embedding_set_id`; export/import when included | Store vectors per physical set; handle model/config/truncation changes and refresh jobs |
| Search scoping | Shared API contract | Apply selected physical/filter/virtual set locally when data is present | Resolve set IDs/slugs/criteria before server search |
| Live similarity graph | `@fortemi/core` local algorithm, shared output shape | Build kNN/threshold graphs from local embeddings for interactive/offline workflows | Serve equivalent graph from server data or compute on demand |
| Precomputed similarity graph | Derived artifact contract | Read/write cached graph artifacts and fall back to live compute | Produce/cache large graph artifacts and expose freshness metadata |
| Dynamic communities | Shared output shape, runtime-specific compute | Compute lightweight dynamic/search-derived communities locally when feasible | Compute heavier Louvain/coarse/MRL communities and return node community metadata |
| Precomputed community snapshots | Derived artifact contract | Store/import/export snapshots and expose selected snapshots to React APIs | Produce snapshots, maintenance jobs, diagnostics, and invalidation data |
| User-authored communities | Local-first user data | Persist manual communities and shard-round-trip them | Sync/persist manual communities in hosted mode |
| Graph UI source control | `@fortemi/react` public API | Provide hooks/state contracts for source switching and community selection | Adapter supplies the same contract from server payloads |

## Vocabulary

- Physical embedding set: a materialized vector space with concrete vectors for
  notes. It carries model, dimension, config, and membership metadata.
- Filter embedding set: a named criteria or membership view over existing
  embeddings rather than a separate vector collection.
- Virtual embedding set: a client/server-resolvable set selector definition
  that may not be persisted as a physical vector collection.
- Embedding set selector: the API input accepted by search and graph APIs. It
  can identify a physical set, filter set, virtual definition, or default
  behavior.
- Graph source: the declared origin of graph edges, such as citation links,
  similarity graph, search/dynamic graph, precomputed graph artifact, or shard
  import.
- Similarity graph: a graph derived from embedding distances or similarities
  using explicit parameters such as `k`, `minSimilarity`, embedding set
  selector, model/dimension, and algorithm metadata.
- Community assignment: a node-to-community mapping with label, confidence,
  source, and provenance metadata. Multiple assignments can coexist over the
  same graph.
- Dynamic community: a community assignment computed from current filters,
  search, selection, or interactive graph state. It can remain runtime-only
  unless explicitly saved.
- Precomputed community snapshot: a persisted community assignment artifact
  with algorithm, parameters, source graph, input hash, and freshness metadata.
- User-authored community: a manual or semi-manual user grouping. It is user
  intent, not recomputable derived output.
- Derived graph artifact: persisted graph or community output derived from
  primary notes, links, embeddings, or parameters. It must carry enough
  provenance to detect staleness.

## Recommended Decisions

1. Use `minSimilarity` as the canonical similarity cutoff and accept
   `threshold` as an API-boundary compatibility alias.
2. Export virtual embedding sets by definition. Export resolved membership
   snapshots only when explicitly materialized, with freshness metadata.
3. Use graph-specific shard files for graph artifacts:
   `graph_sources.json`, `graph_edges.jsonl`, `community_assignments.jsonl`,
   and `communities.json`.
4. Model user-authored communities as first-class user data that can project
   into graph/community assignment APIs. They should not be invalidated by graph
   recomputation.
5. Require offline-compatible embedding-set fields needed to inspect, select,
   search, graph, and shard-round-trip sets. Keep hosted-only lifecycle details
   optional unless they affect compatibility or reproducibility.

## Required Offline Fields

Embedding set metadata required for offline compatibility:

- `id`
- `name`
- `purpose` or description
- `set_type`
- `mode`, where applicable
- `model`
- `dimension`
- `criteria`, when criteria-driven
- explicit or materialized membership rows, when applicable
- `created_at` and `updated_at`, when available

When vectors are included, the shard must also preserve:

- vector rows scoped by `embedding_set_id`
- model/dimension compatibility metadata
- truncation or MRL dimension actually used for stored vectors, when applicable

Hosted-only optional fields include job IDs, queue state, provider/runtime IDs,
server-only access-control resolver state, auto-embed execution history, live
maintenance status, and diagnostics history unless materialized as graph
artifact freshness metadata.

## Construction Gates

- #134 waits for acceptance or revision of the embedding-set selector and
  virtual-set vocabulary.
- #135 waits for acceptance or revision of derived graph artifact metadata and
  shard ownership.
- #136 waits for acceptance or revision of community source semantics.
- #137 waits for acceptance or revision of graph source and community source
  contracts.
- #138 waits for #132 similarity graph parameter decisions and the #135 artifact
  contract.

## Review Checklist

Reviewers accepted Phase 0 on #133. Future revisions should update this checklist and link the approving tracker comment before construction changes the contract.

- [x] Accepted `minSimilarity` as the canonical cutoff with `threshold`
  as a compatibility alias.
- [x] Accepted virtual embedding-set export by definition, with
  materialized membership snapshots only when explicitly generated.
- [x] Accepted graph-specific shard files:
  `graph_sources.json`, `graph_edges.jsonl`, `community_assignments.jsonl`,
  and `communities.json`.
- [x] Accepted user-authored communities as first-class user data that
  projects into graph/community APIs.
- [x] Accepted the required offline-compatible embedding-set fields and
  hosted-only optional metadata split.

Phase 0 exited when #133 approved these decisions. Downstream issues can move into construction planning in dependency order while preserving Fortemi capability/functionality parity.
