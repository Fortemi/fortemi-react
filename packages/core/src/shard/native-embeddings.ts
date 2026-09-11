import type { QueryExecutor } from '../storage-backend.js'
import type { VirtualEmbeddingSetSource } from '../repositories/embedding-sets-repository.js'
import { nativeUuid as uuid, nativeUtc as utc, upsertNativeFields as upsertFields,
  selectNativeFields as selectFields, type NativeFields as Fields, type NativeApplyProgress } from './native-fields.js'

type JsonObject = Record<string, unknown>

export interface NativeEmbeddingConfig {
  id: string
  name: string
  description: string | null
  model: string
  dimension: number
  chunk_size: number
  chunk_overlap: number
  hnsw_m: number | null
  hnsw_ef_construction: number | null
  ivfflat_lists: number | null
  is_default: boolean | null
  supports_mrl: boolean | null
  matryoshka_dims: number[] | null
  default_truncate_dim: number | null
  provider: string | null
  provider_config: JsonObject | null
  content_types: string[] | null
  strengths: string[] | null
  limitations: string[] | null
  recommended_for: string[] | null
  benchmark_scores: JsonObject | null
  is_available: boolean | null
  document_composition: JsonObject
  created_at: string
  updated_at: string
}

export interface NativeEmbeddingSet {
  id: string
  name: string
  slug: string | null
  description: string | null
  purpose: string | null
  usage_hints: string | null
  keywords: string[] | null
  set_type: 'filter' | 'full'
  mode: 'auto' | 'manual' | 'mixed' | null
  criteria: JsonObject | null
  embedding_config_id: string | null
  truncate_dim: number | null
  auto_embed_rules: JsonObject | null
  index_status: string
  index_type: string | null
  last_indexed_at: string | null
  document_count: number | null
  embedding_count: number | null
  embeddings_current: boolean | null
  index_size_bytes: number | null
  is_system: boolean | null
  is_active: boolean | null
  auto_refresh: boolean | null
  refresh_interval: string | null
  last_refresh_at: string | null
  agent_metadata: JsonObject | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface NativeEmbeddingMember {
  embedding_set_id: string
  note_id: string
  membership_type: string | null
  added_at: string | null
  added_by: string | null
}

export interface NativeEmbedding {
  id: string
  note_id: string | null
  embedding_set_id: string | null
  chunk_index: number
  text: string
  vector: number[] | null
  model: string | null
  contract_fingerprint?: string | null
  created_at: string | null
}

export interface NativeEmbeddings {
  embedding_configs: NativeEmbeddingConfig[]
  embedding_sets: NativeEmbeddingSet[]
  embedding_set_members: NativeEmbeddingMember[]
  embeddings: NativeEmbedding[]
}

const configFields: Fields<NativeEmbeddingConfig> = {
  id: { kind: 'uuid' }, name: {}, description: {}, model: {}, dimension: {}, chunk_size: {}, chunk_overlap: {},
  hnsw_m: {}, hnsw_ef_construction: {}, ivfflat_lists: {}, is_default: {}, supports_mrl: {}, matryoshka_dims: {},
  default_truncate_dim: {}, provider: {}, provider_config: { kind: 'json' }, content_types: {}, strengths: {},
  limitations: {}, recommended_for: {}, benchmark_scores: { kind: 'json' }, is_available: {},
  document_composition: { kind: 'json' }, created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
}
const setFields: Fields<Omit<NativeEmbeddingSet, 'set_type'>> = {
  id: { kind: 'uuid' }, name: {}, slug: {}, description: {}, purpose: {}, usage_hints: {},
  keywords: { column: 'keywords_json', kind: 'json' }, mode: {}, criteria: { column: 'criteria_json', kind: 'json' },
  embedding_config_id: { kind: 'uuid' }, truncate_dim: { column: 'truncate_dimension' }, auto_embed_rules: { kind: 'json' },
  index_status: {}, index_type: {}, last_indexed_at: {}, document_count: {}, embedding_count: {},
  embeddings_current: {}, index_size_bytes: {}, is_system: {}, is_active: {}, auto_refresh: {}, refresh_interval: {},
  last_refresh_at: {}, agent_metadata: { kind: 'json' }, created_at: { kind: 'timestamp' },
  updated_at: { kind: 'timestamp' }, created_by: {},
}
const memberFields: Fields<NativeEmbeddingMember> = {
  embedding_set_id: { kind: 'uuid' }, note_id: { kind: 'uuid' }, membership_type: {},
  added_at: { kind: 'timestamp' }, added_by: {},
}

function sourceSetIds(source: VirtualEmbeddingSetSource | null): string[] {
  switch (source?.type) {
    case 'criteria': return [source.baseSetId]
    case 'set-operation': return source.setIds
    case 'fallback': return source.preferredSetIds
    case 'latest-compatible': return source.candidateSetIds
    case 'snapshot': return [source.snapshotId]
    default: return []
  }
}

type NativeVectorChange = { id: string; old_set_id: string | null; new_set_id: string | null }

async function invalidateIncomingVectorMaterializations(tx: QueryExecutor, rows: NativeEmbedding[]): Promise<void> {
  const changed = await tx.query<NativeVectorChange>(`
    SELECT incoming.id, e.embedding_set_id AS old_set_id, incoming.embedding_set_id AS new_set_id
    FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
      incoming(id, note_id, embedding_set_id, vector_text, created_at)
    LEFT JOIN embedding e ON e.id = incoming.id
    WHERE e.id IS NULL OR
      (e.note_id, e.embedding_set_id, e.vector, e.created_at) IS DISTINCT FROM
      (incoming.note_id, incoming.embedding_set_id, incoming.vector_text::vector, incoming.created_at::timestamptz)`,
  [rows.map((row) => uuid(row.id)), rows.map((row) => uuid(row.note_id)), rows.map((row) => uuid(row.embedding_set_id)),
    rows.map((row) => row.vector === null ? null : JSON.stringify(row.vector)), rows.map((row) => row.created_at)])
  await invalidateVectorMaterializations(tx, changed.rows)
}

/** Omission authority requires both selected owners; native references still
 * reject deletion. RETURNING captures dependencies of exactly the removed rows. */
export async function removeOmittedNativeEmbeddings(tx: QueryExecutor, noteIds: string[], setIds: string[], retainedIds: string[]): Promise<void> {
  const deleted = await tx.query<NativeVectorChange>(`DELETE FROM embedding
    WHERE note_id = ANY($1::text[]) AND embedding_set_id = ANY($2::text[])
      AND NOT (id = ANY($3::text[]))
    RETURNING id, embedding_set_id AS old_set_id, NULL::text AS new_set_id`, [noteIds, setIds, retainedIds])
  await invalidateVectorMaterializations(tx, deleted.rows)
}

async function invalidateVectorMaterializations(tx: QueryExecutor, changed: NativeVectorChange[]): Promise<void> {
  if (!changed.length) return
  const changedSets = new Set(changed.flatMap((row) => [row.old_set_id, row.new_set_id].filter((id) => id !== null)))
  const materializations = await tx.query<{ id: string; source_json: VirtualEmbeddingSetSource | null; referenced: boolean }>(`
    SELECT s.id, s.source_json, EXISTS (
      SELECT 1 FROM embedding_set_member m WHERE m.embedding_set_id = s.id
        AND m.embedding_id = ANY($1::text[])) AS referenced
    FROM embedding_set s WHERE s.kind = 'virtual' AND s.materialization_json IS NOT NULL`,
  [changed.map((row) => row.id)])
  // Cached members cannot reveal newly matching vectors, including empty results.
  // Invalidate by declared physical source sets as well as existing references.
  const affected = materializations.rows.filter((row) => row.referenced ||
    sourceSetIds(row.source_json).some((id) => changedSets.has(id))).map((row) => row.id)
  if (affected.length) await tx.query(`UPDATE embedding_set SET
      materialization_json = materialization_json || jsonb_build_object('freshness', 'stale'),
      freshness_json = jsonb_build_object('status', 'stale', 'sourceHash', materialization_json->'inputHash',
        'checkedAt', now(), 'reason', 'Shard vector source state changed'), updated_at = now()
    WHERE id = ANY($1::text[])`, [affected])
}

/** Internal stage. Caller validates the complete archive and resolves conflicts
 * in the enclosing transaction, including selected-owner replacement/deletion. */
export async function applyValidatedNativeEmbeddings(tx: QueryExecutor, state: NativeEmbeddings, progress?: NativeApplyProgress): Promise<void> {
  for (const row of state.embedding_configs) {
    await upsertFields(tx, 'embedding_config', row, configFields, ['id'], { shard_export_present: true })
    await progress?.('embedding_configs')
  }
  const configIds = state.embedding_sets.flatMap((row) => row.embedding_config_id === null ? [] : [uuid(row.embedding_config_id)!])
  const configs = new Map((await tx.query<Pick<NativeEmbeddingConfig, 'id' | 'model' | 'dimension'>>(
    'SELECT id, model, dimension FROM embedding_config WHERE id = ANY($1::text[])', [configIds])).rows.map((row) => [row.id, row]))
  for (const row of state.embedding_sets) {
    const config = row.embedding_config_id === null ? undefined : configs.get(uuid(row.embedding_config_id)!)
    const embedding = state.embeddings.find((record) => uuid(record.embedding_set_id) === uuid(row.id))
    await upsertFields(tx, 'embedding_set', row, setFields, ['id'], {
      kind: row.set_type === 'full' ? 'physical' : 'filter',
      model_name: config?.model ?? embedding?.model ?? 'unknown',
      dimensions: row.truncate_dim ?? config?.dimension ?? embedding?.vector?.length ?? 768,
      shard_export_present: true,
    })
    await progress?.('embedding_sets')
  }
  for (const row of state.embedding_set_members) {
    await upsertFields(tx, 'embedding_set_member', row, memberFields,
      ['embedding_set_id', 'note_id'], { shard_export_present: true })
    await progress?.('embedding_set_members')
  }
  if (state.embeddings.length) {
    await invalidateIncomingVectorMaterializations(tx, state.embeddings)
    await tx.query(`UPDATE embedding_set_member m SET embedding_id = NULL
      FROM unnest($1::text[], $2::text[]) incoming(id, note_id)
      WHERE m.embedding_id = incoming.id AND m.note_id IS DISTINCT FROM incoming.note_id`,
    [state.embeddings.map((row) => uuid(row.id)), state.embeddings.map((row) => uuid(row.note_id))])
  }
  // Vacate only changed incoming coordinates, preserving IDs and native references.
  // Nullable set coordinates keep the immediate unique index valid during cycles.
  if (state.embeddings.length) await tx.query(`UPDATE embedding existing SET embedding_set_id = NULL
    FROM unnest($1::text[], $2::text[], $3::text[], $4::integer[])
      AS incoming(id, note_id, embedding_set_id, chunk_index)
    WHERE existing.id = incoming.id AND existing.embedding_set_id IS NOT NULL
      AND (existing.note_id, existing.embedding_set_id, existing.chunk_index)
        IS DISTINCT FROM (incoming.note_id, incoming.embedding_set_id, incoming.chunk_index)`,
  [state.embeddings.map((row) => uuid(row.id)), state.embeddings.map((row) => uuid(row.note_id)),
    state.embeddings.map((row) => uuid(row.embedding_set_id)), state.embeddings.map((row) => row.chunk_index)])
  for (const row of state.embeddings) {
    await tx.query(`INSERT INTO embedding (id, note_id, embedding_set_id, chunk_index, text, vector, vector_values,
        model, contract_fingerprint, shard_contract_fingerprint_present, created_at, created_at_utc)
      VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11::text::timestamptz, $11::text)
      ON CONFLICT (id) DO UPDATE SET note_id = EXCLUDED.note_id, embedding_set_id = EXCLUDED.embedding_set_id,
        chunk_index = EXCLUDED.chunk_index, text = EXCLUDED.text, vector = EXCLUDED.vector,
        vector_values = EXCLUDED.vector_values, model = EXCLUDED.model, contract_fingerprint = EXCLUDED.contract_fingerprint,
        shard_contract_fingerprint_present = EXCLUDED.shard_contract_fingerprint_present,
        created_at = EXCLUDED.created_at, created_at_utc = EXCLUDED.created_at_utc`,
    [uuid(row.id), uuid(row.note_id), uuid(row.embedding_set_id), row.chunk_index, row.text,
      row.vector === null ? null : JSON.stringify(row.vector), row.vector, row.model,
      row.contract_fingerprint ?? null, Object.hasOwn(row, 'contract_fingerprint'), row.created_at])
    await progress?.('embeddings')
  }
  const changedConfigs = state.embedding_configs.map((row) => uuid(row.id))
  // Retained sets also depend on a replaced config. These are native derived
  // fields, not new portable metadata or a reason to delete existing vectors.
  if (changedConfigs.length) await tx.query(`UPDATE embedding_set s SET model_name = c.model,
      dimensions = COALESCE(s.truncate_dimension, c.dimension)
    FROM embedding_config c WHERE s.embedding_config_id = c.id AND c.id = ANY($1::text[])`, [changedConfigs])
  const incompatible = await tx.query(`SELECT e.id FROM embedding e
    JOIN embedding_set s ON s.id = e.embedding_set_id
    JOIN embedding_config c ON c.id = s.embedding_config_id
    WHERE e.vector IS NOT NULL AND vector_dims(e.vector) <> COALESCE(s.truncate_dimension, c.dimension)
      AND (c.id = ANY($1::text[]) OR s.id = ANY($2::text[]) OR e.id = ANY($3::text[])) LIMIT 1`,
  [changedConfigs, state.embedding_sets.map((row) => uuid(row.id)), state.embeddings.map((row) => uuid(row.id))])
  if (incompatible.rows.length) throw new Error('Native vector dimension conflicts with the retained set configuration')
}

/** Reads current typed native values, never an archival snapshot. */
export async function readNativeEmbeddings(tx: QueryExecutor): Promise<NativeEmbeddings> {
  const configs = await tx.query<NativeEmbeddingConfig>(`SELECT ${selectFields(configFields)} FROM embedding_config WHERE shard_export_present ORDER BY id`)
  const sets = await tx.query<NativeEmbeddingSet>(`SELECT ${selectFields(setFields)},
    CASE WHEN kind = 'physical' THEN 'full' ELSE 'filter' END AS set_type
    FROM embedding_set WHERE shard_export_present ORDER BY id`)
  const members = await tx.query<NativeEmbeddingMember>(`SELECT ${selectFields(memberFields)} FROM embedding_set_member
    WHERE shard_export_present ORDER BY embedding_set_id, note_id`)
  const embeddings = await tx.query<Omit<NativeEmbedding, 'vector'> & {
    vector_text: string | null; vector_values: number[] | null; shard_contract_fingerprint_present: boolean
  }>(`SELECT id, note_id, embedding_set_id, chunk_index, text, model, contract_fingerprint,
    shard_contract_fingerprint_present, ${utc('created_at')} AS created_at, vector::text AS vector_text,
    CASE WHEN vector_values::vector = vector THEN vector_values ELSE NULL END AS vector_values
    FROM embedding ORDER BY id`)
  return { embedding_configs: configs.rows, embedding_sets: sets.rows.map((row) => ({ ...row,
    index_size_bytes: row.index_size_bytes === null ? null : Number(row.index_size_bytes) })),
  embedding_set_members: members.rows, embeddings: embeddings.rows.map((row) => {
    const { vector_text, vector_values, shard_contract_fingerprint_present, contract_fingerprint, ...rest } = row
    return { ...rest, vector: vector_values ?? (vector_text === null ? null : JSON.parse(vector_text) as number[]),
      ...(shard_contract_fingerprint_present || contract_fingerprint != null ? { contract_fingerprint } : {}) }
  }) }
}
