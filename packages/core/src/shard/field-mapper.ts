/**
 * Field mapper — converts between browser schema and shard (server) schema.
 *
 * The browser uses different field names than the server shard format.
 * This module handles all rename transforms bidirectionally.
 */

import type {
  ShardNote,
  ShardAttachmentProjection,
  ShardLink,
  ShardTag,
  ShardCollection,
  ShardTemplate,
  ShardEmbeddingSet,
  ShardEmbeddingSetMember,
  ShardEmbedding,
  ShardEmbeddingConfig,
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
  collection_id?: string | null
  attachments?: ShardAttachmentProjection[]
  tags: string[]
}

/** Convert a browser note to shard format. */
export function noteToShard(note: BrowserNoteExport): ShardNote {
  return {
    id: note.id,
    title: note.title,
    original_content: note.original_content,
    revised_content: note.revised_content,
    collection_id: note.collection_id ?? null,
    ...(note.attachments?.length ? { attachments: note.attachments } : {}),
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
  const attachments = shard.attachments ?? shard.binary_sources
  return {
    id: shard.id,
    title: shard.title,
    format: shard.format,
    source: shard.source,
    is_starred: shard.starred,
    is_archived: shard.archived,
    original_content: shard.original_content,
    revised_content: shard.revised_content,
    collection_id: shard.collection_id ?? null,
    attachments,
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
    to_url: null,
    kind: link.link_type,
    score: link.confidence,
    created_at: toISOString(link.created_at),
    metadata: null,
  }
}

/** Convert a browser URL-target link row to shard format. */
export function urlLinkToShard(link: {
  id: string
  source_note_id: string
  to_url: string
  link_type: string
  confidence: number | null
  metadata_json?: Record<string, unknown> | string | null
  created_at: Date | string
}): ShardLink {
  const metadata = typeof link.metadata_json === 'string'
    ? JSON.parse(link.metadata_json) as Record<string, unknown>
    : link.metadata_json ?? null
  return {
    id: link.id,
    from_note_id: link.source_note_id,
    to_note_id: null,
    to_url: link.to_url,
    kind: link.link_type,
    score: link.confidence,
    created_at: toISOString(link.created_at),
    metadata,
  }
}

/** Convert a shard link back to browser-insertable format. */
export function linkFromShard(shard: ShardLink): {
  id: string
  source_note_id: string
  target_note_id: string | null
  to_url: string | null
  link_type: string
  confidence: number | null
  created_at: string
  metadata: Record<string, unknown> | null
} {
  return {
    id: shard.id,
    source_note_id: shard.from_note_id,
    target_note_id: shard.to_note_id,
    to_url: shard.to_url,
    link_type: shard.kind,
    confidence: shard.score,
    created_at: shard.created_at,
    metadata: shard.metadata,
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

// ── Templates ────────────────────────────────────────────────────────────

/** Convert a browser template row to shard format. */
export function templateToShard(template: {
  id: string
  name: string
  description: string | null
  content: string
  format: string
  default_tags: string[] | string
  collection_id: string | null
  created_at: Date | string
  updated_at: Date | string
}): ShardTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    content: template.content,
    format: template.format,
    default_tags: Array.isArray(template.default_tags)
      ? template.default_tags
      : JSON.parse(template.default_tags) as string[],
    collection_id: template.collection_id,
    created_at: toISOString(template.created_at),
    updated_at: toISOString(template.updated_at),
  }
}

// ── Embeddings ───────────────────────────────────────────────────────────

/** Convert a browser embedding_set to shard format. */
export function embeddingSetToShard(set: {
  id: string
  name?: string
  slug?: string | null
  description?: string | null
  purpose?: string | null
  document_count?: number | null
  embedding_count?: number | null
  is_system?: boolean | null
  keywords_json?: unknown | null
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
  const name = set.name ?? set.model_name
  return {
    id: set.id,
    name,
    slug: set.slug ?? slugifyEmbeddingSet(name),
    description: set.description ?? null,
    purpose: set.purpose ?? null,
    document_count: set.document_count ?? 0,
    embedding_count: set.embedding_count ?? 0,
    is_system: set.is_system ?? false,
    keywords: jsonStringArray(set.keywords_json),
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
export function embeddingSetFromShard(shard: ShardEmbeddingSet, fallbackCreatedAt: string): {
  id: string
  name: string
  slug: string | null
  description: string | null
  purpose: string | null
  document_count: number | null
  embedding_count: number | null
  is_system: boolean
  keywords_json: string | null
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
    slug: shard.slug ?? null,
    description: shard.description ?? null,
    purpose: shard.purpose ?? null,
    document_count: shard.document_count ?? null,
    embedding_count: shard.embedding_count ?? null,
    is_system: shard.is_system ?? false,
    keywords_json: jsonString(shard.keywords ?? []),
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
    created_at: shard.created_at ?? fallbackCreatedAt,
    updated_at: shard.updated_at ?? null,
  }
}

/** Convert a browser embedding_set_member to shard format. */
export function embeddingSetMemberToShard(member: {
  embedding_set_id: string
  note_id: string
  membership_type?: string | null
  added_at?: Date | string | null
  added_by?: string | null
}): ShardEmbeddingSetMember {
  return {
    embedding_set_id: member.embedding_set_id,
    note_id: member.note_id,
    membership_type: member.membership_type ?? 'materialized',
    added_at: toISOString(member.added_at ?? new Date()),
    added_by: member.added_by ?? null,
  }
}

/** Convert a browser embedding_config row to shard format. */
export function embeddingConfigToShard(config: ShardEmbeddingConfig): ShardEmbeddingConfig {
  return {
    id: config.id,
    name: config.name,
    description: config.description ?? null,
    model: config.model,
    dimension: config.dimension,
    chunk_size: config.chunk_size,
    chunk_overlap: config.chunk_overlap,
    is_default: config.is_default,
  }
}

/** Convert a browser embedding to shard format. */
export function embeddingToShard(emb: {
  id: string
  note_id: string
  embedding_set_id: string
  chunk_index?: number | null
  text?: string | null
  vector: string | number[]
  model?: string | null
  model_name?: string | null
  created_at: Date | string
}): ShardEmbedding {
  return {
    id: emb.id,
    note_id: emb.note_id,
    chunk_index: emb.chunk_index ?? 0,
    text: emb.text ?? '',
    vector: typeof emb.vector === 'string' ? parseVector(emb.vector) : emb.vector,
    model: emb.model ?? emb.model_name ?? 'unknown',
    embedding_set_id: emb.embedding_set_id,
    created_at: toISOString(emb.created_at),
  }
}

/** Convert a shard embedding back to browser format. */
export function embeddingFromShard(shard: ShardEmbedding): {
  id: string
  note_id: string
  embedding_set_id: string | null
  chunk_index: number
  text: string
  vector: string
  model: string
  created_at: string | null
} {
  return {
    id: shard.id,
    note_id: shard.note_id,
    embedding_set_id: shard.embedding_set_id ?? null,
    chunk_index: shard.chunk_index,
    text: shard.text,
    vector: `[${shard.vector.join(',')}]`,
    model: shard.model,
    created_at: shard.created_at ?? null,
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

function jsonStringArray(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  }
  return []
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

function jsonString(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value)
}

function slugifyEmbeddingSet(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'embedding-set'
}
