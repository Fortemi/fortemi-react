import type { QueryExecutor } from '../storage-backend.js'
import { nativeUuid as uuid, nativeUtc as utc, upsertNativeFields as upsertFields,
  selectNativeFields as selectFields, type NativeFields as Fields } from './native-fields.js'

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

/** Internal stage. Caller validates the complete archive and resolves conflicts
 * in the enclosing transaction, including selected-owner replacement/deletion. */
export async function applyValidatedNativeEmbeddings(tx: QueryExecutor, state: NativeEmbeddings): Promise<void> {
  const configs = new Map(state.embedding_configs.map((row) => [uuid(row.id), row]))
  for (const row of state.embedding_configs) await upsertFields(tx, 'embedding_config', row, configFields, ['id'], { shard_export_present: true })
  for (const row of state.embedding_sets) {
    const config = configs.get(uuid(row.embedding_config_id))
    const embedding = state.embeddings.find((record) => uuid(record.embedding_set_id) === uuid(row.id))
    await upsertFields(tx, 'embedding_set', row, setFields, ['id'], {
      kind: row.set_type === 'full' ? 'physical' : 'filter',
      model_name: config?.model ?? embedding?.model ?? 'unknown',
      dimensions: row.truncate_dim ?? config?.dimension ?? embedding?.vector?.length ?? 768,
      shard_export_present: true,
    })
  }
  for (const row of state.embedding_set_members) await upsertFields(tx, 'embedding_set_member', row, memberFields,
    ['embedding_set_id', 'note_id'], { embedding_id: null, shard_export_present: true })
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
  }
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
