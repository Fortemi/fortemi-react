/**
 * Shard format types — matches the fortemi server matric-shard specification.
 *
 * A shard is a gzip-compressed tar archive (.shard) containing serialized
 * knowledge data with a manifest for integrity verification.
 */

export const CURRENT_SHARD_VERSION = '1.0.0'
export const SHARD_FORMAT = 'matric-shard'

/** Components that can appear in a shard archive. */
export type ShardComponent =
  | 'notes'
  | 'collections'
  | 'tags'
  | 'links'
  | 'embedding_sets'
  | 'embedding_set_members'
  | 'embedding_configs'
  | 'embeddings'

/** Manifest included in every shard as manifest.json. */
export interface ShardManifest {
  version: string
  matric_version: string
  format: typeof SHARD_FORMAT
  created_at: string // ISO 8601
  components: ShardComponent[]
  counts: Partial<Record<ShardComponent, number>>
  checksums: Record<string, string> // filename → sha256 hex
  min_reader_version: string
}

/** Options for shard export. */
export interface ExportOptions {
  includeEmbeddings?: boolean
  /** Filter to specific collection (export only notes in this collection). */
  collectionId?: string
  /** Filter to notes with this tag (e.g. 'app:research' for app-scoped export). */
  tag?: string
}

/** Conflict resolution strategy for shard import. */
export type ConflictStrategy = 'skip' | 'replace' | 'error'

/** Options for shard import. */
export interface ImportOptions {
  conflictStrategy?: ConflictStrategy
}

/** Per-entity import counts. */
export interface ImportCounts {
  notes: number
  collections: number
  tags: number
  links: number
  embedding_sets: number
  embedding_set_members: number
  embeddings: number
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

/** Link as serialized in the shard JSONL. */
export interface ShardLink {
  id: string
  from_note_id: string
  to_note_id: string
  kind: string
  score: number | null
  created_at: string
  metadata?: Record<string, unknown>
}

/** Embedding set as serialized in the shard JSON array. */
export interface ShardEmbeddingSet {
  id: string
  model: string
  dimension: number
  created_at: string
}

/** Embedding set member as serialized in the shard JSONL. */
export interface ShardEmbeddingSetMember {
  embedding_set_id: string
  note_id: string
  embedding_id: string
}

/** Embedding as serialized in the shard JSONL. */
export interface ShardEmbedding {
  id: string
  note_id: string
  embedding_set_id: string
  vector: number[]
  created_at: string
}
