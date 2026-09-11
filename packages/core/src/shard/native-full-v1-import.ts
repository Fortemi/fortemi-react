import type { DatabaseClient, QueryExecutor } from '../storage-backend.js'
import type { ImportCounts, ImportOptions, ImportResult, ShardManifest, ImportProgressPhase } from './types.js'
import type { NativeApplyProgress } from './native-fields.js'
import { nativeIdentities as identity, nativeIdentityKey as key } from './native-identities.js'
import { writeNativeLineage } from './native-lineage.js'
import { unpackTarGz } from './shard-tar.js'
import { FULL_V1_COMPONENT_FILES, validateFullV1ShardArchive } from './schema-validator.js'
import { parseJsonArrayBytes, parseJsonlBytes } from './parse.js'
import { createShardCapabilityReport } from './profile-registry.js'
import { verifyShardSignature } from './shard-signature.js'
import { collectSidecarBlobs, blobChecksumToHex } from './blob-sidecar.js'
import { promoteBlobs, type BlobPromotion } from './blob-staging.js'
import { computeBlobHash } from '../hash.js'
import { EmbeddingSetsRepository } from '../repositories/embedding-sets-repository.js'
import { applyValidatedNativeCore, type NativeCore } from './native-core.js'
import { removeOmittedNativeRevisions } from './native-note-history.js'
import type { NativeNoteHistory } from './native-note-history.js'
import { applyValidatedNativeEmbeddings, removeOmittedNativeEmbeddings, type NativeEmbeddings } from './native-embeddings.js'
import { applyValidatedNativeSkos, removeOmittedNativeSkos, type NativeSkos } from './native-skos.js'
import { applyValidatedNativeProvenance, prepareNativeProvenanceGeometry, type NativeProvenance } from './native-provenance.js'
import { applyValidatedNativeGraph, type NativeGraph } from './native-graph.js'

export type NativeState = NativeCore & NativeNoteHistory & NativeEmbeddings & NativeSkos & NativeProvenance & NativeGraph
type Component = keyof NativeState
const components = Object.keys(identity) as Component[]
const uuid = (value: string) => value.toLowerCase()
const asRecords = (rows: NativeState[Component]): Record<string, unknown>[] => rows as unknown as Record<string, unknown>[]
const phaseByComponent: Record<Component, ImportProgressPhase> = {
  notes: 'notes', tags: 'notes', note_originals: 'notes', note_original_history: 'notes',
  note_revisions: 'notes', note_revised_current: 'notes', collections: 'collections', templates: 'templates', links: 'links',
  embedding_configs: 'embedding_configs', embedding_sets: 'embedding_sets', embedding_set_members: 'embedding_set_members', embeddings: 'embeddings',
  skos_schemes: 'skos', skos_concepts: 'skos', skos_labels: 'skos', skos_notes: 'skos', skos_relations: 'skos',
  skos_mapping_relations: 'skos', skos_scheme_memberships: 'skos', note_skos_tags: 'skos', skos_collections: 'skos', skos_collection_members: 'skos',
  provenance_activities: 'provenance', provenance_edges: 'provenance', named_locations: 'provenance',
  provenance_locations: 'provenance', provenance_devices: 'provenance', provenance_records: 'provenance',
  graph_sources: 'graph', graph_edges: 'graph', communities: 'communities', community_assignments: 'communities',
}

async function nativeProgress(state: NativeState, selected: NativeState, options: ImportOptions): Promise<NativeApplyProgress> {
  const phases = new Map<ImportProgressPhase, { done: number; total: number }>()
  for (const component of components) {
    const phase = phaseByComponent[component]
    const counts = phases.get(phase) ?? { done: 0, total: 0 }
    counts.total += state[component].length
    counts.done += state[component].length - selected[component].length
    phases.set(phase, counts)
  }
  for (const [phase, counts] of phases) await options.onProgress?.({ phase, ...counts })
  let processed = 0
  const batchSize = options.batchSize ?? 250
  return async (component) => {
    const phase = phaseByComponent[component as Component]
    const counts = phases.get(phase)!
    await options.onProgress?.({ phase, done: ++counts.done, total: counts.total })
    if (batchSize > 0 && ++processed % batchSize === 0) {
      const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler
      if (scheduler?.yield) await scheduler.yield()
      else await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}

function emptyCounts(): ImportCounts {
  return { notes: 0, collections: 0, templates: 0, tags: 0, links: 0,
    embedding_sets: 0, embedding_configs: 0, embedding_set_members: 0, embeddings: 0,
    skos_schemes: 0, skos_concepts: 0, skos_relations: 0, note_skos_tags: 0,
    provenance_edges: 0, graph_sources: 0, graph_edges: 0, community_sets: 0,
    communities: 0, community_assignments: 0 }
}

function stateCounts(state: NativeState): ShardManifest['counts'] {
  const counts = Object.fromEntries(components.map((component) => [component, state[component].length]))
  counts.community_sets = state.communities.length
  counts.communities = state.communities.reduce((sum, set) => sum + set.communities.length, 0)
  return counts
}


async function selectNativeRecords(tx: QueryExecutor, state: NativeState, strategy: 'skip' | 'replace' | 'error'): Promise<NativeState> {
  const selected = {} as NativeState
  for (const component of components) {
    const spec = identity[component]
    const existing = await tx.query<Record<string, unknown>>(`SELECT ${spec.keys.join(', ')} FROM ${spec.table}`)
    const keys = new Set(existing.rows.map((row) => key(spec, row)))
    const incoming = asRecords(state[component])
    if (strategy === 'error' && incoming.some((row) => keys.has(key(spec, row)))) throw new Error('Native full-v1 identity conflict')
    // A selected note's original/current fallback rows are replaced together.
    const rows = strategy === 'skip' ? incoming.filter((row) => !keys.has(key(spec, row))) : incoming
    Object.assign(selected, { [component]: rows })
  }
  if (strategy !== 'skip') return selected
  const skippedNotes = new Set(state.notes.filter((note) => !selected.notes.includes(note)).map((note) => uuid(note.id)))
  const skippedConcepts = new Set(state.skos_concepts.filter((row) => !selected.skos_concepts.includes(row)).map((row) => uuid(row.id)))
  const skippedCollections = new Set(state.skos_collections.filter((row) => !selected.skos_collections.includes(row)).map((row) => uuid(row.id)))
  const skippedCommunities = new Set(state.communities.filter((row) => !selected.communities.includes(row)).map((row) => row.id))
  const skippedSources = new Set(state.graph_sources.filter((row) => !selected.graph_sources.includes(row)).map((row) => row.id))
  const skippedAttachments = new Set(state.notes.filter((note) => skippedNotes.has(uuid(note.id)))
    .flatMap((note) => note.attachments.map(({ attachment }) => uuid(attachment.id))))
  const skippedRevisions = new Set(state.note_revisions.filter((row) =>
    skippedNotes.has(uuid(row.note_id)) || !selected.note_revisions.includes(row)).map((row) => uuid(row.id)))
  // Ownership controls skip, not reference endpoints. A new note may use an
  // existing concept/set, and a new graph may connect existing notes.
  const owners: Partial<Record<Component, Array<[string, Set<string>, boolean?]>>> = {
    note_originals: [['note_id', skippedNotes]], note_original_history: [['note_id', skippedNotes]],
    note_revisions: [['note_id', skippedNotes]], note_revised_current: [['note_id', skippedNotes]],
    links: [['from_note_id', skippedNotes]], embeddings: [['note_id', skippedNotes]],
    embedding_set_members: [['note_id', skippedNotes]], note_skos_tags: [['note_id', skippedNotes]],
    skos_labels: [['concept_id', skippedConcepts]], skos_notes: [['concept_id', skippedConcepts]],
    skos_relations: [['subject_id', skippedConcepts]], skos_mapping_relations: [['concept_id', skippedConcepts]],
    skos_scheme_memberships: [['concept_id', skippedConcepts]],
    skos_collection_members: [['collection_id', skippedCollections]],
    provenance_activities: [['note_id', skippedNotes]], provenance_edges: [['revision_id', skippedRevisions]],
    provenance_records: [['note_id', skippedNotes], ['attachment_id', skippedAttachments]],
    graph_edges: [['graph_source_id', skippedSources, false]],
    community_assignments: [['community_set_id', skippedCommunities, false]],
  }
  for (const component of components) {
    const rows = asRecords(selected[component]).filter((row) => (owners[component] ?? []).every(([field, skipped, isUuid = true]) => {
      const value = row[field]
      return typeof value !== 'string' || !skipped.has(isUuid ? uuid(value) : value)
    }))
    Object.assign(selected, { [component]: rows })
  }
  return selected
}

async function replaceOwnedRelationships(tx: QueryExecutor, state: NativeState): Promise<void> {
  const notes = state.notes.map((row) => uuid(row.id))
  const attachments = state.notes.flatMap((row) => row.attachments.map(({ attachment }) => uuid(attachment.id)))
  await tx.query(`DELETE FROM provenance_record
    WHERE (note_id = ANY($1::text[]) OR attachment_id = ANY($2::text[]))
    AND NOT (id = ANY($3::text[]))`, [notes, attachments, state.provenance_records.map((row) => uuid(row.id))])
  // Shared-set declarations can be dependencies of a scoped note export.
  // Omission requires both endpoints selected; retained coordinates update in place.
  await tx.query(`DELETE FROM embedding_set_member existing
    WHERE existing.note_id = ANY($1::text[]) AND existing.embedding_set_id = ANY($2::text[])
    AND NOT EXISTS (SELECT 1 FROM UNNEST($3::text[], $4::text[]) incoming(set_id, note_id)
      WHERE incoming.set_id = existing.embedding_set_id AND incoming.note_id = existing.note_id)`,
  [notes, state.embedding_sets.map((row) => uuid(row.id)),
    state.embedding_set_members.map((row) => uuid(row.embedding_set_id)), state.embedding_set_members.map((row) => uuid(row.note_id))])
  await removeOmittedNativeEmbeddings(tx, notes, state.embedding_sets.map((row) => uuid(row.id)), state.embeddings.map((row) => uuid(row.id)))
  await removeOmittedNativeSkos(tx, state, notes)
  // Retained relationships update in place. Omission grants deletion authority
  // only within selected owners, never through a referenced note or source.
  for (const table of ['link', 'link_url_target']) {
    await tx.query(`DELETE FROM ${table} WHERE source_note_id = ANY($1::text[])
      AND NOT (id = ANY($2::text[]))`, [notes, state.links.map((row) => uuid(row.id))])
  }
  await tx.query(`DELETE FROM graph_edge_artifact existing WHERE graph_source_id = ANY($1::text[])
    AND NOT EXISTS (SELECT 1 FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[])
      incoming(source_id, from_id, to_id, kind)
      WHERE incoming.source_id = existing.graph_source_id AND incoming.from_id = existing.from_note_id
      AND incoming.to_id = existing.to_note_id AND incoming.kind = existing.kind)`,
  [state.graph_sources.map((row) => row.id), state.graph_edges.map((row) => row.graph_source_id),
    state.graph_edges.map((row) => uuid(row.from_note_id)), state.graph_edges.map((row) => uuid(row.to_note_id)),
    state.graph_edges.map((row) => row.kind)])
  await tx.query(`DELETE FROM community_assignment existing WHERE community_set_id = ANY($1::text[])
    AND NOT EXISTS (SELECT 1 FROM UNNEST($2::text[], $3::text[]) incoming(set_id, note_id)
      WHERE incoming.set_id = existing.community_set_id AND incoming.note_id = existing.note_id)`,
  [state.communities.map((row) => row.id), state.community_assignments.map((row) => row.community_set_id),
    state.community_assignments.map((row) => uuid(row.note_id))])
}

async function reconcileNativeProvenanceOmissions(tx: QueryExecutor, state: NativeState): Promise<void> {
  await tx.query(`DELETE FROM provenance_derivation WHERE revision_id = ANY($1::text[])
    AND NOT (id = ANY($2::text[]))`, [state.note_revisions.map((row) => uuid(row.id)), state.provenance_edges.map((row) => uuid(row.id))])
  const omitted = (await tx.query<{ id: string }>(`SELECT id FROM provenance_edge
    WHERE note_id = ANY($1::text[]) AND NOT (id = ANY($2::text[])) ORDER BY id FOR UPDATE`,
  [state.notes.map((row) => uuid(row.id)), state.provenance_activities.map((row) => uuid(row.id))])).rows.map((row) => row.id)
  const references = await tx.query('SELECT 1 FROM provenance_record WHERE activity_id = ANY($1::text[]) LIMIT 1', [omitted])
  if (references.rows.length) throw new Error('Omitted native activities are referenced by retained provenance records')
  await tx.query('DELETE FROM provenance_edge WHERE id = ANY($1::text[])', [omitted])
}

async function assertNativeAlternateKeys(tx: QueryExecutor, selected: NativeState): Promise<void> {
  // Native authoring tables do not enforce every authority coordinate. Check
  // only duplicate groups touched by this import, after selected-owner deletion.
  const coordinates: Array<[Component, string, string?]> = [
    ['note_original_history', 'note_id, version_number'],
    ['note_revisions', 'note_id, revision_number', 'shard_export_present'],
    ['embedding_configs', 'name', 'shard_export_present'],
    ['embedding_sets', 'name', 'shard_export_present'],
    ['embedding_sets', 'slug', 'shard_export_present AND slug IS NOT NULL'],
    ['embeddings', 'note_id, embedding_set_id, chunk_index', 'note_id IS NOT NULL AND embedding_set_id IS NOT NULL'],
    ['skos_schemes', 'notation'], ['skos_schemes', 'uri', 'uri IS NOT NULL'],
    ['skos_concepts', 'uri', 'uri IS NOT NULL'], ['skos_concepts', 'scheme_id, notation', 'notation IS NOT NULL'],
    ['skos_labels', 'concept_id, label_type, language, value'],
    ['skos_labels', 'concept_id, language', "label_type = 'pref_label'"],
    ['skos_relations', 'source_concept_id, target_concept_id, relation_type'],
    ['skos_mapping_relations', 'concept_id, target_uri, relation_type'],
    ['skos_collections', 'uri', 'uri IS NOT NULL'],
    ['named_locations', 'slug'], ['provenance_devices', 'device_make, device_model, owner_id'],
    ['provenance_records', 'note_id', 'note_id IS NOT NULL'],
  ]
  for (const [component, columns, predicate] of coordinates) {
    const ids = asRecords(selected[component]).map((row) => uuid(row.id as string))
    if (!ids.length) continue
    const duplicates = await tx.query(`SELECT 1 FROM ${identity[component].table}
      ${predicate ? `WHERE ${predicate}` : ''} GROUP BY ${columns}
      HAVING count(*) > 1 AND bool_or(id = ANY($1::text[])) LIMIT 1`, [ids])
    if (duplicates.rows.length) throw new Error('Native full-v1 alternate identity conflict')
  }
}

/** Public native full-v1 restore. Archival storage is an independent API. */
export async function importNativeFullV1(db: DatabaseClient, data: Uint8Array, options: ImportOptions = {}): Promise<ImportResult> {
  const started = performance.now()
  const counts = emptyCounts()
  const skipped = emptyCounts()
  const warnings: string[] = []
  const capability = createShardCapabilityReport({ backend: 'pglite', operation: 'import', requestedProfile: 'full-v1', requestedSchemaVersion: '2.0.0' })
  const failure = (message: string): ImportResult => ({ success: false, counts: emptyCounts(), skipped: {}, warnings, errors: [message], duration_ms: performance.now() - started, capability_report: capability })
  const strategy = options.conflictStrategy ?? 'skip'
  if (!['skip', 'replace', 'error'].includes(strategy)) return failure('Invalid native full-v1 conflict strategy')
  const batchSize = options.batchSize ?? 250
  if (!Number.isSafeInteger(batchSize) || batchSize < 0) return failure('Invalid native full-v1 batchSize')
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') return failure('Invalid native full-v1 progress callback')
  let files: Map<string, Uint8Array>
  let state: NativeState
  let manifest: ShardManifest
  try {
    await options.onProgress?.({ phase: 'validate', done: 0, total: 1 })
    files = unpackTarGz(data)
    const validation = await validateFullV1ShardArchive(files)
    if (!validation.valid) return failure(`Canonical full-v1 validation failed: ${validation.errors.slice(0, 10).join('; ').slice(0, 2000)}`)
    manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as ShardManifest
    if (manifest.profile !== 'full-v1' || manifest.version !== '2.0.0') return failure('Native restore requires 2.0.0/full-v1')
    const policy = options.verifySignature ?? (options.trustStore ? 'require' : 'trusted-local-only')
    if (!['require', 'prefer', 'trusted-local-only'].includes(policy)) return failure('Invalid full-v1 signature policy')
    if (policy !== 'trusted-local-only') {
      if (!options.trustStore) return failure('Full-v1 publisher verification requires a trustStore')
      const result = await verifyShardSignature({ files, trustStore: options.trustStore })
      if (!result.ok && !(policy === 'prefer' && result.reason === 'unsigned')) return failure('Full-v1 publisher verification failed')
      if (!result.ok && result.reason === 'unsigned') warnings.push('Shard is unsigned; imported under verifySignature: prefer. Publisher provenance was NOT authenticated.')
    }
    state = Object.fromEntries(components.map((component) => {
      const spec = FULL_V1_COMPONENT_FILES[component]
      const bytes = files.get(spec.file)
      return [component, spec.encoding === 'json-array' ? parseJsonArrayBytes(bytes) : parseJsonlBytes(bytes)]
    })) as unknown as NativeState
    prepareNativeProvenanceGeometry(state)
    if (state.notes.some((note) => note.attachments.length) && !options.blobStore) return failure('Native full-v1 attachments require a BlobStore')
    await options.onProgress?.({ phase: 'validate', done: 1, total: 1 })
  } catch {
    return failure('Invalid native full-v1 archive')
  }
  const sidecars = collectSidecarBlobs(files)
  let promotion: BlobPromotion | undefined
  try {
    let appliedCounts: ShardManifest['counts'] = {}
    await db.transaction(async (tx) => {
      const selected = await selectNativeRecords(tx, state, strategy)
      const progress = await nativeProgress(state, selected, options)
      const blobs = new Map<string, Uint8Array>()
      for (const note of selected.notes) for (const { attachment } of note.attachments) {
        const bytes = sidecars.get(blobChecksumToHex(attachment.checksum))
        if (!bytes || bytes.length !== attachment.bytes || computeBlobHash(bytes) !== attachment.checksum) throw new Error('Invalid mandatory sidecar')
        blobs.set(attachment.checksum, bytes)
      }
      for (const [checksum, bytes] of blobs) if (await options.blobStore!.has(checksum)) {
        const existing = await options.blobStore!.read(checksum)
        if (!existing || existing.length !== bytes.length || computeBlobHash(existing) !== checksum) {
          throw new Error('Existing native blob failed integrity verification')
        }
      }
      promotion = await promoteBlobs(options.blobStore, blobs)
      await new EmbeddingSetsRepository(tx).withMaterializationInvalidation(async () => {
        if (strategy === 'replace') await replaceOwnedRelationships(tx, selected)
        await applyValidatedNativeCore(tx, selected, selected, progress, { deferRevisionCleanup: true })
        await applyValidatedNativeEmbeddings(tx, selected, progress)
        await applyValidatedNativeSkos(tx, selected, progress)
        await applyValidatedNativeProvenance(tx, selected, progress)
        if (strategy === 'replace') await reconcileNativeProvenanceOmissions(tx, selected)
        await removeOmittedNativeRevisions(tx, selected.notes.map((row) => row.id), selected.note_revisions.map((row) => row.id))
        await applyValidatedNativeGraph(tx, selected, progress)
        await assertNativeAlternateKeys(tx, selected)
      })
      appliedCounts = stateCounts(selected)
      await writeNativeLineage(tx, selected, manifest, components.every((component) => state[component].length === 0))
      await options.onProgress?.({ phase: 'index', done: 0, total: 1 })
    })
    try { await options.onProgress?.({ phase: 'index', done: 1, total: 1 }) }
    catch { warnings.push('Native import committed, but the final progress callback failed.') }
    const total = stateCounts(state)
    for (const component of Object.keys(counts) as (keyof ImportCounts)[]) {
      counts[component] = appliedCounts[component] ?? 0
      skipped[component] = (total[component] ?? 0) - counts[component]
    }
    return { success: true, counts, skipped, warnings, errors: [], component_counts: appliedCounts,
      duration_ms: performance.now() - started, capability_report: capability }
  } catch {
    try { await promotion?.rollback() } catch { return failure('Native full-v1 transaction failed; blob rollback requires recovery') }
    return failure('Native full-v1 transaction failed')
  }
}
