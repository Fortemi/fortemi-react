import { VERSION } from '../index.js'
import { computeBlobHash } from '../hash.js'
import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import { sidecarEntryName } from './blob-sidecar.js'
import { sha256Hex } from './checksum.js'
import { componentPresenceLosses, presenceLosses } from './presence.js'
import { createShardCapabilityReport } from './profile-registry.js'
import { FULL_V1_COMPONENT_FILES, validateFullV1ShardArchive, validateShardComponentRecord } from './schema-validator.js'
import { SIGNATURE_ENTRY, signShard } from './shard-signature.js'
import { packTarGz } from './shard-tar.js'
import { readNativeCore } from './native-core.js'
import { readNativeNoteHistory } from './native-note-history.js'
import { readNativeEmbeddings } from './native-embeddings.js'
import { readNativeSkos } from './native-skos.js'
import { readNativeProvenance } from './native-provenance.js'
import { readNativeGraph } from './native-graph.js'
import type { NativeState } from './native-full-v1-import.js'
import { readNativeLineage } from './native-lineage.js'
import type { ExportOptions, ShardComponent, ShardExportResult, ShardLossEntry, ShardManifest } from './types.js'

type JsonObject = Record<string, unknown>
type ScopeSets = {
  noteIds?: ReadonlySet<string>; embeddingSetIds?: ReadonlySet<string>; conceptIds?: ReadonlySet<string>
  collectionIds?: ReadonlySet<string>; schemeIds?: ReadonlySet<string>
}
type LiveFullV1Options = ExportOptions & { blobStore: NonNullable<ExportOptions['blobStore']> }
const components = Object.keys(FULL_V1_COMPONENT_FILES) as (keyof NativeState)[]
const encoder = new TextEncoder()
const scoped = (values: ReadonlySet<string> | undefined) => values ? [...values] : undefined
const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id))
const nullableIn = (set: ReadonlySet<string>, value: string | null) => value === null || set.has(value)

async function liveRepresentationLosses(
  db: QueryExecutor,
  scope: ScopeSets = {},
): Promise<ShardLossEntry[]> {
  const tables = [
    ['collection', 'collections'],
    ['link', 'links'],
    ['link_url_target', 'links'],
    ['attachment', 'notes'],
    ['skos_scheme', 'skos_schemes'],
    ['skos_concept', 'skos_concepts'],
  ] as const
  const losses: ShardLossEntry[] = []
  // These fields are native display projections, not separate full-v1 fields.
  // Compare against the same ordering/fallback used by refresh_skos_concept_display.
  const conceptIds = scoped(scope.conceptIds)
  const projectionDrift = await db.query<{ count: number | string }>(`
    SELECT COUNT(*) AS count FROM skos_concept c
    WHERE c.deleted_at IS NULL ${conceptIds ? 'AND c.id = ANY($1::text[])' : ''}
      AND (c.pref_label IS DISTINCT FROM COALESCE(
        (SELECT value FROM skos_concept_label WHERE concept_id = c.id AND label_type = 'pref_label'
          ORDER BY (language = 'en') DESC, language, id LIMIT 1), c.notation, c.id)
        OR c.alt_labels IS DISTINCT FROM COALESCE(
          (SELECT jsonb_agg(value ORDER BY language, id) FROM skos_concept_label
            WHERE concept_id = c.id AND label_type = 'alt_label'), '[]'::jsonb)
        OR c.definition IS DISTINCT FROM
          (SELECT value FROM skos_concept_note WHERE concept_id = c.id AND note_type = 'definition'
            ORDER BY (language = 'en') DESC, language, id LIMIT 1))`, conceptIds ? [conceptIds] : [])
  const projectionCount = Number(projectionDrift.rows[0]?.count ?? 0)
  if (projectionCount) losses.push({ code: 'unrepresentable-live-skos-projection', component: 'skos_concepts',
    count: projectionCount, action: 'reject', reason: 'full-v1-live-production',
    message: 'Selected SKOS display fields differ from their native labels and notes.' })
  for (const [table, component] of tables) {
    const noteIds = scoped(scope.noteIds)
    let sql = `SELECT COUNT(*) AS count FROM ${table} WHERE deleted_at IS NOT NULL`
    let params: unknown[] = []
    if (noteIds) {
      if (noteIds.length === 0) continue
      if (table === 'attachment') {
        sql += ' AND note_id = ANY($1)'
        params = [noteIds]
      } else if (table === 'link') {
        sql += ' AND source_note_id = ANY($1) AND target_note_id = ANY($1)'
        params = [noteIds]
      } else if (table === 'link_url_target') {
        sql += ' AND source_note_id = ANY($1)'
        params = [noteIds]
      } else if (table === 'collection') {
        sql += ' AND id = ANY($1::text[])'
        params = [scoped(scope.collectionIds) ?? []]
      } else if (table === 'skos_concept') {
        sql += ' AND id = ANY($1::text[])'
        params = [scoped(scope.conceptIds) ?? []]
      } else if (table === 'skos_scheme') {
        sql += ' AND id = ANY($1::text[])'
        params = [scoped(scope.schemeIds) ?? []]
      }
    }
    const result = await db.query<{ count: number | string }>(
      sql,
      params,
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
  const noteIds = scoped(scope.noteIds)
  const embeddingSetIds = scoped(scope.embeddingSetIds)
  const virtualSets = await db.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM embedding_set WHERE kind = 'virtual' AND shard_export_present
      ${embeddingSetIds ? 'AND id = ANY($1::text[])' : ''}`, embeddingSetIds ? [embeddingSetIds] : [])
  const virtualCount = Number(virtualSets.rows[0]?.count ?? 0)
  if (virtualCount) losses.push({ code: 'unrepresentable-live-virtual-embedding-set', component: 'embedding_sets',
    count: virtualCount, action: 'reject', reason: 'full-v1-live-production',
    message: 'Virtual embedding definitions have no full-v1 native set representation.' })
  const nullRevisions = await db.query<{ count: number | string }>(
    noteIds
      ? noteIds.length === 0
        ? 'SELECT 0 AS count'
        : 'SELECT COUNT(*) AS count FROM note_revised_current WHERE content IS NULL AND note_id = ANY($1)'
      : 'SELECT COUNT(*) AS count FROM note_revised_current WHERE content IS NULL',
    noteIds && noteIds.length > 0 ? [noteIds] : [],
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
  const vectorConditions: string[] = []
  const vectorParams: unknown[] = []
  if (noteIds) {
    if (noteIds.length === 0) {
      vectorConditions.push('FALSE')
    } else {
      vectorParams.push(noteIds)
      vectorConditions.push(`note_id = ANY($${vectorParams.length})`)
    }
  }
  if (embeddingSetIds) {
    if (embeddingSetIds.length === 0) {
      vectorConditions.push('FALSE')
    } else {
      vectorParams.push(embeddingSetIds)
      vectorConditions.push(`embedding_set_id = ANY($${vectorParams.length})`)
    }
  }
  const vectorDimensions = await db.query<{
    dimension: number | string | null
    count: number | string
  }>(
    `SELECT vector_dims(vector)::int AS dimension, COUNT(*)::int AS count
       FROM embedding
      ${vectorConditions.length > 0 ? `WHERE ${vectorConditions.join(' AND ')}` : ''}
      GROUP BY vector_dims(vector)
      ORDER BY vector_dims(vector)`,
    vectorParams,
  )
  for (const row of vectorDimensions.rows) {
    if (row.dimension === null) continue
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
    noteIds
      ? noteIds.length === 0
        ? 'SELECT 0 AS count'
        : `SELECT COUNT(*) AS count
             FROM provenance_edge pe
            WHERE note_id IS NULL
              AND (
                (pe.entity_type = 'note' AND pe.entity_id = ANY($1))
                OR EXISTS (
                  SELECT 1 FROM note_revision nr
                   WHERE nr.id = pe.entity_id AND nr.note_id = ANY($1)
                )
              )`
      : `SELECT COUNT(*) AS count
       FROM provenance_edge
      WHERE note_id IS NULL`,
    noteIds && noteIds.length > 0 ? [noteIds] : [],
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


/** Close selected native roots without ever adding another note to the scope.
 * Shared registries follow actual references; cross-scope relationships are
 * excluded. Nested representative IDs follow the same note boundary. */
function closeNativeScope(state: NativeState, noteScoped: boolean, selectedSetIds?: readonly string[]): NativeState {
  const noteIds = ids(state.notes)
  const requestedSets = selectedSetIds ? new Set(selectedSetIds.map((id) => id.toLowerCase())) : undefined
  const usedSets = new Set([
    ...state.embedding_set_members.filter((row) => noteIds.has(row.note_id)).map((row) => row.embedding_set_id),
    ...state.embeddings.filter((row) => row.note_id !== null && noteIds.has(row.note_id)).flatMap((row) => row.embedding_set_id === null ? [] : [row.embedding_set_id]),
  ])
  state.embedding_sets = state.embedding_sets.filter((row) => (!requestedSets || requestedSets.has(row.id)) && (!noteScoped || usedSets.has(row.id)))
  const setIds = ids(state.embedding_sets)
  state.embeddings = state.embeddings.filter((row) => (!noteScoped || row.note_id !== null && noteIds.has(row.note_id))
    && (row.embedding_set_id === null ? !requestedSets : setIds.has(row.embedding_set_id)))
  state.embedding_set_members = state.embedding_set_members.filter((row) => setIds.has(row.embedding_set_id) && (!noteScoped || noteIds.has(row.note_id)))
  if (noteScoped || requestedSets) {
    const configs = new Set(state.embedding_sets.flatMap((row) => row.embedding_config_id === null ? [] : [row.embedding_config_id]))
    state.embedding_configs = state.embedding_configs.filter((row) => configs.has(row.id))
  }

  const allowedSources = new Set(state.graph_sources.filter((row) => !requestedSets || row.embedding_set_id === null || setIds.has(row.embedding_set_id)).map((row) => row.id))
  state.graph_edges = state.graph_edges.filter((row) => allowedSources.has(row.graph_source_id)
    && (!noteScoped || noteIds.has(row.from_note_id) && noteIds.has(row.to_note_id)))
  state.community_assignments = state.community_assignments.filter((row) => !noteScoped || noteIds.has(row.note_id))
  const usedCommunitySets = new Set(state.community_assignments.map((row) => row.community_set_id))
  state.communities = state.communities.filter((row) => allowedSources.has(row.graph_source_id) && (!noteScoped || usedCommunitySets.has(row.id)))
  if (noteScoped) state.communities = state.communities.map((row) => ({ ...row, communities: row.communities.map((community) => ({
    ...community, representative_note_ids: community.representative_note_ids === null ? null : community.representative_note_ids.filter((id) => noteIds.has(id)),
  })) }))
  const communitySets = ids(state.communities)
  state.community_assignments = state.community_assignments.filter((row) => communitySets.has(row.community_set_id))
  const usedSources = new Set([...state.graph_edges.map((row) => row.graph_source_id), ...state.communities.map((row) => row.graph_source_id)])
  state.graph_sources = state.graph_sources.filter((row) => allowedSources.has(row.id) && (!noteScoped || usedSources.has(row.id)))

  if (!noteScoped) return state
  const collectionIds = new Set(state.notes.flatMap((row) => row.collection_id === null ? [] : [row.collection_id]))
  const collections = new Map(state.collections.map((row) => [row.id, row]))
  for (const id of collectionIds) {
    const parent = collections.get(id)?.parent_id
    if (parent) collectionIds.add(parent)
  }
  state.collections = state.collections.filter((row) => collectionIds.has(row.id))
  state.templates = state.templates.filter((row) => row.collection_id !== null && collectionIds.has(row.collection_id))
  const tags = new Set(state.notes.flatMap((note) => note.tags))
  state.tags = state.tags.filter((row) => tags.has(row.name))
  state.links = state.links.filter((row) => noteIds.has(row.from_note_id) && nullableIn(noteIds, row.to_note_id))

  state.note_skos_tags = state.note_skos_tags.filter((row) => noteIds.has(row.note_id))
  const conceptIds = new Set(state.note_skos_tags.map((row) => row.concept_id))
  const concepts = new Map(state.skos_concepts.map((row) => [row.id, row]))
  for (const id of conceptIds) {
    const replacement = concepts.get(id)?.replaced_by_id
    if (replacement) conceptIds.add(replacement)
  }
  state.skos_concepts = state.skos_concepts.filter((row) => conceptIds.has(row.id))
  state.skos_labels = state.skos_labels.filter((row) => conceptIds.has(row.concept_id))
  state.skos_notes = state.skos_notes.filter((row) => conceptIds.has(row.concept_id))
  state.skos_mapping_relations = state.skos_mapping_relations.filter((row) => conceptIds.has(row.concept_id))
  state.skos_relations = state.skos_relations.filter((row) => conceptIds.has(row.subject_id) && conceptIds.has(row.object_id))
  state.skos_scheme_memberships = state.skos_scheme_memberships.filter((row) => conceptIds.has(row.concept_id))
  state.skos_collection_members = state.skos_collection_members.filter((row) => conceptIds.has(row.concept_id))
  const skosCollectionIds = new Set(state.skos_collection_members.map((row) => row.collection_id))
  state.skos_collections = state.skos_collections.filter((row) => skosCollectionIds.has(row.id))
  const schemeIds = new Set([...state.skos_concepts.map((row) => row.primary_scheme_id),
    ...state.skos_scheme_memberships.map((row) => row.scheme_id), ...state.skos_collections.flatMap((row) => row.scheme_id === null ? [] : [row.scheme_id])])
  state.skos_schemes = state.skos_schemes.filter((row) => schemeIds.has(row.id))

  const revisionIds = ids(state.note_revisions)
  state.provenance_activities = state.provenance_activities.filter((row) => noteIds.has(row.note_id) && nullableIn(revisionIds, row.revision_id))
  state.provenance_edges = state.provenance_edges.filter((row) => nullableIn(revisionIds, row.revision_id) && nullableIn(noteIds, row.source_note_id)
    && (row.revision_id !== null || row.source_note_id !== null))
  const activityIds = ids(state.provenance_activities)
  const attachmentIds = new Set(state.notes.flatMap((note) => note.attachments.map((row) => row.attachment.id)))
  state.provenance_records = state.provenance_records.filter((row) =>
    (row.note_id !== null && noteIds.has(row.note_id) || row.attachment_id !== null && attachmentIds.has(row.attachment_id))
    && nullableIn(activityIds, row.activity_id))
  const locationIds = new Set(state.provenance_records.flatMap((row) => [row.location_id, row.original_location_id].filter((id): id is string => id !== null)))
  const deviceIds = new Set(state.provenance_records.flatMap((row) => row.device_id === null ? [] : [row.device_id]))
  state.provenance_locations = state.provenance_locations.filter((row) => locationIds.has(row.id))
  const namedIds = new Set(state.provenance_locations.flatMap((row) => row.named_location_id === null ? [] : [row.named_location_id]))
  state.named_locations = state.named_locations.filter((row) => namedIds.has(row.id))
  state.provenance_devices = state.provenance_devices.filter((row) => deviceIds.has(row.id))
  return state
}

/** Current native export never consults knowledge_shard_snapshot. */
export async function exportLiveFullV1(db: DatabaseClient, options: LiveFullV1Options): Promise<ShardExportResult> {
  let capability = createShardCapabilityReport({ backend: 'pglite', operation: 'export', requestedProfile: 'full-v1',
    requestedSchemaVersion: '2.0.0', declaredComponents: components as ShardComponent[] })
  const failure = (message: string): ShardExportResult => ({ success: false, archive: null, errors: [message], capability_report: capability })
  try {
    return await db.transaction(async (tx) => {
      let noteIds: string[] | undefined
      if (options.tag !== undefined) noteIds = (await tx.query<{ note_id: string }>('SELECT note_id FROM note_tag WHERE tag = $1 ORDER BY note_id', [options.tag])).rows.map((row) => row.note_id)
      else if (options.collectionId !== undefined) noteIds = (await tx.query<{ note_id: string }>('SELECT note_id FROM collection_note WHERE collection_id = $1 ORDER BY note_id', [options.collectionId.toLowerCase()])).rows.map((row) => row.note_id)
      const noteScoped = noteIds !== undefined
      let state: NativeState
      if (noteIds?.length === 0) state = Object.fromEntries(components.map((component) => [component, []])) as unknown as NativeState
      else state = closeNativeScope({
        ...await readNativeCore(tx, { noteIds, deferValidation: true }),
        ...await readNativeNoteHistory(tx, noteIds), ...await readNativeEmbeddings(tx),
        ...await readNativeSkos(tx, true), ...await readNativeProvenance(tx, true, noteIds), ...await readNativeGraph(tx),
      }, noteScoped, options.embeddingSetIds)
      const losses = await liveRepresentationLosses(tx, {
        noteIds: noteIds === undefined ? undefined : new Set(noteIds),
        embeddingSetIds: noteScoped || options.embeddingSetIds ? new Set(state.embedding_sets.map((row) => row.id)) : undefined,
        conceptIds: new Set([...state.skos_concepts.map((row) => row.id), ...state.note_skos_tags.map((row) => row.concept_id),
          ...state.skos_concepts.flatMap((row) => row.replaced_by_id === null ? [] : [row.replaced_by_id])]),
        collectionIds: new Set([...state.collections.map((row) => row.id),
          ...state.collections.flatMap((row) => row.parent_id === null ? [] : [row.parent_id]),
          ...state.notes.flatMap((row) => row.collection_id === null ? [] : [row.collection_id])]),
        schemeIds: new Set([...state.skos_concepts.map((row) => row.primary_scheme_id),
          ...state.skos_scheme_memberships.map((row) => row.scheme_id),
          ...state.skos_collections.flatMap((row) => row.scheme_id === null ? [] : [row.scheme_id])]),
      })
      if (losses.length) { capability = { ...capability, losses }; return failure('Live PGlite state cannot be represented exactly by the full-v1 wire contract.') }
      const invalidRecords = components.flatMap((component): ShardLossEntry[] => {
        const count = state[component].filter((row) => !validateShardComponentRecord(component, row, 'full-v1', '2.0.0').valid).length
        return count ? [{ code: 'unrepresentable-live-record', component, count, action: 'reject',
          message: 'Selected native records violate the full-v1 component contract.', reason: 'full-v1-live-production' }] : []
      })
      if (invalidRecords.length) { capability = { ...capability, losses: invalidRecords }; return failure('Selected native records cannot be represented exactly by full-v1.') }
      const presence = components.flatMap((component) => componentPresenceLosses('full-v1', component, state[component] as unknown as JsonObject[]))
      if (presence.length) { capability = { ...capability, losses: presence }; return failure('Live PGlite state violates full-v1 presence authority.') }
      const files = new Map<string, Uint8Array>()
      const counts: ShardManifest['counts'] = {}
      const checksums: Record<string, string> = {}
      for (const component of components) {
        const spec = FULL_V1_COMPONENT_FILES[component]
        const rows = state[component]
        const bytes = encoder.encode(spec.encoding === 'json-array' ? JSON.stringify(rows) : rows.map((row) => JSON.stringify(row)).join('\n'))
        files.set(spec.file, bytes)
        counts[component] = rows.length
        checksums[spec.file] = await sha256Hex(bytes)
      }
      counts.community_sets = state.communities.length
      counts.communities = state.communities.reduce((sum, row) => sum + row.communities.length, 0)
      const manifest: ShardManifest = { version: '2.0.0', profile: 'full-v1', format: 'matric-shard',
        producer: { name: 'fortemi-react-live-pglite', version: VERSION }, created_at: new Date().toISOString(),
        components, counts, checksums, min_reader_version: '2.0.0', migration_history: [] }
      const lineage = await readNativeLineage(tx, state)
      if (lineage.status === 'mixed') {
        capability = { ...capability, losses: [{ code: 'incompatible-native-migration-lineage',
          count: lineage.count, action: 'reject', reason: 'full-v1-live-production',
          message: 'Selected native records have different migration histories that one manifest cannot preserve.' }] }
        return failure('Selected native migration lineages cannot be represented exactly by one full-v1 manifest.')
      }
      if (lineage.status === 'single') {
        delete manifest.migration_history
        Object.assign(manifest, lineage.metadata)
      }
      const manifestLosses = presenceLosses('full-v1', 'manifest', manifest as unknown as JsonObject)
      if (manifestLosses.length) { capability = { ...capability, losses: manifestLosses }; return failure('Generated live full-v1 manifest violates presence authority.') }
      files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))
      for (const note of state.notes) for (const { attachment } of note.attachments) {
        const path = sidecarEntryName(attachment.checksum)
        if (files.has(path)) continue
        const bytes = await options.blobStore.read(attachment.checksum)
        if (!bytes || bytes.length !== attachment.bytes || computeBlobHash(bytes) !== attachment.checksum) return failure('BlobStore cannot reproduce mandatory live attachment bytes.')
        files.set(path, new Uint8Array(bytes))
      }
      if (options.signing) files.set(SIGNATURE_ENTRY, await signShard({ files, keyId: options.signing.keyId,
        privateKey: options.signing.privateKey, publicKey: options.signing.publicKey }))
      if (!(await validateFullV1ShardArchive(files)).valid) return failure('Generated native full-v1 archive failed validation.')
      return { success: true, archive: packTarGz(files), errors: [], capability_report: capability }
    })
  } catch { return failure('Native full-v1 state cannot be exported exactly.') }
}
