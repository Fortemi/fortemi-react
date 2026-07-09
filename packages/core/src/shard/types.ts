/**
 * Shard format types — matches the fortemi server matric-shard specification.
 *
 * A shard is a gzip-compressed tar archive (.shard) containing serialized
 * knowledge data with a manifest for integrity verification.
 */

export const CURRENT_SHARD_VERSION = '1.0.0'
export const SHARD_FORMAT = 'matric-shard'

function parseVersion(value: string): number[] {
  return value.split('.').map((segment) => {
    const match = segment.match(/^\d+/)
    return match ? Number.parseInt(match[0], 10) : 0
  })
}

export function compareShardVersions(left: string, right: string): number {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1
  }
  return 0
}

/** Components that can appear in a shard archive. */
export type ShardComponent =
  | 'notes'
  | 'collections'
  | 'tags'
  | 'templates'
  | 'links'
  | 'embedding_sets'
  | 'embedding_set_members'
  | 'embedding_configs'
  | 'embeddings'
  | 'skos_schemes'
  | 'skos_concepts'
  | 'skos_relations'
  | 'note_skos_tags'
  | 'provenance_edges'
  | 'community_assignments'
  | 'communities'
  | 'graph_edges'
  | 'graph_sources'

export interface ShardAttachmentReference {
  id: string
  path: string
  mime: string | null
  checksum: string
  bytes: number
}

export interface ShardAttachmentProjection {
  extracted_text: string
  attachment: ShardAttachmentReference
}

/** @deprecated Legacy React shard field name. Server shards use `attachments`. */
export type ShardBinarySource = ShardAttachmentProjection

/**
 * Reference to one cluster file of a component split across addressable files
 * (`notes/000.jsonl`, `notes/001.jsonl`, …). `offset`/`count` are the record
 * range within the component, so an in-place reader fetches only the clusters a
 * query needs — the shard analog of the AIWG chunk-manifest scan parts.
 */
export interface ShardClusterRef {
  href: string // path within the shard, relative to manifest base
  offset: number // index of the first record in this cluster
  count: number // records in this cluster
}

/**
 * Optional clustered layout (additive — absent on monolithic shards). When a
 * component is present here, its records live in the listed cluster files instead
 * of (or in addition to) the single `<component>.jsonl`. Both `importShard` and
 * the in-place reader consume it; a monolithic shard omits `layout` entirely.
 */
export interface ShardLayout {
  clusters?: Partial<Record<ShardComponent, ShardClusterRef[]>>
}

/** Manifest included in every shard as manifest.json. */
export interface ShardManifest {
  version: string
  matric_version: string
  format: typeof SHARD_FORMAT
  created_at: string // ISO 8601
  components: ShardComponent[]
  counts: Partial<Record<ShardComponent | 'community_sets', number>>
  checksums: Record<string, string> // filename → sha256 hex
  min_reader_version: string
  /** Clustered component layout for partial fetch (issue #189). Absent → monolithic. */
  layout?: ShardLayout
}

/** Options for shard export. */
export interface ExportOptions {
  includeEmbeddings?: boolean
  /** Filter to specific collection (export only notes in this collection). */
  collectionId?: string
  /** Filter to notes with this tag (e.g. 'app:research' for app-scoped export). */
  tag?: string
  /** Export only these embedding sets and their member/vector rows. */
  embeddingSetIds?: string[]
  /** Preserve virtual selector materialization metadata and virtual member rows. */
  includeMaterializedSelectors?: boolean
  /**
   * When set to a positive integer, emit notes as clustered files
   * (`notes/000.jsonl`, …) of this many records each, and record the layout in
   * the manifest, so an in-place reader can fetch only the clusters it needs
   * (issue #189). Absent → a single monolithic `notes.jsonl` (unchanged).
   */
  clusterNotesSize?: number
}

/** Conflict resolution strategy for shard import. */
export type ConflictStrategy = 'skip' | 'replace' | 'error'

/** Options for shard import. */
export interface ImportOptions {
  conflictStrategy?: ConflictStrategy
  /** Rows processed between cooperative yields. Defaults to 250. */
  batchSize?: number
  /** Progress callback for long-running import phases. */
  onProgress?: (progress: ImportProgress) => void
}

export type ImportProgressPhase =
  | 'unpack'
  | 'validate'
  | 'collections'
  | 'notes'
  | 'skos'
  | 'templates'
  | 'links'
  | 'provenance'
  | 'embedding_sets'
  | 'embedding_configs'
  | 'embeddings'
  | 'embedding_set_members'
  | 'graph'
  | 'communities'
  | 'index'

export interface ImportProgress {
  phase: ImportProgressPhase
  done: number
  total: number
}

/** Per-entity import counts. */
export interface ImportCounts {
  notes: number
  collections: number
  templates: number
  tags: number
  links: number
  embedding_sets: number
  embedding_configs: number
  embedding_set_members: number
  embeddings: number
  skos_schemes: number
  skos_concepts: number
  skos_relations: number
  note_skos_tags: number
  provenance_edges: number
  graph_sources: number
  graph_edges: number
  community_sets: number
  communities: number
  community_assignments: number
}

/** Result of a shard import operation. */
export interface ImportResult {
  success: boolean
  counts: ImportCounts
  skipped: Partial<ImportCounts>
  warnings: string[]
  errors: string[]
  duration_ms: number
}

// ── Shard-format entity shapes (server-compatible) ──────────────────────

/** Note as serialized in the shard JSONL. */
export interface ShardNote {
  id: string
  title: string | null
  original_content: string
  revised_content: string | null
  collection_id?: string | null
  attachments?: ShardAttachmentProjection[]
  /** @deprecated Legacy React shard field name. Use `attachments`. */
  binary_sources?: ShardBinarySource[]
  format: string
  source: string
  starred: boolean
  archived: boolean
  tags: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Collection as serialized in the shard JSON array. */
export interface ShardCollection {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  created_at: string
  note_count?: number
}

/** Tag as serialized in the shard JSON array. */
export interface ShardTag {
  name: string
  created_at: string
}

/** Template as serialized in the shard JSON array. */
export interface ShardTemplate {
  id: string
  name: string
  description: string | null
  content: string
  format: string
  default_tags: string[]
  collection_id: string | null
  created_at: string
  updated_at: string
}

/** Link as serialized in the shard JSONL. */
export interface ShardLink {
  id: string
  from_note_id: string
  to_note_id: string | null
  to_url: string | null
  kind: string
  score: number | null
  created_at: string
  metadata: Record<string, unknown> | null
}

/** Embedding set as serialized in the shard JSON array. */
export interface ShardEmbeddingSet {
  id: string
  name?: string
  slug?: string | null
  description?: string | null
  purpose?: string | null
  document_count?: number
  embedding_count?: number
  is_system?: boolean
  keywords?: string[]
  model: string
  dimension: number
  kind?: 'physical' | 'filter' | 'virtual'
  mode?: 'auto' | 'manual' | 'mixed' | null
  truncate_dimension?: number | null
  criteria?: Record<string, unknown> | null
  source?: Record<string, unknown> | null
  compatibility?: Record<string, unknown> | null
  materialization?: Record<string, unknown> | null
  freshness?: ShardArtifactFreshness | null
  created_at?: string
  updated_at?: string
}

/** Embedding set member as serialized in the shard JSONL. */
export interface ShardEmbeddingSetMember {
  embedding_set_id: string
  note_id: string
  /** Legacy React shard field; new exports use server membership metadata instead. */
  embedding_id?: string
  membership_type: string
  added_at: string
  added_by: string | null
}

/** Embedding config as serialized in the shard JSON array. */
export interface ShardEmbeddingConfig {
  id: string
  name: string
  description: string | null
  model: string
  dimension: number
  chunk_size: number
  chunk_overlap: number
  is_default: boolean
}

/** Embedding as serialized in the shard JSONL. */
export interface ShardEmbedding {
  id: string
  note_id: string
  embedding_set_id: string
  vector: number[]
  created_at: string
}


/** SKOS scheme as serialized in the shard JSON array. */
export interface ShardSkosScheme {
  id: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
}

/** SKOS concept as serialized in the shard JSON array. */
export interface ShardSkosConcept {
  id: string
  scheme_id: string
  pref_label: string
  alt_labels: string[]
  definition: string | null
  created_at: string
  updated_at: string
}

/** SKOS concept relation as serialized in the shard JSONL. */
export interface ShardSkosRelation {
  id: string
  source_concept_id: string
  target_concept_id: string
  relation_type: 'broader' | 'narrower' | 'related'
  created_at: string
}

/** Note-to-SKOS-concept assignment as serialized in the shard JSONL. */
export interface ShardNoteSkosTag {
  id: string
  note_id: string
  concept_id: string
  created_at: string
}

/** Provenance edge as serialized in the shard JSONL. */
export interface ShardProvenanceEdge {
  id: string
  entity_type: string
  entity_id: string
  activity: string
  agent: string
  started_at: string
  ended_at: string | null
  attributes: Record<string, unknown> | null
}


// - Graph/community derived artifacts ---------------------------------------

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

export interface ShardGraphSource {
  id: string
  name: string
  kind: 'link' | 'similarity' | 'search' | 'manual' | 'imported'
  source_table?: 'link' | 'embedding' | 'manual' | null
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

export interface ShardGraphEdge {
  graph_source_id: string
  from_note_id: string
  to_note_id: string
  weight: number
  kind: 'link' | 'similarity' | 'manual'
  rank?: number | null
  metadata?: Record<string, unknown>
}

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

export interface ShardCommunityAssignment {
  community_set_id: string
  community_id: string
  note_id: string
  confidence?: number | null
  source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
  metadata?: Record<string, unknown>
}
