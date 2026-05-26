# Virtual Embedding Sets

Status: proposed for #134 review
Depends on: #133

This document defines the planning contract for virtual embedding sets in
`fortemi-react`. It intentionally does not implement runtime behavior. Future
construction should preserve parity with Fortemi server capabilities unless an
intentional divergence is recorded.

## Goals

- Let search and graph APIs accept a single embedding-set selector shape.
- Represent virtual sets as durable, inspectable definitions.
- Preserve offline behavior through Knowledge Shards where possible.
- Keep incompatible model, dimension, and membership states explicit.
- Allow materialized snapshots only when a caller intentionally freezes a
  resolved view.

## Terms

- Physical embedding set: a concrete vector space with stored vectors scoped by
  `embedding_set_id`.
- Filter embedding set: a named criteria or membership view over an existing
  physical vector space.
- Virtual embedding set: a durable selector definition that resolves to one or
  more compatible vectors per note, but may not own a physical vector
  collection.
- Materialized snapshot: a frozen membership/vector selection generated from a
  virtual definition at a point in time.
- Resolver: the local or server-backed component that turns a selector into
  concrete note/vector rows.

## TypeScript Contract Sketch

```ts
export type EmbeddingSetKind = 'physical' | 'filter' | 'virtual'

export type EmbeddingSetMode = 'auto' | 'manual' | 'mixed'

export interface EmbeddingSetDescriptor {
  id: string
  name: string
  purpose?: string | null
  kind: EmbeddingSetKind
  mode?: EmbeddingSetMode
  model?: string
  dimension?: number
  truncateDimension?: number | null
  criteria?: EmbeddingSetCriteria | null
  createdAt?: string
  updatedAt?: string
  freshness?: EmbeddingSetFreshness
}

export interface EmbeddingSetSelector {
  kind: 'default' | 'embedding-set' | 'virtual-definition'
  embeddingSetId?: string
  definition?: VirtualEmbeddingSetDefinition
}

export interface VirtualEmbeddingSetDefinition {
  id: string
  name: string
  purpose?: string | null
  source: VirtualEmbeddingSetSource
  compatibility: EmbeddingCompatibilityPolicy
  materialization?: VirtualMaterializationPolicy
  createdAt?: string
  updatedAt?: string
}

export type VirtualEmbeddingSetSource =
  | CriteriaVirtualSource
  | SetOperationVirtualSource
  | FallbackVirtualSource
  | LatestCompatibleVirtualSource
  | SnapshotVirtualSource

export interface CriteriaVirtualSource {
  type: 'criteria'
  baseSetId: string
  criteria: EmbeddingSetCriteria
}

export interface SetOperationVirtualSource {
  type: 'set-operation'
  operation: 'union' | 'intersection' | 'difference'
  setIds: string[]
}

export interface FallbackVirtualSource {
  type: 'fallback'
  preferredSetIds: string[]
}

export interface LatestCompatibleVirtualSource {
  type: 'latest-compatible'
  candidateSetIds: string[]
  model?: string
  dimension?: number
}

export interface SnapshotVirtualSource {
  type: 'snapshot'
  snapshotId: string
  sourceDefinitionId: string
  generatedAt: string
  inputHash: string
}

export interface EmbeddingSetCriteria {
  query?: string
  tags?: string[]
  collectionIds?: string[]
  conceptIds?: string[]
  noteIds?: string[]
  updatedAfter?: string
  updatedBefore?: string
}

export interface EmbeddingCompatibilityPolicy {
  model: 'require-same' | 'allow-compatible-family'
  dimension: 'require-same' | 'allow-truncation'
  duplicateVectors: 'prefer-latest' | 'prefer-set-order' | 'error'
  missingVectors: 'omit' | 'include-unembedded-note' | 'error'
}

export interface VirtualMaterializationPolicy {
  allowed: boolean
  includeResolvedMembers?: boolean
  includeResolvedEdges?: boolean
  freshness: 'fresh' | 'stale' | 'unknown'
}

export interface EmbeddingSetFreshness {
  status: 'fresh' | 'stale' | 'unknown'
  sourceHash?: string
  checkedAt?: string
  reason?: string
}

export type VirtualEmbeddingSetValidationError =
  | { code: 'mixed-models'; setIds: string[] }
  | { code: 'mixed-dimensions'; setIds: string[] }
  | { code: 'missing-vector'; noteId: string; setId: string }
  | { code: 'duplicate-vector'; noteId: string; setIds: string[] }
  | { code: 'stale-snapshot'; snapshotId: string }
  | { code: 'unsupported-criteria'; field: string }
```

## Resolution Rules

Search and graph APIs should accept `EmbeddingSetSelector`.

- `default` resolves to the current default physical set.
- `embedding-set` resolves by ID and may refer to a physical, filter, or
  stored virtual descriptor.
- `virtual-definition` resolves directly from the supplied definition.

Local PGlite resolvers should support simple criteria, set operations,
fallback chains, and snapshots when all needed data is local. Server-backed
adapters may resolve richer criteria, access-control-aware membership,
background refresh state, or model-family compatibility.

## Live Evaluation vs Materialization

Evaluate live when:

- the selector is criteria-driven and the caller wants current membership;
- the corpus is small enough for local search or graph construction;
- the result is transient UI state;
- missing vectors should be omitted or surfaced without freezing state.

Materialize when:

- a user explicitly saves a resolved virtual view;
- graph/community artifacts need stable input membership;
- a Knowledge Shard should preserve an offline frozen view;
- a server precompute job produces reusable graph or community artifacts.

Materialized snapshots must carry `sourceDefinitionId`, `generatedAt`,
`inputHash`, model/dimension metadata, and freshness status. Snapshot import
must never pretend freshness is known unless the source hash can be validated.

## Shard Semantics

Knowledge Shards should export virtual embedding sets by definition. Resolved
memberships are optional and only exported when explicitly materialized.

Required virtual definition fields:

- `id`
- `name`
- `purpose`
- `source`
- `compatibility`
- `materialization`
- `created_at`
- `updated_at`

Optional materialized rows:

- `virtual_set_id`
- `source_definition_id`
- `note_id`
- `embedding_set_id`
- `embedding_id`
- `generated_at`
- `input_hash`
- `freshness`

Readers that do not understand virtual sets should ignore virtual definitions
and continue importing physical sets and embeddings. Readers that understand
definitions but not a source type should preserve the raw definition and mark it
unresolved.

## Picker and Hook Behavior

`useEmbeddingSets()` and set pickers should expose a unified descriptor list
with `kind: 'physical' | 'filter' | 'virtual'`.

Recommended UI-visible behavior:

- physical sets appear as concrete vector spaces;
- filter sets appear as criteria-backed views over a base set;
- virtual sets appear as derived selectors with compatibility/freshness status;
- materialized snapshots appear as frozen views with generated timestamp;
- incompatible virtual sets remain visible but disabled for graph/search actions
  that cannot resolve them.

Search hooks and graph hooks should accept either an `embeddingSetId` for the
current simple path or an `EmbeddingSetSelector` for the expanded API. The
expanded API should normalize `threshold` to canonical `minSimilarity` when
building similarity graphs.

## Test Scenarios for Construction

- resolves a criteria virtual set against local notes/tags/collections;
- resolves union/intersection/difference over compatible physical sets;
- applies fallback ordering when a preferred set lacks vectors;
- rejects mixed dimensions when truncation is not allowed;
- rejects mixed models when compatible-family matching is not allowed;
- handles duplicate vectors according to policy;
- exports/imports a virtual definition without materialized members;
- exports/imports a materialized snapshot with freshness metadata;
- keeps unresolved unsupported definitions inspectable after import;
- exposes physical, filter, virtual, and snapshot rows in picker descriptors;
- normalizes `threshold` to `minSimilarity` for graph construction.

## Follow-Up Construction

- #132 should adopt `EmbeddingSetSelector` for similarity graph construction.
- #135 should define exact shard filenames and row shapes for virtual set
  definitions and materialized membership snapshots.
- #138 should use the same selector and freshness model for cached similarity
  graph artifacts.
