# Dynamic and User-Authored Communities

Status: proposed for #136 review
Depends on: #129, #130, #133, #134, #135

This document defines the planning contract for dynamic/search communities and
user-authored communities. It does not implement runtime behavior. Future
construction should preserve Fortemi server capability parity unless an
intentional divergence is recorded.

## Goals

- Let users create communities from search results, filters, selected notes, or
  graph interactions.
- Keep manual/user-authored communities separate from computed communities.
- Let saved communities drive graph grouping, colors, layout, and source
  switching.
- Preserve saved communities through Knowledge Shards.
- Keep transient dynamic communities runtime-only unless explicitly saved.

## Community Source Types

```ts
export type CommunitySourceType =
  | 'computed'
  | 'precomputed'
  | 'dynamic'
  | 'dynamic-snapshot'
  | 'user-authored'
  | 'imported'

export interface CommunitySourceDescriptor {
  id: string
  name: string
  sourceType: CommunitySourceType
  graphSourceId?: string
  selector?: EmbeddingSetSelector
  searchQuery?: string
  filters?: CommunityFilterDefinition
  createdAt?: string
  updatedAt?: string
  freshness?: 'fresh' | 'stale' | 'unknown'
}
```

Source semantics:

- `computed`: live algorithmic result over the current graph.
- `precomputed`: persisted algorithmic snapshot over a graph source.
- `dynamic`: runtime-only result from current query/filter/selection.
- `dynamic-snapshot`: saved result from a dynamic source at a point in time.
- `user-authored`: manual user intent, independent of recomputation.
- `imported`: shard-imported source whose runtime owner is not local.

## User Workflows

### Create From Search or Filters

1. User searches or filters notes.
2. UI shows a transient dynamic community preview.
3. User can apply preview to the active graph without saving.
4. User can save the preview as a dynamic snapshot.
5. Saved snapshot receives a stable community source ID and shard metadata.

### Create From Graph Selection

1. User selects nodes in a graph.
2. UI creates a transient manual draft.
3. User labels the community and optionally adds representative notes.
4. Save creates a `user-authored` community source.

### Re-Run Dynamic Community

1. User opens a saved dynamic definition.
2. Resolver re-evaluates query, filters, embedding-set selector, and SKOS
   constraints.
3. UI displays changed membership before replacing the saved snapshot.
4. User can keep old snapshot, replace it, or save as a new community source.

## API Contract Sketch

```ts
export interface CommunityFilterDefinition {
  query?: string
  tags?: string[]
  collectionIds?: string[]
  conceptIds?: string[]
  noteIds?: string[]
  embeddingSetSelector?: EmbeddingSetSelector
}

export interface CommunityAssignmentView {
  communitySourceId: string
  communityId: string
  noteId: string
  label?: string | null
  confidence?: number | null
  sourceType: CommunitySourceType
}

export interface CommunitySummary {
  id: string
  label: string
  sourceType: CommunitySourceType
  size: number
  confidence?: number | null
  representativeNoteIds: string[]
  freshness?: 'fresh' | 'stale' | 'unknown'
}

export interface CommunityCreateInput {
  name: string
  label?: string
  sourceType: 'dynamic-snapshot' | 'user-authored'
  filters?: CommunityFilterDefinition
  noteIds?: string[]
  representativeNoteIds?: string[]
}

export interface CommunityRepository {
  previewDynamicCommunity(filters: CommunityFilterDefinition): Promise<CommunityAssignmentView[]>
  saveCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor>
  rerunDynamicCommunity(sourceId: string): Promise<CommunityAssignmentView[]>
  listCommunitySources(): Promise<CommunitySourceDescriptor[]>
  getCommunityAssignments(sourceId: string): Promise<CommunityAssignmentView[]>
}
```

## React Hook Requirements

```ts
export interface UseCommunitiesResult {
  sources: CommunitySourceDescriptor[]
  activeSourceId: string | null
  summaries: CommunitySummary[]
  assignments: Map<string, CommunityAssignmentView>
  loading: boolean
  error: Error | null
  preview(filters: CommunityFilterDefinition): Promise<CommunityAssignmentView[]>
  save(input: CommunityCreateInput): Promise<CommunitySourceDescriptor>
  rerun(sourceId: string): Promise<CommunityAssignmentView[]>
  setActiveSource(sourceId: string | null): void
}
```

Graph UI consumers should be able to use `activeSourceId` and assignments to
color, group, filter, or reorganize nodes without querying raw tables.

## Refresh Behavior

Dynamic communities are refreshed by re-running their query/filter definition.
Freshness becomes stale when:

- matching notes are added, updated, deleted, or retagged;
- scoped search behavior changes;
- selected embedding-set or virtual-set membership changes;
- SKOS concept assignments change;
- filter definitions change.

Manual user-authored communities are not stale just because graph inputs change.
They can have missing-note warnings when member notes are deleted or unavailable,
but graph recomputation must not overwrite them.

## Coexistence Rules

- A note may belong to multiple community sources at once.
- Computed/precomputed assignments never overwrite user-authored assignments.
- Dynamic previews do not persist until explicitly saved.
- Saving a dynamic snapshot creates a distinct source from the live dynamic
  definition.
- User-authored communities can be projected into the same graph assignment API
  as computed communities, but keep `sourceType: 'user-authored'`.

## Shard Behavior

Persist:

- `user-authored` communities;
- saved `dynamic-snapshot` communities;
- metadata needed to re-run a saved dynamic definition when available.

Do not persist:

- transient previews;
- unsaved search results;
- active UI selection;
- layout state.

Saved communities should map to #135 `communities.json` and
`community_assignments.jsonl`.

## Test Scenarios for Construction

- previews a dynamic community from search/filter results without persistence;
- saves a dynamic preview as a snapshot;
- re-runs a saved dynamic community after note/tag changes;
- keeps old and new snapshots distinct when requested;
- creates a user-authored community from selected notes;
- preserves user-authored communities across graph recompute;
- projects user-authored communities into graph assignment APIs;
- exports/imports saved communities through #135 shard files;
- reports missing notes in imported/manual communities without deleting the
  community;
- updates graph UI assignment maps when active community source changes.

## Follow-Up Construction

- #129 should expose `useCommunities()` and graph community source APIs.
- #137 should use these community sources to drive HotM-style graph
  reorganization.
- #135 should implement persistence for saved dynamic and user-authored
  communities.
