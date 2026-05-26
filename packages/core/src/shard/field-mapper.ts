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
  ShardSkosScheme,
  ShardSkosConcept,
  ShardSkosRelation,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
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
  name?: string
  purpose?: string | null
  model_name: string
  dimensions: number
  kind?: 'physical' | 'filter' | 'virtual'
  mode?: 'auto' | 'manual' | 'mixed' | null
  truncate_dimension?: number | null
  criteria_json?: unknown | null
  source_json?: unknown | null
  compatibility_json?: unknown | null
  materialization_json?: unknown | null
  freshness_json?: unknown | null
  created_at: Date | string
  updated_at?: Date | string
}): ShardEmbeddingSet {
  return {
    id: set.id,
    name: set.name ?? set.model_name,
    purpose: set.purpose ?? null,
    model: set.model_name,
    dimension: set.dimensions,
    kind: set.kind ?? 'physical',
    mode: set.mode ?? null,
    truncate_dimension: set.truncate_dimension ?? null,
    criteria: jsonObject(set.criteria_json),
    source: jsonObject(set.source_json),
    compatibility: jsonObject(set.compatibility_json),
    materialization: jsonObject(set.materialization_json),
    freshness: jsonObject(set.freshness_json) as ShardEmbeddingSet['freshness'],
    created_at: toISOString(set.created_at),
    updated_at: set.updated_at ? toISOString(set.updated_at) : undefined,
  }
}

/** Convert a shard embedding set back to browser format. */
export function embeddingSetFromShard(shard: ShardEmbeddingSet): {
  id: string
  name: string
  purpose: string | null
  model_name: string
  dimensions: number
  kind: 'physical' | 'filter' | 'virtual'
  mode: 'auto' | 'manual' | 'mixed' | null
  truncate_dimension: number | null
  criteria_json: string | null
  source_json: string | null
  compatibility_json: string | null
  materialization_json: string | null
  freshness_json: string | null
  created_at: string
  updated_at: string | null
} {
  return {
    id: shard.id,
    name: shard.name ?? shard.model,
    purpose: shard.purpose ?? null,
    model_name: shard.model,
    dimensions: shard.dimension,
    kind: shard.kind ?? 'physical',
    mode: shard.mode ?? null,
    truncate_dimension: shard.truncate_dimension ?? null,
    criteria_json: jsonString(shard.criteria),
    source_json: jsonString(shard.source),
    compatibility_json: jsonString(shard.compatibility),
    materialization_json: jsonString(shard.materialization),
    freshness_json: jsonString(shard.freshness),
    created_at: shard.created_at,
    updated_at: shard.updated_at ?? null,
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


// ── SKOS ─────────────────────────────────────────────────────────────────

export function skosSchemeToShard(scheme: {
  id: string
  title: string
  description: string | null
  created_at: Date | string
  updated_at: Date | string
}): ShardSkosScheme {
  return {
    id: scheme.id,
    title: scheme.title,
    description: scheme.description,
    created_at: toISOString(scheme.created_at),
    updated_at: toISOString(scheme.updated_at),
  }
}

export function skosConceptToShard(concept: {
  id: string
  scheme_id: string
  pref_label: string
  alt_labels: string[] | string | null
  definition: string | null
  created_at: Date | string
  updated_at: Date | string
}): ShardSkosConcept {
  return {
    id: concept.id,
    scheme_id: concept.scheme_id,
    pref_label: concept.pref_label,
    alt_labels: parseJsonArrayField(concept.alt_labels),
    definition: concept.definition,
    created_at: toISOString(concept.created_at),
    updated_at: toISOString(concept.updated_at),
  }
}

export function skosRelationToShard(relation: {
  id: string
  source_concept_id: string
  target_concept_id: string
  relation_type: 'broader' | 'narrower' | 'related'
  created_at: Date | string
}): ShardSkosRelation {
  return {
    id: relation.id,
    source_concept_id: relation.source_concept_id,
    target_concept_id: relation.target_concept_id,
    relation_type: relation.relation_type,
    created_at: toISOString(relation.created_at),
  }
}

export function noteSkosTagToShard(tag: {
  id: string
  note_id: string
  concept_id: string
  created_at: Date | string
}): ShardNoteSkosTag {
  return {
    id: tag.id,
    note_id: tag.note_id,
    concept_id: tag.concept_id,
    created_at: toISOString(tag.created_at),
  }
}

// ── Provenance ───────────────────────────────────────────────────────────

export function provenanceEdgeToShard(edge: {
  id: string
  entity_type: string
  entity_id: string
  activity: string
  agent: string
  started_at: Date | string
  ended_at: Date | string | null
  attributes: Record<string, unknown> | string | null
}): ShardProvenanceEdge {
  return {
    id: edge.id,
    entity_type: edge.entity_type,
    entity_id: edge.entity_id,
    activity: edge.activity,
    agent: edge.agent,
    started_at: toISOString(edge.started_at),
    ended_at: edge.ended_at ? toISOString(edge.ended_at) : null,
    attributes: parseJsonObjectField(edge.attributes),
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

function parseJsonArrayField(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value
  if (!value) return []
  const parsed = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function parseJsonObjectField(value: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value !== 'string') return value
  const parsed = JSON.parse(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

function jsonString(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}
