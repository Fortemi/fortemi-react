/**
 * Shard format types — matches the fortemi server matric-shard specification.
 *
 * A shard is a gzip-compressed tar archive (.shard) containing serialized
 * knowledge data with a manifest for integrity verification.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @schema @packages/core/schemas/knowledge-shard.schema.receipt.json
 * @created 2026-07-17
 * @agent Codex
 */

import type { BlobStore } from '../blob-store.js'
import type { ShardTrustStore } from './shard-signature.js'

export const CURRENT_SHARD_VERSION = '1.2.0'
/** Highest authority contract accepted by opt-in import paths. */
export const MAX_SHARD_READER_VERSION = '2.0.0'
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
  | 'note_originals'
  | 'note_original_history'
  | 'note_revised_current'
  | 'note_revisions'
  | 'embedding_sets'
  | 'embedding_configs'
  | 'embedding_set_members'
  | 'embeddings'
  | 'provenance_activities'
  | 'named_locations'
  | 'provenance_locations'
  | 'provenance_devices'
  | 'provenance_records'
  | 'skos_schemes'
  | 'skos_concepts'
  | 'skos_labels'
  | 'skos_notes'
  | 'skos_relations'
  | 'skos_mapping_relations'
  | 'skos_scheme_memberships'
  | 'note_skos_tags'
  | 'skos_collections'
  | 'skos_collection_members'
  | 'provenance_edges'
  | 'community_assignments'
  | 'communities'
  | 'graph_edges'
  | 'graph_sources'

export type KnowledgeShardProfile = 'core-v1' | 'full-v1' | 'record-v1'
export type ShardBackend = 'pglite' | 'record-store'
export type ShardOperation = 'export' | 'import'
export type ShardAuthorityStatus =
  | 'supported'
  | 'candidate'
  | 'reserved'
  | 'unknown'
  | 'unprofiled'

export interface ShardProfileRegistryEntry {
  profile: KnowledgeShardProfile
  authority_status: 'supported' | 'candidate' | 'reserved'
  components: ShardComponent[]
}

export interface ShardLossEntry {
  code: string
  message: string
  component?: ShardComponent
  count?: number
  record_id?: string
  field_path?: string
  source_state?: 'absent' | 'null' | 'empty' | 'value' | 'legacy-indeterminate'
  destination_capability?: string
  action?: 'reject' | 'omit' | 'default' | 'degrade'
  reason?: string
}

export interface ShardCapabilityReport {
  schema_version: 'fortemi.shard.capability-report.v1'
  backend: ShardBackend
  operation: ShardOperation
  requested_profile: string | null
  requested_schema_version: string | null
  authority_status: ShardAuthorityStatus
  backend_supported: boolean
  portable: boolean
  authority: {
    repository: string
    commit: string
    contract_sha256: string
    contract_revision: string
    schema_version: string
    schema_bundle_sha256: string
  }
  advertised_profiles: KnowledgeShardProfile[]
  supported_components: ShardComponent[]
  declared_components: ShardComponent[]
  unsupported_components: ShardComponent[]
  omitted_components: ShardComponent[]
  losses: ShardLossEntry[]
}

export interface ShardAttachmentReference {
  id: string
  path: string
  mime: string | null
  checksum: string
  bytes: number
}

export interface ShardAttachmentProjection {
  extracted_text: string | null
  /** Legacy unprofiled relationship timestamp; outside core-v1. */
  created_at?: string
  /** Legacy unprofiled attachment tombstone; outside core-v1. */
  deleted_at?: string | null
  extraction_status?: 'extracted' | 'pending' | 'failed' | 'blocked' | 'deferred'
  reason?:
    | null
    | 'extraction_pending'
    | 'extractor_failed'
    | 'quarantined'
    | 'large_binary'
    | 'unsupported_mime'
    | 'no_extracted_text'
  attachment: ShardAttachmentReference
}

/** @deprecated Legacy React shard field name. Server shards use `attachments`. */
export type ShardBinarySource = ShardAttachmentProjection

/**
 * Reference to one cluster file of a component split across addressable files
 * (`notes/000.jsonl`, `notes/001.jsonl`, …). `offset` preserves deterministic
 * component order; readers discover each cluster's size from its contents.
 */
export interface ShardClusterRef {
  href: string // path within the shard, relative to manifest base
  offset: number // index of the first record in this cluster
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

export interface ShardMigrationHistoryEntry {
  from_version: string
  to_version: string
  migrated_at: string
  migrated_by: string
  changes: string[]
}

/** Manifest included in every shard as manifest.json. */
export interface ShardProducer {
  name: string
  version: string
  revision?: string
}

export interface ShardManifest {
  version: string
  /** Named server-owned portability profile. Required for canonical interchange. */
  profile?: string
  /** Structured producer identity used by canonical profiles. */
  producer?: ShardProducer
  /** @deprecated Legacy producer release field. */
  matric_version?: string
  format: typeof SHARD_FORMAT
  created_at: string // ISO 8601
  components: ShardComponent[]
  counts: Partial<Record<ShardComponent | 'community_sets', number>>
  checksums: Record<string, string> // filename → sha256 hex
  min_reader_version: string
  migrated_from?: string | null
  migration_history?: ShardMigrationHistoryEntry[]
  /** Clustered component layout for partial fetch (issue #189). Absent → monolithic. */
  layout?: ShardLayout
}

/** Options for shard export. */
export interface ExportOptions {
  /**
   * Explicit portability profile. Only profiles advertised by the selected
   * producer are accepted. Omit to retain the legacy unprofiled React archive.
   */
  profile?: string
  /** Explicit authority schema tuple; 2.0.0 is opt-in until matrix receipts pass. */
  schemaVersion?: '1.2.0' | '2.0.0'
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
  /**
   * Pack attachment bytes into a portable content-addressed `blobs/<hex>`
   * sidecar (Fortemi/fortemi#1046), producing a self-contained shard whose
   * attachments survive a round-trip (`getBlob()` returns real bytes on the
   * importing host). Requires {@link blobStore}. Absent/false → reference-only
   * (server default), which remains a valid shard.
   */
  includeBlobs?: boolean
  /**
   * Byte source for the sidecar. Required when `includeBlobs` is set; attachment
   * bytes are read by their `content_hash`. A blob the store cannot return is
   * skipped (its attachment stays reference-only) rather than failing export.
   */
  blobStore?: BlobStore
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
  /**
   * Destination for hydrating attachment bytes from a portable `blobs/<hex>`
   * sidecar (Fortemi/fortemi#1046). When provided, sidecar entries whose bare
   * hex matches an imported attachment's `content_hash` are promoted before
   * the logical transaction. A transaction failure removes only bytes that
   * were absent before promotion. Stores without the optional `delete`
   * capability fail before promotion. Absent → reference-only metadata.
   */
  blobStore?: BlobStore
  /**
   * Publisher-provenance policy for signed shards (#324, ADR-014):
   * - `require` — reject unsigned or bad-signature shards (default when a
   *   `trustStore` is supplied);
   * - `prefer` — verify signed shards; import unsigned ones with a warning;
   *   still reject a present-but-invalid signature;
   * - `trusted-local-only` — ignore signatures (own-export import).
   * When both `trustStore` and this are omitted, verification is skipped
   * entirely (checksum-only, unchanged behavior).
   */
  verifySignature?: 'require' | 'prefer' | 'trusted-local-only'
  /** Trust store resolving signer key_id → public key (required for `require`/`prefer`). */
  trustStore?: ShardTrustStore
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
  capability_report: ShardCapabilityReport
  /** Complete manifest counts when a profile contains components outside legacy counters. */
  component_counts?: ShardManifest['counts']
}

export interface ShardExportResult {
  success: boolean
  archive: Uint8Array | null
  errors: string[]
  capability_report: ShardCapabilityReport
}

// ── Shard-format entity shapes (server-compatible) ──────────────────────

/** Note as serialized in the shard JSONL. */
export interface ShardNote {
  id: string
  title: string | null
  original_content: string
  revised_content: string | null
  metadata?: Record<string, unknown> | null
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
  /** Schema 1.1 core-v1 tombstone; legacy unprofiled archives also carry it. */
  deleted_at?: string | null
}

/** Collection as serialized in the shard JSON array. */
export interface ShardCollection {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  created_at: string
  /** Legacy unprofiled fields; outside core-v1. */
  updated_at?: string
  deleted_at?: string | null
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
  /** Optional for legacy React shards exported before URL links existed. */
  to_url?: string | null
  kind: string
  score: number | null
  created_at: string
  /** Optional for legacy React shards exported before link metadata existed. */
  metadata?: Record<string, unknown> | null
}

/**
 * Embedding set as serialized in the shard JSON array.
 *
 * Fields beyond id/model/dimension are optional for backward compatibility:
 * legacy React shards omit them and import falls back to the same defaults
 * `embeddingSetFromShard` applies (name → model, is_system → false, …).
 */
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
  /** Optional for legacy React shards; import defaults to 'materialized'. */
  membership_type?: string
  /** Optional for legacy React shards; import falls back to the manifest timestamp. */
  added_at?: string
  /** Optional for legacy React shards; import defaults to NULL. */
  added_by?: string | null
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

/**
 * Embedding as serialized in the shard JSONL.
 *
 * Server metadata fields (`chunk_index`, `text`, `model`) are optional for
 * backward compatibility: legacy React shards exported before migration 0016
 * carry only `id`, `note_id`, `embedding_set_id`, `vector`, `created_at`.
 * Import normalizes absent metadata to schema defaults (0, '', NULL).
 */
export interface ShardEmbedding {
  id: string
  note_id: string
  chunk_index?: number
  text?: string
  vector: number[]
  model?: string
  /** React shard extension used to preserve local embedding-set scoping. */
  embedding_set_id?: string
  /** React shard extension used to preserve local creation ordering. */
  created_at?: string
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
