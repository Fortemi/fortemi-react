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
  archive_id: string | null
  revision_mode: string
  original: {
    id: string
    content: string
    content_hash: string
    created_at: Date
  }
  current: {
    content: string
    ai_metadata: unknown | null
    generation_count: number
    model: string | null
    is_user_edited: boolean
    updated_at: Date
  }
}

export interface NoteCreateInput {
  content: string
  title?: string
  format?: string
  source?: string
  visibility?: string
  tags?: string[]
  archive_id?: string
}

export interface NoteUpdateInput {
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
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  mode: 'text'
  semantic_available: boolean
  limit: number
  offset: number
}

export interface SearchOptions {
  limit?: number
  offset?: number
  tags?: string[]
  collection_id?: string
}
