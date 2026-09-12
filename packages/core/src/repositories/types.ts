import type { EmbeddingSetSelector } from './embedding-sets-repository.js'
import type { EvidenceLocator, MetadataPredicate } from './metadata-predicates.js'

/**
 * Shared types for repository layer.
 * All repository methods use these types as inputs and outputs.
 */

export interface NoteSummary {
  id: string
  title: string | null
  format: string
  source: string
  visibility: string
  is_starred: boolean
  is_pinned: boolean
  is_archived: boolean
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  tags: string[]
}

export interface NoteFull extends NoteSummary {
  /** Note metadata is independent of the current revision's AI metadata. */
  metadata?: unknown
  archive_id: string | null
  revision_mode: string
  original: {
    id: string | null
    content: string
    content_hash: string
    created_at: Date
    version_number?: number
    user_created_at?: string | null
    user_last_edited_at?: string | null
  }
  current: {
    content: string
    ai_metadata: unknown | null
    generation_count: number
    model: string | null
    is_user_edited: boolean
    updated_at: Date
    last_revision_id?: string | null
  }
}

export interface NoteCreateInput {
  metadata?: unknown
  content: string
  title?: string
  format?: string
  source?: string
  visibility?: string
  tags?: string[]
  archive_id?: string
  /**
   * Explicit primary key. When omitted a UUIDv7 is minted (the default). Supply
   * this only for deterministic seeding or cross-instance identity — e.g. two
   * in-browser databases that must agree on a shared note's id so a shard swap
   * can dedupe it under the `skip` conflict strategy.
   */
  id?: string
}

export interface NoteUpdateInput {
  metadata?: unknown
  title?: string
  content?: string
  format?: string
  visibility?: string
}

export interface NoteListOptions {
  limit?: number
  offset?: number
  sort?: 'created_at' | 'updated_at' | 'title'
  order?: 'asc' | 'desc'
  is_starred?: boolean
  is_pinned?: boolean
  is_archived?: boolean
  include_deleted?: boolean
  include_archived?: boolean
  collection_id?: string
  tags?: string[]
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface SearchResult {
  id: string
  title: string | null
  snippet: string
  rank: number
  created_at: Date
  updated_at: Date
  tags: string[]
  has_embedding?: boolean
  locators?: EvidenceLocator[]
}

export interface SearchFacets {
  tags: { tag: string; count: number }[]
  collections: { id: string; name: string; count: number }[]
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  mode: 'text' | 'semantic' | 'hybrid'
  semantic_available: boolean
  limit: number
  offset: number
  facets?: SearchFacets
}

export interface SearchOptions {
  limit?: number
  offset?: number
  tags?: string[]
  /** Require every tag; the existing tags option retains its ANY semantics. */
  tagsAll?: string[]
  collection_id?: string
  date_from?: Date
  date_to?: Date
  is_starred?: boolean
  is_archived?: boolean
  format?: string
  source?: string
  /** Match any listed source before ranking. */
  sources?: string[]
  visibility?: string
  tenant_id?: string
  archive_id?: string | null
  metadataPredicates?: readonly MetadataPredicate[]
  include_facets?: boolean
  mode?: 'text' | 'semantic' | 'hybrid' | 'auto'
  embeddingSetId?: string
  embeddingSetSelector?: EmbeddingSetSelector
}

export interface NoteRevision {
  id: string
  note_id: string
  revision_number: number
  type: string  // 'user' | 'ai'
  content: string
  ai_metadata: unknown | null
  model: string | null
  created_at: Date
  parent_revision_id?: string | null
  summary?: string | null
  rationale?: string | null
  created_at_utc?: string | null
  ai_generated_at?: string | null
  user_last_edited_at?: string | null
  is_user_edited?: boolean
  generation_count?: number
}

export interface OriginalContentRevision {
  id: string
  note_id: string
  version_number: number
  content: string
  hash: string
  created_at_utc: string
  created_by: string
}
