/**
 * Shard export pipeline — query all entities, serialize, pack into .shard archive.
 *
 * Pipeline: query DB → field-map → serialize (JSONL/JSON) → compute checksums → build manifest → tar.gz
 */

import type { DatabaseClient } from '../storage-backend.js'
import { VERSION } from '../index.js'
import { packTarGz } from './shard-tar.js'
import { sha256Hex } from './checksum.js'
import {
  noteToShard,
  linkToShard,
  collectionToShard,
  tagsToShard,
  embeddingSetToShard,
  embeddingSetMemberToShard,
  embeddingConfigToShard,
  embeddingToShard,
  skosSchemeToShard,
  skosConceptToShard,
  skosRelationToShard,
  noteSkosTagToShard,
  provenanceEdgeToShard,
} from './field-mapper.js'
import type { BrowserNoteExport } from './field-mapper.js'
import type { LinkRow } from '../repositories/links-repository.js'
import type { CollectionRow } from '../repositories/collections-repository.js'
import {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
} from './types.js'
import type {
  ExportOptions,
  ShardManifest,
  ShardComponent,
  ShardClusterRef,
  ShardLayout,
  ShardAttachmentProjection,
  ShardEmbeddingConfig,
} from './types.js'

const encoder = new TextEncoder()

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Export knowledge data from the database as a .shard archive (Uint8Array).
 *
 * @param db DatabaseClient database instance
 * @param options Export options (includeEmbeddings, collectionId filter)
 * @returns Compressed shard archive bytes
 */
export async function exportShard(
  db: DatabaseClient,
  options?: ExportOptions,
): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const components: ShardComponent[] = []
  const counts: ShardManifest['counts'] = {}

  // ── Query notes ─────────────────────────────────────────────────────
  let noteQuery: string
  let noteParams: unknown[]

  if (options?.collectionId) {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content,
              $1::text as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN collection_note cn ON cn.note_id = n.id
       WHERE n.deleted_at IS NULL AND cn.collection_id = $1
       ORDER BY n.created_at`
    noteParams = [options.collectionId]
  } else if (options?.tag) {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content,
              (
                SELECT cn.collection_id
                FROM collection_note cn
                WHERE cn.note_id = n.id
                ORDER BY cn.position, cn.added_at
                LIMIT 1
              ) as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN note_tag nt ON nt.note_id = n.id AND nt.tag = $1
       WHERE n.deleted_at IS NULL
       ORDER BY n.created_at`
    noteParams = [options.tag]
  } else {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content,
              (
                SELECT cn.collection_id
                FROM collection_note cn
                WHERE cn.note_id = n.id
                ORDER BY cn.position, cn.added_at
                LIMIT 1
              ) as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.deleted_at IS NULL
       ORDER BY n.created_at`
    noteParams = []
  }

  const noteRows = await db.query<{
    id: string
    title: string | null
    format: string
    source: string
    is_starred: boolean
    is_archived: boolean
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
    original_content: string
    revised_content: string | null
    collection_id: string | null
  }>(noteQuery, noteParams)

  // Fetch tags per note
  const tagRows = await db.query<{ note_id: string; tag: string }>(
    `SELECT note_id, tag FROM note_tag ORDER BY note_id, tag`,
  )
  const tagsByNote = new Map<string, string[]>()
  for (const row of tagRows.rows) {
    const tags = tagsByNote.get(row.note_id) ?? []
    tags.push(row.tag)
    tagsByNote.set(row.note_id, tags)
  }

  const attachmentRows = await db.query<{
    note_id: string
    id: string
    filename: string
    mime_type: string | null
    extracted_text: string | null
    content_hash: string
    size_bytes: number
    storage_path: string | null
  }>(
    `SELECT a.note_id,
            a.id,
            a.filename,
            a.mime_type,
            a.extracted_text,
            b.content_hash,
            b.size_bytes,
            b.storage_path
       FROM attachment a
       JOIN attachment_blob b ON b.id = a.blob_id
       WHERE a.deleted_at IS NULL
       ORDER BY a.note_id, a.position, a.created_at`,
  )
  const attachmentsByNote = new Map<string, ShardAttachmentProjection[]>()
  for (const row of attachmentRows.rows) {
    const source: ShardAttachmentProjection = {
      extracted_text: row.extracted_text ?? '',
      attachment: {
        id: row.id,
        path: row.storage_path ?? row.filename,
        mime: row.mime_type,
        checksum: row.content_hash,
        bytes: Number(row.size_bytes),
      },
    }
    const sources = attachmentsByNote.get(row.note_id) ?? []
    sources.push(source)
    attachmentsByNote.set(row.note_id, sources)
  }

  const notes: BrowserNoteExport[] = noteRows.rows.map((row) => ({
    ...row,
    tags: tagsByNote.get(row.id) ?? [],
    attachments: attachmentsByNote.get(row.id),
  }))

  // Collect exported note IDs for scoping related data
  const exportedNoteIds = new Set(notes.map((n) => n.id))

  const shardNotes = notes.map((n) => noteToShard(n))
  let layout: ShardLayout | undefined
  const clusterSize = options?.clusterNotesSize
  if (clusterSize && Number.isInteger(clusterSize) && clusterSize > 0 && shardNotes.length > 0) {
    // Clustered layout: one addressable file per `clusterSize` records (issue #189).
    const clusters: ShardClusterRef[] = []
    for (let offset = 0; offset < shardNotes.length; offset += clusterSize) {
      const slice = shardNotes.slice(offset, offset + clusterSize)
      const href = `notes/${String(offset).padStart(6, '0')}.jsonl`
      clusters.push({ href, offset, count: slice.length })
      files.set(href, encoder.encode(slice.map((n) => JSON.stringify(n)).join('\n')))
    }
    layout = { clusters: { notes: clusters } }
  } else {
    files.set('notes.jsonl', encoder.encode(shardNotes.map((n) => JSON.stringify(n)).join('\n')))
  }
  components.push('notes')
  counts.notes = notes.length

  // ── Query collections ───────────────────────────────────────────────
  const collectionRows = await db.query<CollectionRow>(
    `SELECT * FROM collection WHERE deleted_at IS NULL ORDER BY position, name`,
  )
  // Get note counts per collection
  const collNoteCountRows = await db.query<{ collection_id: string; cnt: string }>(
    `SELECT collection_id, COUNT(*) as cnt FROM collection_note GROUP BY collection_id`,
  )
  const noteCountMap = new Map<string, number>()
  for (const row of collNoteCountRows.rows) {
    noteCountMap.set(row.collection_id, parseInt(row.cnt, 10))
  }

  const shardCollections = collectionRows.rows.map((c) =>
    collectionToShard(c, noteCountMap.get(c.id) ?? 0),
  )
  files.set('collections.json', encoder.encode(JSON.stringify(shardCollections)))
  components.push('collections')
  counts.collections = shardCollections.length

  // ── Query tags (unique list, scoped to exported notes) ──────────────
  const allTagRows = await db.query<{ tag: string }>(
    `SELECT DISTINCT tag FROM note_tag ORDER BY tag`,
  )
  // When filtering, only include tags that appear on exported notes
  const isFiltered = !!(options?.tag || options?.collectionId)
  const relevantTags = isFiltered
    ? allTagRows.rows.filter((r) => {
        for (const note of notes) {
          if (note.tags.includes(r.tag)) return true
        }
        return false
      })
    : allTagRows.rows
  const shardTags = tagsToShard(
    relevantTags.map((r) => ({ name: r.tag, created_at: new Date() })),
  )
  files.set('tags.json', encoder.encode(JSON.stringify(shardTags)))
  components.push('tags')
  counts.tags = shardTags.length

  // ── Query links (scoped to exported notes) ──────────────────────────
  const linkRows = await db.query<LinkRow>(
    `SELECT * FROM link WHERE deleted_at IS NULL ORDER BY created_at`,
  )
  // When filtering, only include links where both endpoints are in the export
  const filteredLinks = (options?.tag || options?.collectionId)
    ? linkRows.rows.filter((l) => exportedNoteIds.has(l.source_note_id) && exportedNoteIds.has(l.target_note_id))
    : linkRows.rows
  const linksJsonl = filteredLinks.map((l) => JSON.stringify(linkToShard(l))).join('\n')
  files.set('links.jsonl', encoder.encode(linksJsonl))
  components.push('links')
  counts.links = filteredLinks.length


  // ── Query SKOS (scoped to exported notes when filtered) ─────────────
  const allNoteSkosRows = await db.query<{
    id: string
    note_id: string
    concept_id: string
    created_at: Date
  }>(`SELECT * FROM note_skos_tag ORDER BY created_at`)
  const filteredNoteSkosRows = isFiltered
    ? allNoteSkosRows.rows.filter((row) => exportedNoteIds.has(row.note_id))
    : allNoteSkosRows.rows
  const referencedConceptIds = new Set(filteredNoteSkosRows.map((row) => row.concept_id))

  const allConceptRows = await db.query<{
    id: string
    scheme_id: string
    pref_label: string
    alt_labels: string[] | string | null
    definition: string | null
    created_at: Date
    updated_at: Date
  }>(`SELECT * FROM skos_concept WHERE deleted_at IS NULL ORDER BY pref_label`)
  const filteredConceptRows = isFiltered
    ? allConceptRows.rows.filter((row) => referencedConceptIds.has(row.id))
    : allConceptRows.rows
  const exportedConceptIds = new Set(filteredConceptRows.map((row) => row.id))
  const exportedSchemeIds = new Set(filteredConceptRows.map((row) => row.scheme_id))

  const allSchemeRows = await db.query<{
    id: string
    title: string
    description: string | null
    created_at: Date
    updated_at: Date
  }>(`SELECT * FROM skos_scheme WHERE deleted_at IS NULL ORDER BY title`)
  const filteredSchemeRows = isFiltered
    ? allSchemeRows.rows.filter((row) => exportedSchemeIds.has(row.id))
    : allSchemeRows.rows

  const allRelationRows = await db.query<{
    id: string
    source_concept_id: string
    target_concept_id: string
    relation_type: 'broader' | 'narrower' | 'related'
    created_at: Date
  }>(`SELECT * FROM skos_concept_relation ORDER BY created_at`)
  const filteredRelationRows = isFiltered
    ? allRelationRows.rows.filter((row) =>
        exportedConceptIds.has(row.source_concept_id) && exportedConceptIds.has(row.target_concept_id),
      )
    : allRelationRows.rows

  const shardSkosSchemes = filteredSchemeRows.map(skosSchemeToShard)
  files.set('skos_schemes.json', encoder.encode(JSON.stringify(shardSkosSchemes)))
  components.push('skos_schemes')
  counts.skos_schemes = shardSkosSchemes.length

  const shardSkosConcepts = filteredConceptRows.map(skosConceptToShard)
  files.set('skos_concepts.json', encoder.encode(JSON.stringify(shardSkosConcepts)))
  components.push('skos_concepts')
  counts.skos_concepts = shardSkosConcepts.length

  const skosRelationsJsonl = filteredRelationRows.map((row) => JSON.stringify(skosRelationToShard(row))).join('\n')
  files.set('skos_relations.jsonl', encoder.encode(skosRelationsJsonl))
  components.push('skos_relations')
  counts.skos_relations = filteredRelationRows.length

  const noteSkosJsonl = filteredNoteSkosRows.map((row) => JSON.stringify(noteSkosTagToShard(row))).join('\n')
  files.set('note_skos_tags.jsonl', encoder.encode(noteSkosJsonl))
  components.push('note_skos_tags')
  counts.note_skos_tags = filteredNoteSkosRows.length

  // ── Query provenance (scoped to exported notes when filtered) ───────
  const provenanceRows = await db.query<{
    id: string
    entity_type: string
    entity_id: string
    activity: string
    agent: string
    started_at: Date
    ended_at: Date | null
    attributes: Record<string, unknown> | string | null
  }>(`SELECT * FROM provenance_edge ORDER BY started_at`)
  const filteredProvenanceRows = isFiltered
    ? provenanceRows.rows.filter((row) => row.entity_type !== 'note' || exportedNoteIds.has(row.entity_id))
    : provenanceRows.rows
  const provenanceJsonl = filteredProvenanceRows.map((row) => JSON.stringify(provenanceEdgeToShard(row))).join('\n')
  files.set('provenance_edges.jsonl', encoder.encode(provenanceJsonl))
  components.push('provenance_edges')
  counts.provenance_edges = filteredProvenanceRows.length

  // ── Query embeddings (optional) ─────────────────────────────────────
  if (options?.includeEmbeddings) {
    const embeddingSetIds = options.embeddingSetIds?.filter(Boolean) ?? []
    const setScoped = embeddingSetIds.length > 0
    const includeMaterializedSelectors = options.includeMaterializedSelectors === true
    const embSetRows = await db.query<{
      id: string
      name: string
      purpose: string | null
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
      created_at: Date
      updated_at?: Date
    }>(
      `SELECT * FROM embedding_set
       ${setScoped ? 'WHERE id = ANY($1)' : ''}
       ORDER BY created_at`,
      setScoped ? [embeddingSetIds] : [],
    )
    const exportedSetIds = new Set(embSetRows.rows.map((row) => row.id))
    const virtualSetIds = new Set(embSetRows.rows.filter((row) => row.kind === 'virtual').map((row) => row.id))

    const shardEmbSets = embSetRows.rows.map((row) => embeddingSetToShard(
      row.kind === 'virtual' && !includeMaterializedSelectors
        ? {
            ...row,
            materialization_json: undefined,
            freshness_json: { status: 'unknown' },
          }
        : row,
    ))
    files.set('embedding_sets.json', encoder.encode(JSON.stringify(shardEmbSets)))
    components.push('embedding_sets')
    counts.embedding_sets = shardEmbSets.length

    const embeddingConfigRows = await db.query<ShardEmbeddingConfig>(
      `SELECT id, name, description, model, dimension, chunk_size, chunk_overlap, is_default
       FROM embedding_config
       ORDER BY name, id`,
    )
    if (embeddingConfigRows.rows.length > 0) {
      const shardEmbeddingConfigs = embeddingConfigRows.rows.map((row) => embeddingConfigToShard(row))
      files.set('embedding_configs.json', encoder.encode(JSON.stringify(shardEmbeddingConfigs)))
      components.push('embedding_configs')
      counts.embedding_configs = shardEmbeddingConfigs.length
    }

    const embMemberRows = await db.query<{
      embedding_set_id: string
      note_id: string
      embedding_id: string | null
      membership_type: string | null
      added_at: Date | string | null
      added_by: string | null
    }>(
      `SELECT * FROM embedding_set_member
       ${setScoped ? 'WHERE embedding_set_id = ANY($1)' : ''}`,
      setScoped ? [embeddingSetIds] : [],
    )
    const scopedEmbMemberRows = embMemberRows.rows.filter((member) =>
      exportedSetIds.has(member.embedding_set_id) &&
      exportedNoteIds.has(member.note_id) &&
      (includeMaterializedSelectors || !virtualSetIds.has(member.embedding_set_id)),
    )

    const membersJsonl = scopedEmbMemberRows
      .map((m) => JSON.stringify(embeddingSetMemberToShard(m)))
      .join('\n')
    files.set('embedding_set_members.jsonl', encoder.encode(membersJsonl))
    components.push('embedding_set_members')
    counts.embedding_set_members = scopedEmbMemberRows.length

    const embRows = await db.query<{
      id: string
      note_id: string
      embedding_set_id: string
      vector: string
      created_at: Date
    }>(
      `SELECT * FROM embedding
       ${setScoped ? 'WHERE embedding_set_id = ANY($1)' : ''}
       ORDER BY created_at`,
      setScoped ? [embeddingSetIds] : [],
    )
    const memberEmbeddingIds = new Set(
      scopedEmbMemberRows.map((member) => member.embedding_id).filter((id): id is string => Boolean(id)),
    )
    const scopedEmbRows = embRows.rows.filter((embedding) =>
      exportedSetIds.has(embedding.embedding_set_id) &&
      exportedNoteIds.has(embedding.note_id) &&
      (memberEmbeddingIds.size === 0 || memberEmbeddingIds.has(embedding.id)),
    )

    const embJsonl = scopedEmbRows.map((e) => JSON.stringify(embeddingToShard(e))).join('\n')
    files.set('embeddings.jsonl', encoder.encode(embJsonl))
    components.push('embeddings')
    counts.embeddings = scopedEmbRows.length
  }



  // -- Query graph/community artifacts (optional) ----------------------
  const graphSourceRows = await db.query<{
    id: string
    name: string
    kind: 'link' | 'similarity' | 'search' | 'manual' | 'imported'
    source_table: 'link' | 'embedding' | 'manual' | null
    embedding_set_id: string | null
    virtual_set_id: string | null
    model: string | null
    dimension: number | null
    truncate_dimension: number | null
    metric: 'cosine' | 'inner_product' | 'l2' | null
    algorithm: string | null
    parameters_json: unknown | null
    input_hash: string
    freshness_json: unknown
    created_at: Date
  }>(`SELECT * FROM graph_source ORDER BY created_at, id`)
  const graphScoped = !!options?.embeddingSetIds?.length
  const scopedGraphSourceRows = graphScoped
    ? graphSourceRows.rows.filter((row) => !row.embedding_set_id || options.embeddingSetIds?.includes(row.embedding_set_id))
    : graphSourceRows.rows
  const exportedGraphSourceIds = new Set(scopedGraphSourceRows.map((row) => row.id))
  if (scopedGraphSourceRows.length > 0) {
    const shardGraphSources = scopedGraphSourceRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      source_table: row.source_table,
      embedding_set_id: row.embedding_set_id,
      virtual_set_id: row.virtual_set_id,
      model: row.model,
      dimension: row.dimension,
      truncate_dimension: row.truncate_dimension,
      metric: row.metric,
      algorithm: row.algorithm,
      parameters: jsonObject(row.parameters_json),
      input_hash: row.input_hash,
      freshness: jsonObject(row.freshness_json) ?? { status: 'unknown' },
      created_at: iso(row.created_at),
    }))
    files.set('graph_sources.json', encoder.encode(JSON.stringify(shardGraphSources)))
    components.push('graph_sources')
    counts.graph_sources = shardGraphSources.length
  }

  const graphEdgeRows = await db.query<{
    graph_source_id: string
    from_note_id: string
    to_note_id: string
    weight: number
    kind: 'link' | 'similarity' | 'manual'
    rank: number | null
    metadata_json: unknown | null
  }>(`SELECT * FROM graph_edge_artifact ORDER BY graph_source_id, from_note_id, to_note_id, kind`)
  const scopedGraphEdgeRows = graphScoped
    ? graphEdgeRows.rows.filter((row) => exportedGraphSourceIds.has(row.graph_source_id))
    : graphEdgeRows.rows
  if (scopedGraphEdgeRows.length > 0) {
    const graphEdgesJsonl = scopedGraphEdgeRows.map((row) => JSON.stringify({
      graph_source_id: row.graph_source_id,
      from_note_id: row.from_note_id,
      to_note_id: row.to_note_id,
      weight: row.weight,
      kind: row.kind,
      rank: row.rank,
      metadata: jsonObject(row.metadata_json),
    })).join('\n')
    files.set('graph_edges.jsonl', encoder.encode(graphEdgesJsonl))
    components.push('graph_edges')
    counts.graph_edges = scopedGraphEdgeRows.length
  }

  const communitySetRows = await db.query<{
    id: string
    graph_source_id: string
    name: string
    source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
    algorithm: string | null
    parameters_json: unknown | null
    input_hash: string
    freshness_json: unknown
    created_at: Date
  }>(`SELECT * FROM community_set ORDER BY created_at, id`)
  const communityRows = await db.query<{
    id: string
    community_set_id: string
    label: string | null
    rank: number | null
    size: number | null
    confidence: number | null
    representative_note_ids: string[] | null
    metadata_json: unknown | null
  }>(`SELECT * FROM community ORDER BY community_set_id, rank NULLS LAST, id`)
  const scopedCommunitySetRows = graphScoped
    ? communitySetRows.rows.filter((row) => exportedGraphSourceIds.has(row.graph_source_id))
    : communitySetRows.rows
  const exportedCommunitySetIds = new Set(scopedCommunitySetRows.map((row) => row.id))
  const scopedCommunityRows = graphScoped
    ? communityRows.rows.filter((row) => exportedCommunitySetIds.has(row.community_set_id))
    : communityRows.rows
  if (scopedCommunitySetRows.length > 0) {
    const communitiesBySet = new Map<string, typeof communityRows.rows>()
    for (const row of scopedCommunityRows) {
      const rows = communitiesBySet.get(row.community_set_id) ?? []
      rows.push(row)
      communitiesBySet.set(row.community_set_id, rows)
    }
    const shardCommunitySets = scopedCommunitySetRows.map((row) => ({
      id: row.id,
      graph_source_id: row.graph_source_id,
      name: row.name,
      source_type: row.source_type,
      algorithm: row.algorithm,
      parameters: jsonObject(row.parameters_json),
      input_hash: row.input_hash,
      freshness: jsonObject(row.freshness_json) ?? { status: 'unknown' },
      communities: (communitiesBySet.get(row.id) ?? []).map((community) => ({
        id: community.id,
        label: community.label,
        rank: community.rank,
        size: community.size,
        confidence: community.confidence,
        representative_note_ids: community.representative_note_ids ?? [],
        metadata: jsonObject(community.metadata_json),
      })),
      created_at: iso(row.created_at),
    }))
    files.set('communities.json', encoder.encode(JSON.stringify(shardCommunitySets)))
    components.push('communities')
    counts.community_sets = shardCommunitySets.length
    counts.communities = scopedCommunityRows.length
  }

  const assignmentRows = await db.query<{
    community_set_id: string
    community_id: string
    note_id: string
    confidence: number | null
    source_type: 'precomputed' | 'dynamic-snapshot' | 'user-authored' | 'imported'
    metadata_json: unknown | null
  }>(`SELECT * FROM community_assignment ORDER BY community_set_id, community_id, note_id`)
  const scopedAssignmentRows = graphScoped
    ? assignmentRows.rows.filter((row) => exportedCommunitySetIds.has(row.community_set_id))
    : assignmentRows.rows
  if (scopedAssignmentRows.length > 0) {
    const assignmentsJsonl = scopedAssignmentRows.map((row) => JSON.stringify({
      community_set_id: row.community_set_id,
      community_id: row.community_id,
      note_id: row.note_id,
      confidence: row.confidence,
      source_type: row.source_type,
      metadata: jsonObject(row.metadata_json),
    })).join('\n')
    files.set('community_assignments.jsonl', encoder.encode(assignmentsJsonl))
    components.push('community_assignments')
    counts.community_assignments = scopedAssignmentRows.length
  }

  // ── Compute checksums ───────────────────────────────────────────────
  const checksums: Record<string, string> = {}
  for (const [filename, data] of files) {
    checksums[filename] = await sha256Hex(data)
  }

  // ── Build manifest ──────────────────────────────────────────────────
  const manifest: ShardManifest = {
    version: CURRENT_SHARD_VERSION,
    matric_version: VERSION,
    format: SHARD_FORMAT,
    created_at: new Date().toISOString(),
    components,
    counts,
    checksums,
    min_reader_version: '1.0.0',
    ...(layout ? { layout } : {}),
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))

  // ── Pack tar.gz ─────────────────────────────────────────────────────
  return packTarGz(files)
}
