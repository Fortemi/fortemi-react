/**
 * Field mapper — converts between browser schema and shard (server) schema.
 *
 * The browser uses different field names than the server shard format.
 * This module handles all rename transforms bidirectionally.
 */

import type {
  ShardNote,
  ShardLink,
  ShardTag,
  ShardCollection,
  ShardEmbeddingSet,
  ShardEmbeddingSetMember,
  ShardEmbedding,
} from './types.js'
import type { LinkRow } from '../repositories/links-repository.js'
import type { CollectionRow } from '../repositories/collections-repository.js'

// ── Notes ────────────────────────────────────────────────────────────────

/** Browser-format note row from the export query (denormalized). */
export interface BrowserNoteExport {
  id: string
  title: string | null
  format: string
  source: string
  is_starred: boolean
  is_archived: boolean
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  original_content: string
  revised_content: string | null
  tags: string[]
}

/** Convert a browser note to shard format. */
export function noteToShard(note: BrowserNoteExport): ShardNote {
  return {
    id: note.id,
    title: note.title,
    original_content: note.original_content,
    revised_content: note.revised_content,
    format: note.format,
    source: note.source,
    starred: note.is_starred,
    archived: note.is_archived,
    tags: note.tags,
    created_at: toISOString(note.created_at),
    updated_at: toISOString(note.updated_at),
    deleted_at: note.deleted_at ? toISOString(note.deleted_at) : null,
  }
}

/** Convert a shard note back to browser-insertable format. */
export function noteFromShard(shard: ShardNote): BrowserNoteExport {
  return {
    id: shard.id,
    title: shard.title,
    format: shard.format,
    source: shard.source,
    is_starred: shard.starred,
    is_archived: shard.archived,
    original_content: shard.original_content,
    revised_content: shard.revised_content,
    tags: shard.tags,
    created_at: shard.created_at,
    updated_at: shard.updated_at,
    deleted_at: shard.deleted_at,
  }
}

// ── Links ────────────────────────────────────────────────────────────────

/** Convert a browser link to shard format. */
export function linkToShard(link: LinkRow): ShardLink {
  return {
    id: link.id,
    from_note_id: link.source_note_id,
    to_note_id: link.target_note_id,
    kind: link.link_type,
    score: link.confidence,
    created_at: toISOString(link.created_at),
  }
}

/** Convert a shard link back to browser-insertable format. */
export function linkFromShard(shard: ShardLink): {
  id: string
  source_note_id: string
  target_note_id: string
  link_type: string
  confidence: number | null
  created_at: string
} {
  return {
    id: shard.id,
    source_note_id: shard.from_note_id,
    target_note_id: shard.to_note_id,
    link_type: shard.kind,
    confidence: shard.score,
    created_at: shard.created_at,
  }
}

// ── Collections ──────────────────────────────────────────────────────────

/** Convert a browser collection to shard format. */
export function collectionToShard(
  collection: CollectionRow,
  noteCount?: number,
): ShardCollection {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    parent_id: collection.parent_id,
    created_at: toISOString(collection.created_at),
    note_count: noteCount,
  }
}

/** Convert a shard collection back to browser-insertable format. */
export function collectionFromShard(shard: ShardCollection): {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  created_at: string
} {
  return {
    id: shard.id,
    name: shard.name,
    description: shard.description,
    parent_id: shard.parent_id,
    created_at: shard.created_at,
  }
}

// ── Tags ─────────────────────────────────────────────────────────────────

/**
 * Convert SKOS concepts + note_tag associations into shard flat tag format.
 * Shard tags are simple string arrays — deduplicated across all notes.
 */
export function tagsToShard(
  allTags: Array<{ name: string; created_at: Date | string }>,
): ShardTag[] {
  return allTags.map((t) => ({
    name: t.name,
    created_at: toISOString(t.created_at),
  }))
}

/**
 * Convert shard flat tags to browser format for insertion.
 * Returns unique tag names ready for note_tag association.
 */
export function tagsFromShard(shardTags: ShardTag[]): string[] {
  return [...new Set(shardTags.map((t) => t.name))]
}

// ── Embeddings ───────────────────────────────────────────────────────────

/** Convert a browser embedding_set to shard format. */
export function embeddingSetToShard(set: {
  id: string
  model_name: string
  dimensions: number
  created_at: Date | string
}): ShardEmbeddingSet {
  return {
    id: set.id,
    model: set.model_name,
    dimension: set.dimensions,
    created_at: toISOString(set.created_at),
  }
}

/** Convert a shard embedding set back to browser format. */
export function embeddingSetFromShard(shard: ShardEmbeddingSet): {
  id: string
  model_name: string
  dimensions: number
  created_at: string
} {
  return {
    id: shard.id,
    model_name: shard.model,
    dimensions: shard.dimension,
    created_at: shard.created_at,
  }
}

/** Convert a browser embedding_set_member to shard format. */
export function embeddingSetMemberToShard(member: {
  embedding_set_id: string
  note_id: string
  embedding_id: string
}): ShardEmbeddingSetMember {
  return {
    embedding_set_id: member.embedding_set_id,
    note_id: member.note_id,
    embedding_id: member.embedding_id,
  }
}

/** Convert a browser embedding to shard format. */
export function embeddingToShard(emb: {
  id: string
  note_id: string
  embedding_set_id: string
  vector: string | number[]
  created_at: Date | string
}): ShardEmbedding {
  return {
    id: emb.id,
    note_id: emb.note_id,
    embedding_set_id: emb.embedding_set_id,
    vector: typeof emb.vector === 'string' ? parseVector(emb.vector) : emb.vector,
    created_at: toISOString(emb.created_at),
  }
}

/** Convert a shard embedding back to browser format. */
export function embeddingFromShard(shard: ShardEmbedding): {
  id: string
  note_id: string
  embedding_set_id: string
  vector: string
  created_at: string
} {
  return {
    id: shard.id,
    note_id: shard.note_id,
    embedding_set_id: shard.embedding_set_id,
    vector: `[${shard.vector.join(',')}]`,
    created_at: shard.created_at,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toISOString(date: Date | string): string {
  if (date instanceof Date) return date.toISOString()
  return date
}

/** Parse a PGlite vector string "[0.1,0.2,...]" into a number array. */
function parseVector(vectorStr: string): number[] {
  const inner = vectorStr.replace(/^\[/, '').replace(/\]$/, '')
  return inner.split(',').map(Number)
}
