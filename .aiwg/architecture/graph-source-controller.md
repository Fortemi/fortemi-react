# Graph Source Controller

Status: proposed for #137 review
Depends on: #129, #132, #134, #135, #136, #138

This document defines the planning contract for a React graph source controller.
It does not implement UI behavior. Future construction should preserve Fortemi
server and HotM capability parity unless an intentional divergence is recorded.

## Goals

- Let React consumers switch between citation, topic, precomputed, dynamic, and
  user-authored graph/community views through one public state contract.
- Avoid requiring consumers to import graphology or query raw SQL.
- Make loading, stale, cache, and error states explicit.
- Allow applications to animate or reorganize graph layouts when the active
  source or community source changes.
- Keep presentation choices in application UI while standardizing data and
  state orchestration.

## Graph Source Modes

```ts
export type GraphSourceMode =
  | 'citations'
  | 'topics'
  | 'precomputed'
  | 'dynamic-search'
  | 'user-authored'

export interface GraphSourceControllerState {
  mode: GraphSourceMode
  graph: CommunityGraph | null
  graphSource?: ShardGraphSourceLike
  communitySource?: CommunitySourceDescriptor
  embeddingSetSelector?: EmbeddingSetSelector
  filters?: CommunityFilterDefinition
  layout: GraphLayoutState
  status: GraphControllerStatus
  transition?: GraphTransitionState
}

export interface GraphControllerStatus {
  loading: boolean
  error: Error | null
  freshness: 'fresh' | 'stale' | 'unknown' | null
  cache: 'hit' | 'miss-live-built' | 'stale-live-built' | 'live-only' | null
}
```

Mode semantics:

- `citations`: link/citation graph from `GraphRepository.buildLinkGraph()`.
- `topics`: similarity graph from selected physical/filter/virtual embedding
  set.
- `precomputed`: graph source loaded from #135 artifacts.
- `dynamic-search`: graph/community view from current query/filter selection.
- `user-authored`: manual community source projected onto a graph.

## Public Hook Sketch

```ts
export interface UseGraphControllerOptions {
  initialMode?: GraphSourceMode
  initialEmbeddingSetSelector?: EmbeddingSetSelector
  initialCommunitySourceId?: string
  initialFilters?: CommunityFilterDefinition
  layout?: Partial<GraphLayoutState>
}

export interface UseGraphControllerResult extends GraphSourceControllerState {
  setMode(mode: GraphSourceMode): void
  setEmbeddingSetSelector(selector: EmbeddingSetSelector): void
  setCommunitySource(sourceId: string | null): void
  setFilters(filters: CommunityFilterDefinition): void
  refresh(): Promise<void>
  recompute(): Promise<void>
  previewDynamicCommunity(filters: CommunityFilterDefinition): Promise<void>
  saveCurrentCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor>
}
```

`useGraphController()` should compose lower-level hooks/repositories rather than
replace all of them:

- `useSimilarityGraph()` remains the focused topic graph hook.
- `useCommunities()` owns community sources and assignments.
- `useGraph()` can expose the simple graph read API for consumers that do not
  need source switching.
- `useGraphController()` coordinates active graph source, community source,
  filters, freshness, and transition state.

## Layout and Transition State

```ts
export interface GraphLayoutState {
  algorithm: 'force' | 'radial' | 'community' | 'manual'
  pinSelectedNodes?: boolean
  preserveViewport?: boolean
  communitySpacing?: number
}

export interface GraphTransitionState {
  fromMode?: GraphSourceMode
  toMode: GraphSourceMode
  reason:
    | 'mode-change'
    | 'embedding-set-change'
    | 'community-source-change'
    | 'filter-change'
    | 'recompute'
  startedAt: string
}
```

The controller should report transition intent, not perform rendering. UI
libraries decide animation details.

## Required Interactions

- Citations vs topics toggle changes `mode` between `citations` and `topics`.
- Embedding-set swap changes `embeddingSetSelector`, invalidates topic graph
  state, and refreshes or loads cached graph artifacts.
- Dynamic community preview applies runtime assignments without persistence.
- Saving a dynamic preview creates a `dynamic-snapshot` community source.
- Selecting a user-authored community changes `communitySource` without
  recomputing graph edges.
- Precomputed graph selection loads graph edges and preferred community
  assignments from #135 artifacts when available.

## Loading, Stale, and Error States

The controller should expose:

- `loading: true` while resolving selectors, graph edges, or assignments;
- `freshness: 'stale'` when selected cached artifacts are known stale;
- `freshness: 'unknown'` for imported artifacts whose hashes are not validated;
- typed errors for unsupported selectors, missing embeddings, incompatible
  dimensions, stale cache in `cache-only` mode, and unavailable graph sources.

Errors should not clear the previous graph automatically unless the selected
mode cannot safely keep showing it.

## HotM Behavior to Emulate

- backend community metadata is preferred when available;
- client fallback community detection is allowed for offline/live graphs;
- graph controls can switch between semantic/topic and link/citation views;
- community legends and group coloring can be driven from assignment metadata;
- graph UIs can reorganize when source or community assignments change;
- bridge/semantic edge provenance should remain inspectable.

## Behavior Left to Application UI

- exact graph rendering library;
- animation implementation;
- color palette and legend styling;
- node detail panels;
- viewport/camera persistence;
- drag/pin mechanics;
- application-specific filtering widgets.

## Test Scenarios for Construction

- initializes in citation mode without raw SQL in consuming code;
- switches citations to topics with a selected embedding set;
- swaps physical to virtual embedding-set selector and refreshes topic graph;
- loads a precomputed graph source and exposes freshness/cache state;
- applies a dynamic community preview without persistence;
- saves a dynamic preview and exposes it as active community source;
- selects user-authored community assignments without edge recompute;
- reports stale imported graph artifacts without hiding the graph;
- surfaces typed errors for incompatible selector or missing embeddings;
- preserves transition reason when mode, selector, community source, or filters
  change.

## Follow-Up Construction

- #129 should provide simple `useGraph()` and `useCommunities()` foundations.
- #132 should accept expanded embedding-set selectors for topic graphs.
- #134, #135, #136, and #138 should land before the full controller.
