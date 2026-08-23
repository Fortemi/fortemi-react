/**
 * Shard export pipeline — query all entities, serialize, pack into .shard archive.
 *
 * Pipeline: query DB → field-map → serialize (JSONL/JSON) → compute checksums → build manifest → tar.gz
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @depends @packages/core/src/shard/profile-registry.ts
 * @schema @packages/core/schemas/knowledge-shard.schema.receipt.json
 * @created 2026-07-17
 * @agent Codex
 */

import type { DatabaseClient } from '../storage-backend.js'
import { VERSION } from '../index.js'
import { packTarGz } from './shard-tar.js'
import { sha256Hex } from './checksum.js'
import { sidecarEntryName } from './blob-sidecar.js'
import { validateCoreV1ShardArchive } from './schema-validator.js'
import {
  CORE_V1_COMPONENTS,
  createShardCapabilityReport,
  profileSupportError,
} from './profile-registry.js'
import {
  noteToShard,
  linkToShard,
  urlLinkToShard,
  collectionToShard,
  tagsToShard,
  templateToShard,
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
import { restoreStoredPresence } from './presence.js'
import { readStoredPresence } from './presence-store.js'
import { exportFullV1Snapshot } from './full-v1-store.js'
import { exportLiveFullV1 } from './live-full-v1.js'
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
  ShardExportResult,
  ShardLossEntry,
  ShardNote,
  ShardCollection,
  ShardLink,
} from './types.js'

const encoder = new TextEncoder()
const CORE_V1_FILES = new Set([
  'notes.jsonl',
  'collections.json',
  'tags.json',
  'templates.json',
  'links.jsonl',
])
const CORE_V1_OMITTED_COMPONENTS: readonly ShardComponent[] = [
  'embedding_sets',
  'embedding_configs',
  'embedding_set_members',
  'embeddings',
  'skos_schemes',
  'skos_concepts',
  'skos_relations',
  'note_skos_tags',
  'provenance_edges',
  'graph_sources',
  'graph_edges',
  'communities',
  'community_assignments',
]

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  return value as Record<string, unknown>
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function coreV1OptionErrors(options: ExportOptions): string[] {
  const errors: string[] = []
  if (options.clusterNotesSize !== undefined) {
    errors.push('core-v1 does not declare clustered note files')
  }
  if (options.includeBlobs) {
    errors.push('core-v1 declares attachment references but not blob sidecar files')
  }
  return errors
}

function toCoreV1Note(note: ShardNote): ShardNote {
  return {
    ...note,
    revised_content: note.revised_content ?? note.original_content,
    metadata: note.metadata ?? null,
    deleted_at: note.deleted_at ?? null,
    attachments: (note.attachments ?? []).map((projection) => ({
      extracted_text: projection.extracted_text,
      extraction_status: projection.extraction_status
        ?? (projection.extracted_text === null ? 'deferred' : 'extracted'),
      reason: Object.hasOwn(projection, 'reason')
        ? projection.reason
        : (projection.extracted_text === null ? 'no_extracted_text' : null),
      attachment: projection.attachment,
    })),
  }
}

function toCoreV1Collection(collection: ShardCollection): ShardCollection {
  const coreCollection = { ...collection }
  delete coreCollection.updated_at
  delete coreCollection.deleted_at
  return coreCollection
}

function toCoreV1Link(link: ShardLink): ShardLink {
  const coreLink = { ...link }
  if (
    coreLink.metadata
    && typeof coreLink.metadata === 'object'
    && !Array.isArray(coreLink.metadata)
    && (coreLink.metadata as Record<string, unknown>).fortemi_legacy_state
  ) {
    const metadata = { ...coreLink.metadata as Record<string, unknown> }
    const state = metadata.fortemi_legacy_state
    metadata.fortemi_legacy_state = (
      state
      && typeof state === 'object'
      && !Array.isArray(state)
      && 'confidence' in state
      && state.confidence === null
    )
      ? { confidence: null }
      : undefined
    if (metadata.fortemi_legacy_state === undefined) delete metadata.fortemi_legacy_state
    coreLink.metadata = Object.keys(metadata).length > 0 ? metadata : null
  }
  return coreLink
}

async function rowCount(db: DatabaseClient, sql: string): Promise<number> {
  const result = await db.query<{ count: number | string }>(sql)
  return Number(result.rows[0]?.count ?? 0)
}

async function restoreV2Records<T extends object>(
  db: DatabaseClient,
  schemaVersion: string,
  component: ShardComponent,
  records: T[],
  idOf: (record: T) => string,
  nativePresence = false,
): Promise<T[]> {
  if (schemaVersion !== '2.0.0') return records
  if (nativePresence) return records
  return Promise.all(records.map(async (record) => {
    const document = record as Record<string, unknown>
    const presence = await readStoredPresence(
      db,
      schemaVersion,
      'core-v1',
      component,
      idOf(record),
      document,
    )
    return restoreStoredPresence(document, presence) as T
  }))
}

async function collectCoreV1Losses(
  db: DatabaseClient,
  options: ExportOptions,
): Promise<ShardLossEntry[]> {
  const losses: ShardLossEntry[] = []
  const componentCounts: Array<{
    component: ShardComponent
    table: string
  }> = [
    { component: 'embedding_sets', table: 'embedding_set' },
    { component: 'embedding_configs', table: 'embedding_config' },
    { component: 'embedding_set_members', table: 'embedding_set_member' },
    { component: 'embeddings', table: 'embedding' },
    { component: 'skos_schemes', table: 'skos_scheme' },
    { component: 'skos_concepts', table: 'skos_concept' },
    { component: 'skos_relations', table: 'skos_concept_relation' },
    { component: 'note_skos_tags', table: 'note_skos_tag' },
    { component: 'provenance_edges', table: 'provenance_edge' },
    { component: 'graph_sources', table: 'graph_source' },
    { component: 'graph_edges', table: 'graph_edge_artifact' },
    { component: 'communities', table: 'community' },
    { component: 'community_assignments', table: 'community_assignment' },
  ]
  for (const { component, table } of componentCounts) {
    const count = await rowCount(db, `SELECT COUNT(*) AS count FROM ${table}`)
    if (count > 0) {
      losses.push({
        code: 'component-outside-profile',
        component,
        count,
        message: `${count} ${component} record(s) are outside core-v1 and were omitted.`,
      })
    }
  }

  const sourceIdentities = await rowCount(db, 'SELECT COUNT(*) AS count FROM source_identity')
  if (sourceIdentities > 0) {
    losses.push({
      code: 'source-identity-outside-profile',
      count: sourceIdentities,
      field_path: 'source_identity',
      action: 'omit',
      destination_capability: 'core-v1 does not declare source-addressed identity mappings',
      message: `${sourceIdentities} source identity mapping(s) are outside core-v1 and were omitted.`,
    })
  }

  const nullRevisions = await rowCount(
    db,
    `SELECT COUNT(*) AS count
       FROM note n
       LEFT JOIN note_revised_current r ON r.note_id = n.id
       WHERE r.content IS NULL`,
  )
  if (nullRevisions > 0) {
    losses.push({
      code: 'null-revision-normalized',
      component: 'notes',
      count: nullRevisions,
      message: `${nullRevisions} null revised-content value(s) were normalized to original content as required by core-v1.`,
    })
  }

  if (options.includeEmbeddings || options.embeddingSetIds?.length) {
    losses.push({
      code: 'export-option-outside-profile',
      component: 'embeddings',
      message: 'Embedding export options were ignored because embeddings are outside core-v1.',
    })
  }
  if (options.includeMaterializedSelectors) {
    losses.push({
      code: 'export-option-outside-profile',
      component: 'embedding_set_members',
      message: 'Materialized selector metadata was omitted because it is outside core-v1.',
    })
  }
  return losses
}

export async function exportShardWithReport(
  db: DatabaseClient,
  options: ExportOptions & { profile: string },
): Promise<ShardExportResult> {
  if (options.profile === 'full-v1') {
    const capabilityReport = createShardCapabilityReport({
      backend: 'pglite', operation: 'export', requestedProfile: options.profile,
      requestedSchemaVersion: options.schemaVersion ?? null,
    })
    if (options.schemaVersion !== '2.0.0') {
      return {
        success: false, archive: null,
        errors: ['PGlite complete full-v1 production requires schemaVersion: 2.0.0.'],
        capability_report: capabilityReport,
      }
    }
    if (!options.blobStore) {
      return {
        success: false, archive: null,
        errors: ['PGlite complete full-v1 production requires a BlobStore.'],
        capability_report: capabilityReport,
      }
    }
    try {
      const persisted = await db.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM knowledge_shard_snapshot
            WHERE schema_version = '2.0.0' AND profile = 'full-v1'
         ) AS present`,
      )
      if (persisted.rows[0]?.present) {
        return exportFullV1Snapshot(db, options.blobStore)
      }
      const coreArchive = await exportShardBytes(
        db,
        { profile: 'core-v1', schemaVersion: '2.0.0' },
        { nativeSchema2Presence: true },
      )
      const legacyArchive = await exportShardBytes(db, {
        includeEmbeddings: true,
        includeMaterializedSelectors: true,
      })
      return exportLiveFullV1(db, coreArchive, legacyArchive, {
        blobStore: options.blobStore,
        signing: options.signing,
      })
    } catch (error) {
      return {
        success: false,
        archive: null,
        errors: [error instanceof Error ? error.message : String(error)],
        capability_report: capabilityReport,
      }
    }
  }
  let capabilityReport = createShardCapabilityReport({
    backend: 'pglite',
    operation: 'export',
    requestedProfile: options.profile,
    requestedSchemaVersion: options.schemaVersion ?? CURRENT_SHARD_VERSION,
    declaredComponents: options.profile === 'core-v1' ? CORE_V1_COMPONENTS : [],
    omittedComponents: options.profile === 'core-v1' ? CORE_V1_OMITTED_COMPONENTS : [],
  })
  const errors = [
    ...(profileSupportError(capabilityReport)
      ? [profileSupportError(capabilityReport)!]
      : []),
    ...(options.profile === 'core-v1' ? coreV1OptionErrors(options) : []),
  ]
  if (errors.length > 0) {
    return { success: false, archive: null, errors, capability_report: capabilityReport }
  }

  const losses = await collectCoreV1Losses(db, options)
  capabilityReport = {
    ...capabilityReport,
    losses,
  }
  try {
    const archive = await exportShardBytes(db, options)
    return {
      success: true,
      archive,
      errors: [],
      capability_report: capabilityReport,
    }
  } catch (error) {
    return {
      success: false,
      archive: null,
      errors: [error instanceof Error ? error.message : String(error)],
      capability_report: capabilityReport,
    }
  }
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
  if (options?.profile) {
    throw new Error(
      'Named portability profiles require exportShardWithReport so capability and loss data cannot be discarded',
    )
  }
  return exportShardBytes(db, options)
}

async function exportShardBytes(
  db: DatabaseClient,
  options?: ExportOptions,
  mode?: { nativeSchema2Presence?: boolean },
): Promise<Uint8Array> {
  const coreV1 = options?.profile === 'core-v1'
  const canonicalSchemaVersion = coreV1 ? (options?.schemaVersion ?? CURRENT_SHARD_VERSION) : '1.0.0'
  if (options?.profile) {
    const capabilityReport = createShardCapabilityReport({
      backend: 'pglite',
      operation: 'export',
      requestedProfile: options.profile,
      requestedSchemaVersion: options.schemaVersion ?? CURRENT_SHARD_VERSION,
      declaredComponents: coreV1 ? CORE_V1_COMPONENTS : [],
    })
    const profileError = profileSupportError(capabilityReport)
    if (profileError) throw new Error(profileError)
    const optionErrors = coreV1OptionErrors(options)
    if (optionErrors.length > 0) throw new Error(optionErrors.join('; '))
  }

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
              c.ai_metadata,
              $1::text as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN collection_note cn ON cn.note_id = n.id
       ${coreV1 ? 'JOIN collection selected_collection ON selected_collection.id = cn.collection_id AND selected_collection.deleted_at IS NULL' : ''}
       WHERE cn.collection_id = $1
       ORDER BY n.created_at`
    noteParams = [options.collectionId]
  } else if (options?.tag) {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content,
              c.ai_metadata,
              (
                SELECT cn.collection_id
                FROM collection_note cn
                ${coreV1 ? 'JOIN collection c ON c.id = cn.collection_id AND c.deleted_at IS NULL' : ''}
                WHERE cn.note_id = n.id
                ORDER BY cn.position, cn.added_at
                LIMIT 1
              ) as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN note_tag nt ON nt.note_id = n.id AND nt.tag = $1
       ORDER BY n.created_at`
    noteParams = [options.tag]
  } else {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content,
              c.ai_metadata,
              (
                SELECT cn.collection_id
                FROM collection_note cn
                ${coreV1 ? 'JOIN collection c ON c.id = cn.collection_id AND c.deleted_at IS NULL' : ''}
                WHERE cn.note_id = n.id
                ORDER BY cn.position, cn.added_at
                LIMIT 1
              ) as collection_id
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
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
    ai_metadata: Record<string, unknown> | null
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
    extraction_status: ShardAttachmentProjection['extraction_status'] | null
    extraction_reason: ShardAttachmentProjection['reason']
    content_hash: string
    size_bytes: number
    storage_path: string | null
    created_at: Date
    deleted_at: Date | null
  }>(
    `SELECT a.note_id,
            a.id,
            a.filename,
            a.mime_type,
            a.extracted_text,
            a.extraction_status,
            a.extraction_reason,
            b.content_hash,
            b.size_bytes,
            b.storage_path,
            a.created_at,
            a.deleted_at
       FROM attachment a
       JOIN attachment_blob b ON b.id = a.blob_id
       ${coreV1 ? 'WHERE a.deleted_at IS NULL' : ''}
       ORDER BY a.note_id, a.position, a.created_at`,
  )
  const attachmentsByNote = new Map<string, ShardAttachmentProjection[]>()
  for (const row of attachmentRows.rows) {
    const source: ShardAttachmentProjection = {
      extracted_text: row.extracted_text,
      ...(row.extraction_status !== null
        ? { extraction_status: row.extraction_status }
        : {}),
      ...(row.extraction_reason !== null
        ? { reason: row.extraction_reason }
        : {}),
      ...(!coreV1
        ? {
            created_at: iso(row.created_at),
            deleted_at: row.deleted_at ? iso(row.deleted_at) : null,
          }
        : {}),
      attachment: {
        // `path` is the display filename per the binary-attachment projection
        // contract — never the physical storage key (`storage_path`).
        id: row.id,
        path: row.filename,
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

  let shardNotes = notes.map((n) => {
    const shardNote = noteToShard(n)
    return coreV1 ? toCoreV1Note(shardNote) : shardNote
  })
  if (coreV1) {
    shardNotes = await restoreV2Records(
      db,
      canonicalSchemaVersion,
      'notes',
      shardNotes,
      (note) => note.id,
      mode?.nativeSchema2Presence,
    )
  }
  let layout: ShardLayout | undefined
  const clusterSize = options?.clusterNotesSize
  if (clusterSize && Number.isInteger(clusterSize) && clusterSize > 0 && shardNotes.length > 0) {
    // Clustered layout: one addressable file per `clusterSize` records (issue #189).
    const clusters: ShardClusterRef[] = []
    for (let offset = 0; offset < shardNotes.length; offset += clusterSize) {
      const slice = shardNotes.slice(offset, offset + clusterSize)
      const href = `notes/${String(offset).padStart(6, '0')}.jsonl`
      clusters.push({ href, offset })
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
    `SELECT * FROM collection ${coreV1 ? 'WHERE deleted_at IS NULL' : ''} ORDER BY position, name`,
  )
  // Get note counts per collection
  const collNoteCountRows = await db.query<{ collection_id: string; cnt: string }>(
    `SELECT collection_id, COUNT(*) as cnt FROM collection_note GROUP BY collection_id`,
  )
  const noteCountMap = new Map<string, number>()
  for (const row of collNoteCountRows.rows) {
    noteCountMap.set(row.collection_id, parseInt(row.cnt, 10))
  }

  let shardCollections = collectionRows.rows.map((c) => {
    const collection = collectionToShard(c, noteCountMap.get(c.id) ?? 0)
    return coreV1 ? toCoreV1Collection(collection) : collection
  })
  if (coreV1) {
    shardCollections = await restoreV2Records(
      db,
      canonicalSchemaVersion,
      'collections',
      shardCollections,
      (collection) => collection.id,
      mode?.nativeSchema2Presence,
    )
  }
  files.set('collections.json', encoder.encode(JSON.stringify(shardCollections)))
  components.push('collections')
  counts.collections = shardCollections.length

  // ── Query tags (unique list, scoped to exported notes) ──────────────
  const allTagRows = await db.query<{ tag: string; created_at: Date | string }>(
    `SELECT tag, MIN(created_at) AS created_at FROM note_tag GROUP BY tag ORDER BY tag`,
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
    relevantTags.map((r) => ({ name: r.tag, created_at: r.created_at })),
  )
  files.set('tags.json', encoder.encode(JSON.stringify(shardTags)))
  components.push('tags')
  counts.tags = shardTags.length

  // ── Query templates ─────────────────────────────────────────────────
  const templateRows = await db.query<{
    id: string
    name: string
    description: string | null
    content: string
    format: string
    default_tags: string[] | string
    collection_id: string | null
    created_at: Date
    updated_at: Date
  }>(`SELECT * FROM template ORDER BY created_at, id`)
  if (templateRows.rows.length > 0 || coreV1) {
    let shardTemplates = templateRows.rows.map((template) => templateToShard(template))
    if (coreV1) {
      shardTemplates = await restoreV2Records(
        db,
        canonicalSchemaVersion,
        'templates',
        shardTemplates,
        (template) => template.id,
        mode?.nativeSchema2Presence,
      )
    }
    files.set('templates.json', encoder.encode(JSON.stringify(shardTemplates)))
    components.push('templates')
    counts.templates = shardTemplates.length
  }

  // ── Query links (scoped to exported notes) ──────────────────────────
  const linkRows = await db.query<LinkRow>(
    `SELECT * FROM link ${coreV1 ? 'WHERE deleted_at IS NULL' : ''} ORDER BY created_at`,
  )
  // When filtering, only include links where both endpoints are in the export
  const filteredLinks = (options?.tag || options?.collectionId)
    ? linkRows.rows.filter((l) => exportedNoteIds.has(l.source_note_id) && exportedNoteIds.has(l.target_note_id))
    : linkRows.rows
  const urlLinkRows = await db.query<{
    id: string
    source_note_id: string
    to_url: string
    link_type: string
    confidence: number | null
    metadata_json: Record<string, unknown> | string | null
    created_at: Date
    updated_at: Date | null
    deleted_at: Date | null
  }>(`SELECT * FROM link_url_target ${coreV1 ? 'WHERE deleted_at IS NULL' : ''} ORDER BY created_at`)
  const filteredUrlLinks = (options?.tag || options?.collectionId)
    ? urlLinkRows.rows.filter((l) => exportedNoteIds.has(l.source_note_id))
    : urlLinkRows.rows
  let shardLinks = [
    ...filteredLinks.map((l) => linkToShard(l)),
    ...filteredUrlLinks.map((l) => urlLinkToShard(l)),
  ].map((link) => coreV1 ? toCoreV1Link(link) : link)
  if (coreV1) {
    shardLinks = await restoreV2Records(
      db,
      canonicalSchemaVersion,
      'links',
      shardLinks,
      (link) => link.id,
      mode?.nativeSchema2Presence,
    )
  }
  const linksJsonl = shardLinks.map((l) => JSON.stringify(l)).join('\n')
  files.set('links.jsonl', encoder.encode(linksJsonl))
  components.push('links')
  counts.links = shardLinks.length


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
      slug: string | null
      description: string | null
      purpose: string | null
      document_count: number | null
      embedding_count: number | null
      is_system: boolean
      keywords_json: unknown | null
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
      `SELECT
         es.id, es.name, es.slug, es.description, es.purpose,
         COALESCE(es.document_count, member_counts.document_count, 0)::int AS document_count,
         COALESCE(es.embedding_count, embedding_counts.embedding_count, 0)::int AS embedding_count,
         es.is_system, es.keywords_json,
         es.model_name, es.dimensions, es.kind, es.mode, es.truncate_dimension,
         es.criteria_json, es.source_json, es.compatibility_json, es.materialization_json,
         es.freshness_json, es.created_at, es.updated_at
       FROM embedding_set es
       LEFT JOIN (
         SELECT embedding_set_id, COUNT(*)::int AS document_count
         FROM embedding_set_member
         GROUP BY embedding_set_id
       ) member_counts ON member_counts.embedding_set_id = es.id
       LEFT JOIN (
         SELECT embedding_set_id, COUNT(*)::int AS embedding_count
         FROM embedding
         GROUP BY embedding_set_id
       ) embedding_counts ON embedding_counts.embedding_set_id = es.id
       ${setScoped ? 'WHERE es.id = ANY($1)' : ''}
       ORDER BY es.created_at`,
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
      chunk_index: number
      text: string
      vector: string
      model: string
      model_name: string
      created_at: Date
    }>(
      `SELECT
         e.id, e.note_id, e.embedding_set_id, e.chunk_index,
         COALESCE(NULLIF(e.text, ''), nrc.content, no.content, '') AS text,
         e.vector,
         COALESCE(e.model, es.model_name) AS model,
         es.model_name,
         e.created_at
       FROM embedding e
       JOIN embedding_set es ON es.id = e.embedding_set_id
       LEFT JOIN note_revised_current nrc ON nrc.note_id = e.note_id
       LEFT JOIN note_original no ON no.note_id = e.note_id
       ${setScoped ? 'WHERE e.embedding_set_id = ANY($1)' : ''}
       ORDER BY e.created_at`,
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

  if (coreV1) {
    for (const filename of [...files.keys()]) {
      if (!CORE_V1_FILES.has(filename)) files.delete(filename)
    }

    const tagsByName = new Map(shardTags.map((tag) => [tag.name, tag]))
    for (const template of templateRows.rows) {
      const defaultTags = Array.isArray(template.default_tags)
        ? template.default_tags
        : JSON.parse(template.default_tags) as string[]
      for (const name of defaultTags) {
        if (!tagsByName.has(name)) {
          tagsByName.set(name, {
            name,
            created_at: iso(template.created_at),
          })
        }
      }
    }
    const coreTags = [...tagsByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    files.set('tags.json', encoder.encode(JSON.stringify(coreTags)))

    components.splice(0, components.length, ...CORE_V1_COMPONENTS)
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      if (!(CORE_V1_COMPONENTS as readonly string[]).includes(key)) delete counts[key]
    }
    Object.assign(counts, {
      notes: shardNotes.length,
      collections: shardCollections.length,
      tags: coreTags.length,
      templates: templateRows.rows.length,
      links: shardLinks.length,
      embedding_sets: 0,
      embedding_set_members: 0,
      embeddings: 0,
      embedding_configs: 0,
    })
  }

  // ── Compute checksums ───────────────────────────────────────────────
  const checksums: Record<string, string> = {}
  for (const [filename, data] of files) {
    checksums[filename] = await sha256Hex(data)
  }

  // ── Build manifest ──────────────────────────────────────────────────
  const manifest: ShardManifest = {
    version: canonicalSchemaVersion,
    ...(coreV1
      ? {
          profile: 'core-v1',
          producer: {
            name: 'fortemi-react',
            version: VERSION,
          },
        }
      : { matric_version: VERSION }),
    format: SHARD_FORMAT,
    created_at: new Date().toISOString(),
    components,
    counts,
    checksums,
    min_reader_version: canonicalSchemaVersion,
    migration_history: [],
    ...(!coreV1 ? { migrated_from: null } : {}),
    ...(!coreV1 && layout ? { layout } : {}),
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))

  // ── Portable byte sidecar (Fortemi/fortemi#1046) ────────────────────
  // Optional content-addressed `blobs/<hex>` entries, one per distinct
  // attachment content hash. Deliberately excluded from `manifest.checksums`:
  // an entry's name *is* its BLAKE3 digest, so entries are self-verifying, and
  // readers must tolerate missing/unknown `blobs/` entries. A blob the store
  // cannot return is skipped — its attachment stays reference-only.
  if (options?.includeBlobs && options.blobStore) {
    const packed = new Set<string>()
    for (const row of attachmentRows.rows) {
      const checksum = row.content_hash
      if (packed.has(checksum)) continue
      packed.add(checksum)
      const bytes = await options.blobStore.read(checksum)
      if (bytes) files.set(sidecarEntryName(checksum), bytes)
    }
  }

  if (coreV1) {
    const validation = await validateCoreV1ShardArchive(files)
    if (!validation.valid) {
      throw new Error(`Generated core-v1 shard failed canonical validation: ${validation.errors.join('; ')}`)
    }
  }

  // ── Pack tar.gz ─────────────────────────────────────────────────────
  return packTarGz(files)
}
