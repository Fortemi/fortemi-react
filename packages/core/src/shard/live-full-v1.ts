import { v5 as uuidv5 } from 'uuid'
import { VERSION } from '../index.js'
import { computeBlobHash } from '../hash.js'
import type { DatabaseClient } from '../storage-backend.js'
import { SIDECAR_PREFIX } from './blob-sidecar.js'
import { sha256Hex } from './checksum.js'
import { componentPresenceLosses, presenceLosses } from './presence.js'
import { createShardCapabilityReport } from './profile-registry.js'
import {
  FULL_V1_COMPONENT_FILES,
  validateFullV1ShardArchive,
} from './schema-validator.js'
import { SIGNATURE_ENTRY, signShard } from './shard-signature.js'
import { packTarGz, unpackTarGz } from './shard-tar.js'
import type {
  ExportOptions,
  ShardComponent,
  ShardExportResult,
  ShardLossEntry,
  ShardManifest,
} from './types.js'

type JsonObject = Record<string, unknown>
type LiveFullV1Options = {
  blobStore: NonNullable<ExportOptions['blobStore']>
  signing?: ExportOptions['signing']
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function jsonObject(value: unknown): JsonObject | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return JSON.parse(value) as JsonObject
  return value as JsonObject
}

function jsonArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return JSON.parse(value) as unknown[]
  return Array.isArray(value) ? value : []
}

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'
}

function readRecords(
  files: Map<string, Uint8Array>,
  component: ShardComponent,
): JsonObject[] {
  const spec = FULL_V1_COMPONENT_FILES[component]
  const bytes = files.get(spec.file)
  if (!bytes || bytes.byteLength === 0) return []
  const text = decoder.decode(bytes)
  return spec.encoding === 'json-array'
    ? JSON.parse(text) as JsonObject[]
    : text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonObject)
}

function writeRecords(
  files: Map<string, Uint8Array>,
  component: ShardComponent,
  records: readonly JsonObject[],
): void {
  const spec = FULL_V1_COMPONENT_FILES[component]
  const text = spec.encoding === 'json-array'
    ? JSON.stringify(records)
    : records.map((record) => JSON.stringify(record)).join('\n')
  files.set(spec.file, encoder.encode(text))
}

async function liveRepresentationLosses(db: DatabaseClient): Promise<ShardLossEntry[]> {
  const tables = [
    ['collection', 'collections'],
    ['link', 'links'],
    ['link_url_target', 'links'],
    ['attachment', 'notes'],
    ['skos_scheme', 'skos_schemes'],
    ['skos_concept', 'skos_concepts'],
  ] as const
  const losses: ShardLossEntry[] = []
  for (const [table, component] of tables) {
    const result = await db.query<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE deleted_at IS NOT NULL`,
    )
    const count = Number(result.rows[0]?.count ?? 0)
    if (count > 0) {
      losses.push({
        code: 'unrepresentable-live-tombstone',
        component,
        count,
        message: `${count} ${table} tombstone(s) have no full-v1 wire field`,
        action: 'reject',
        reason: 'full-v1-live-production',
      })
    }
  }
  const nullRevisions = await db.query<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM note_revised_current WHERE content IS NULL',
  )
  const nullRevisionCount = Number(nullRevisions.rows[0]?.count ?? 0)
  if (nullRevisionCount > 0) {
    losses.push({
      code: 'unrepresentable-live-null-revision',
      component: 'note_revised_current',
      count: nullRevisionCount,
      field_path: '/content',
      source_state: 'null',
      destination_capability: 'full-v1 requires note_revised_current.content to be a string',
      message: `${nullRevisionCount} current revision(s) have null content`,
      action: 'reject',
      reason: 'full-v1-live-production',
    })
  }
  const vectorDimensions = await db.query<{
    dimension: number | string
    count: number | string
  }>(
    `SELECT vector_dims(vector)::int AS dimension, COUNT(*)::int AS count
       FROM embedding
      GROUP BY vector_dims(vector)
      ORDER BY vector_dims(vector)`,
  )
  for (const row of vectorDimensions.rows) {
    const dimension = Number(row.dimension)
    if (dimension === 768) continue
    const count = Number(row.count)
    losses.push({
      code: 'unrepresentable-live-embedding-dimension',
      component: 'embeddings',
      count,
      field_path: '/vector',
      source_state: 'value',
      destination_capability: 'full-v1 requires exactly 768 vector dimensions',
      message: `${count} embedding vector(s) have ${dimension} dimensions`,
      action: 'reject',
      reason: 'full-v1-live-production',
    })
  }
  const unsupportedProvenance = await db.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count
       FROM provenance_edge
      WHERE entity_type NOT IN ('note', 'revision')`,
  )
  const unsupportedProvenanceCount = Number(unsupportedProvenance.rows[0]?.count ?? 0)
  if (unsupportedProvenanceCount > 0) {
    losses.push({
      code: 'unrepresentable-live-provenance-entity',
      component: 'provenance_activities',
      count: unsupportedProvenanceCount,
      field_path: '/note_id',
      source_state: 'value',
      destination_capability: 'full-v1 activities identify note or revision entities',
      message: `${unsupportedProvenanceCount} provenance activity row(s) target another entity type`,
      action: 'reject',
      reason: 'full-v1-live-production',
    })
  }
  return losses
}

async function noteHistoryRecords(
  db: DatabaseClient,
): Promise<Pick<Record<ShardComponent, JsonObject[]>,
  'note_originals' | 'note_original_history' | 'note_revised_current' | 'note_revisions'>> {
  const originals = await db.query<{
    id: string
    note_id: string
    content: string
    content_hash: string
    created_at: Date | string
  }>('SELECT * FROM note_original ORDER BY created_at, id')
  const revisions = await db.query<{
    id: string
    note_id: string
    revision_number: number
    type: string
    content: string
    ai_metadata: unknown
    model: string | null
    created_at: Date | string
  }>('SELECT * FROM note_revision ORDER BY note_id, revision_number, id')
  const current = await db.query<{
    note_id: string
    content: string | null
    ai_metadata: unknown
  }>('SELECT note_id, content, ai_metadata FROM note_revised_current ORDER BY note_id')

  const previousByNote = new Map<string, string>()
  const lastByNote = new Map<string, string>()
  const revisionRecords = revisions.rows.map((row) => {
    const metadata = jsonObject(row.ai_metadata)
    const parentRevisionId = previousByNote.get(row.note_id) ?? null
    previousByNote.set(row.note_id, row.id)
    lastByNote.set(row.note_id, row.id)
    const userEdited = metadata?.is_user_edited === true || row.type === 'user'
    return {
      id: row.id,
      note_id: row.note_id,
      parent_revision_id: parentRevisionId,
      revision_number: Number(row.revision_number),
      content: row.content,
      type: row.type,
      summary: typeof metadata?.summary === 'string' ? metadata.summary : null,
      rationale: typeof metadata?.rationale === 'string' ? metadata.rationale : null,
      created_at_utc: iso(row.created_at),
      ai_generated_at: userEdited ? null : iso(row.created_at),
      user_last_edited_at: userEdited ? iso(row.created_at) : null,
      is_user_edited: userEdited,
      generation_count: Math.max(1, Number(row.revision_number)),
      model: row.model,
    }
  })
  return {
    note_originals: originals.rows.map((row) => ({
      id: row.id,
      note_id: row.note_id,
      content: row.content,
      hash: row.content_hash,
      user_created_at: iso(row.created_at),
      user_last_edited_at: iso(row.created_at),
      version_number: 1,
    })),
    note_original_history: [],
    note_revised_current: current.rows.map((row) => ({
      note_id: row.note_id,
      content: row.content,
      last_revision_id: lastByNote.get(row.note_id) ?? null,
      ai_metadata: row.ai_metadata ?? null,
    })),
    note_revisions: revisionRecords,
  }
}

async function embeddingRecords(
  db: DatabaseClient,
  legacy: Map<string, Uint8Array>,
): Promise<Pick<Record<ShardComponent, JsonObject[]>,
  'embedding_configs' | 'embedding_sets' | 'embedding_set_members' | 'embeddings'>> {
  const configs = await db.query<{
    id: string
    name: string
    description: string | null
    model: string
    dimension: number
    chunk_size: number
    chunk_overlap: number
    is_default: boolean
    created_at: Date | string
    updated_at: Date | string
  }>('SELECT * FROM embedding_config ORDER BY name, id')
  const sets = readRecords(legacy, 'embedding_sets')
  return {
    embedding_configs: configs.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      model: row.model,
      dimension: Number(row.dimension),
      chunk_size: Number(row.chunk_size),
      chunk_overlap: Number(row.chunk_overlap),
      hnsw_m: null,
      hnsw_ef_construction: null,
      ivfflat_lists: null,
      is_default: row.is_default,
      supports_mrl: null,
      matryoshka_dims: null,
      default_truncate_dim: null,
      provider: null,
      provider_config: null,
      content_types: null,
      strengths: null,
      limitations: null,
      recommended_for: null,
      benchmark_scores: null,
      is_available: null,
      document_composition: {},
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    })),
    embedding_sets: sets.map((row) => ({
      id: row.id,
      name: row.name,
      slug: typeof row.slug === 'string' && row.slug ? row.slug : slug(String(row.name)),
      description: row.description ?? null,
      purpose: row.purpose ?? null,
      usage_hints: null,
      keywords: row.keywords ?? null,
      set_type: row.kind === 'virtual' || row.kind === 'filter' ? 'filter' : 'full',
      mode: row.mode ?? (row.kind === 'virtual' ? 'auto' : 'manual'),
      criteria: row.criteria ?? null,
      embedding_config_id: null,
      truncate_dim: row.truncate_dimension ?? null,
      auto_embed_rules: null,
      index_status: Number(row.embedding_count ?? 0) > 0 ? 'ready' : 'empty',
      index_type: null,
      last_indexed_at: null,
      document_count: row.document_count ?? null,
      embedding_count: row.embedding_count ?? null,
      embeddings_current: null,
      index_size_bytes: null,
      is_system: row.is_system ?? null,
      is_active: true,
      auto_refresh: null,
      refresh_interval: null,
      last_refresh_at: null,
      agent_metadata: (
        row.source || row.compatibility || row.materialization || row.freshness
      ) ? {
          source: row.source ?? null,
          compatibility: row.compatibility ?? null,
          materialization: row.materialization ?? null,
          freshness: row.freshness ?? null,
        } : null,
      created_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
      created_by: null,
    })),
    embedding_set_members: readRecords(legacy, 'embedding_set_members').map((row) => ({
      embedding_set_id: row.embedding_set_id,
      note_id: row.note_id,
      membership_type: row.membership_type ?? null,
      added_at: row.added_at ?? null,
      added_by: row.added_by ?? null,
    })),
    embeddings: readRecords(legacy, 'embeddings').map((row) => ({
      id: row.id,
      note_id: row.note_id,
      embedding_set_id: row.embedding_set_id,
      chunk_index: Number(row.chunk_index ?? 0),
      text: row.text ?? '',
      vector: row.vector,
      model: row.model,
      created_at: row.created_at,
    })),
  }
}

function skosRecords(
  legacy: Map<string, Uint8Array>,
): Pick<Record<ShardComponent, JsonObject[]>,
  'skos_schemes' | 'skos_concepts' | 'skos_labels' | 'skos_notes'
  | 'skos_relations' | 'skos_mapping_relations' | 'skos_scheme_memberships'
  | 'note_skos_tags' | 'skos_collections' | 'skos_collection_members'> {
  const sourceSchemes = readRecords(legacy, 'skos_schemes')
  const sourceConcepts = readRecords(legacy, 'skos_concepts')
  const labels: JsonObject[] = []
  const notes: JsonObject[] = []
  const memberships: JsonObject[] = []
  const concepts = sourceConcepts.map((row) => {
    const conceptId = String(row.id)
    const schemeId = String(row.scheme_id)
    const createdAt = String(row.created_at)
    labels.push({
      id: uuidv5(`fortemi-react:skos-label:${conceptId}:pref`, uuidv5.URL),
      concept_id: conceptId,
      label_type: 'pref_label',
      value: row.pref_label,
      language: 'und',
      created_at: createdAt,
    })
    for (const [index, value] of jsonArray(row.alt_labels).entries()) {
      labels.push({
        id: uuidv5(`fortemi-react:skos-label:${conceptId}:alt:${index}`, uuidv5.URL),
        concept_id: conceptId,
        label_type: 'alt_label',
        value,
        language: 'und',
        created_at: createdAt,
      })
    }
    if (typeof row.definition === 'string') {
      notes.push({
        id: uuidv5(`fortemi-react:skos-note:${conceptId}:definition`, uuidv5.URL),
        concept_id: conceptId,
        note_type: 'definition',
        value: row.definition,
        language: 'und',
        author: null,
        source: null,
        created_at: createdAt,
        updated_at: row.updated_at,
      })
    }
    memberships.push({
      concept_id: conceptId,
      scheme_id: schemeId,
      is_top_concept: false,
      added_at: createdAt,
    })
    return {
      id: conceptId,
      primary_scheme_id: schemeId,
      uri: null,
      notation: null,
      facet_type: null,
      facet_source: null,
      facet_domain: null,
      facet_scope: null,
      status: 'approved',
      promoted_at: createdAt,
      deprecated_at: null,
      deprecation_reason: null,
      replaced_by_id: null,
      note_count: 0,
      first_used_at: null,
      last_used_at: null,
      depth: 0,
      broader_count: 0,
      narrower_count: 0,
      related_count: 0,
      antipatterns: null,
      antipattern_checked_at: null,
      created_at: createdAt,
      updated_at: row.updated_at,
      embedding: null,
      embedding_model: null,
      embedded_at: null,
    }
  })
  return {
    skos_schemes: sourceSchemes.map((row) => ({
      id: row.id,
      uri: null,
      notation: slug(String(row.title)),
      title: row.title,
      description: row.description ?? null,
      creator: null,
      publisher: null,
      rights: null,
      version: null,
      is_active: true,
      is_system: false,
      created_at: row.created_at,
      updated_at: row.updated_at,
      issued_at: null,
      modified_at: null,
      embedding: null,
      embedding_model: null,
      embedded_at: null,
    })),
    skos_concepts: concepts,
    skos_labels: labels,
    skos_notes: notes,
    skos_relations: readRecords(legacy, 'skos_relations').map((row) => ({
      id: row.id,
      subject_id: row.source_concept_id,
      object_id: row.target_concept_id,
      relation_type: row.relation_type,
      inference_score: null,
      is_inferred: false,
      is_validated: true,
      created_at: row.created_at,
      created_by: null,
    })),
    skos_mapping_relations: [],
    skos_scheme_memberships: memberships,
    note_skos_tags: readRecords(legacy, 'note_skos_tags').map((row) => ({
      note_id: row.note_id,
      concept_id: row.concept_id,
      source: 'fortemi-react',
      confidence: null,
      relevance_score: null,
      is_primary: false,
      created_at: row.created_at,
      created_by: null,
    })),
    skos_collections: [],
    skos_collection_members: [],
  }
}

async function provenanceActivities(db: DatabaseClient): Promise<JsonObject[]> {
  const rows = await db.query<{
    id: string
    entity_type: string
    entity_id: string
    activity: string
    agent: string
    started_at: Date | string
    ended_at: Date | string | null
    attributes: unknown
  }>('SELECT * FROM provenance_edge ORDER BY started_at, id')
  return rows.rows.map((row) => ({
    id: row.id,
    note_id: row.entity_type === 'note' ? row.entity_id : null,
    revision_id: row.entity_type === 'revision' ? row.entity_id : null,
    activity_type: row.activity,
    model_name: row.agent,
    started_at: iso(row.started_at),
    ended_at: iso(row.ended_at),
    metadata: jsonObject(row.attributes),
  }))
}

export async function exportLiveFullV1(
  db: DatabaseClient,
  coreArchive: Uint8Array,
  legacyArchive: Uint8Array,
  options: LiveFullV1Options,
): Promise<ShardExportResult> {
  let capability = createShardCapabilityReport({
    backend: 'pglite',
    operation: 'export',
    requestedProfile: 'full-v1',
    requestedSchemaVersion: '2.0.0',
    declaredComponents: Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[],
  })
  const losses = await liveRepresentationLosses(db)
  if (losses.length > 0) {
    capability = { ...capability, losses }
    return {
      success: false,
      archive: null,
      errors: ['Live PGlite state cannot be represented exactly by the full-v1 wire contract.'],
      capability_report: capability,
    }
  }

  const core = unpackTarGz(coreArchive)
  const legacy = unpackTarGz(legacyArchive)
  const records = Object.fromEntries(
    (Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[])
      .map((component) => [component, [] as JsonObject[]]),
  ) as Record<ShardComponent, JsonObject[]>
  for (const component of ['notes', 'collections', 'tags', 'templates', 'links'] as const) {
    records[component] = readRecords(core, component)
  }
  Object.assign(records, await noteHistoryRecords(db))
  Object.assign(records, await embeddingRecords(db, legacy))
  Object.assign(records, skosRecords(legacy))
  records.provenance_activities = await provenanceActivities(db)
  records.graph_sources = readRecords(legacy, 'graph_sources').map((row) => ({
    ...row,
    parameters: row.parameters ?? null,
  }))
  records.graph_edges = readRecords(legacy, 'graph_edges').map((row) => ({
    ...row,
    metadata: row.metadata ?? null,
  }))
  records.communities = readRecords(legacy, 'communities').map((row) => ({
    ...row,
    parameters: row.parameters ?? null,
    communities: jsonArray(row.communities).map((community) => ({
      ...(community as JsonObject),
      metadata: (community as JsonObject).metadata ?? null,
    })),
  }))
  records.community_assignments = readRecords(legacy, 'community_assignments').map((row) => ({
    ...row,
    metadata: row.metadata ?? null,
  }))

  const files = new Map<string, Uint8Array>()
  for (const component of Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[]) {
    writeRecords(files, component, records[component])
  }
  const runtimeLosses = (Object.keys(records) as ShardComponent[]).flatMap((component) =>
    componentPresenceLosses('full-v1', component, records[component]),
  )
  if (runtimeLosses.length > 0) {
    capability = { ...capability, losses: runtimeLosses }
    return {
      success: false,
      archive: null,
      errors: ['Live PGlite state violates full-v1 presence authority.'],
      capability_report: capability,
    }
  }

  const counts: ShardManifest['counts'] = {}
  for (const component of Object.keys(records) as ShardComponent[]) {
    counts[component] = records[component].length
  }
  counts.community_sets = records.communities.length
  counts.communities = records.communities.reduce((total, record) =>
    total + (Array.isArray(record.communities) ? record.communities.length : 0), 0)

  const checksums: Record<string, string> = {}
  for (const [path, bytes] of files) checksums[path] = await sha256Hex(bytes)
  const manifest: ShardManifest = {
    version: '2.0.0',
    profile: 'full-v1',
    producer: {
      name: 'fortemi-react-live-pglite',
      version: VERSION,
    },
    format: 'matric-shard',
    created_at: new Date().toISOString(),
    components: Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[],
    counts,
    checksums,
    min_reader_version: '2.0.0',
    migration_history: [],
  }
  const manifestLosses = presenceLosses(
    'full-v1',
    'manifest',
    manifest as unknown as JsonObject,
  )
  if (manifestLosses.length > 0) {
    capability = { ...capability, losses: manifestLosses }
    return {
      success: false,
      archive: null,
      errors: ['Generated live full-v1 manifest violates presence authority.'],
      capability_report: capability,
    }
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))

  for (const note of records.notes) {
    const attachments = Array.isArray(note.attachments) ? note.attachments : []
    for (const projection of attachments) {
      const checksum = (
        projection as { attachment?: { checksum?: unknown } }
      ).attachment?.checksum
      if (typeof checksum !== 'string') continue
      const bytes = await options.blobStore.read(checksum)
      if (!bytes || computeBlobHash(bytes) !== checksum) {
        return {
          success: false,
          archive: null,
          errors: [`BlobStore cannot reproduce mandatory live attachment ${checksum}.`],
          capability_report: capability,
        }
      }
      const bare = checksum.includes(':') ? checksum.slice(checksum.indexOf(':') + 1) : checksum
      files.set(`${SIDECAR_PREFIX}${bare}`, new Uint8Array(bytes))
    }
  }
  if (options.signing) {
    files.set(SIGNATURE_ENTRY, await signShard({
      files,
      keyId: options.signing.keyId,
      privateKey: options.signing.privateKey,
      publicKey: options.signing.publicKey,
    }))
  }

  const validation = await validateFullV1ShardArchive(files)
  if (!validation.valid) {
    return {
      success: false,
      archive: null,
      errors: [`Generated live full-v1 archive failed validation: ${validation.errors.join('; ')}`],
      capability_report: capability,
    }
  }
  return {
    success: true,
    archive: packTarGz(files),
    errors: [],
    capability_report: capability,
  }
}
