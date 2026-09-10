import type { Migration } from '../migration-runner.js'

/** Native embedding state, including metadata-only and ownerless records. */
export const migration0026: Migration = {
  version: 26,
  name: '0026_native_embeddings',
  sql: `
    ALTER TABLE embedding_config ALTER COLUMN is_default DROP NOT NULL;
    ALTER TABLE embedding_config ADD COLUMN hnsw_m INTEGER;
    ALTER TABLE embedding_config ADD COLUMN hnsw_ef_construction INTEGER;
    ALTER TABLE embedding_config ADD COLUMN ivfflat_lists INTEGER;
    ALTER TABLE embedding_config ADD COLUMN supports_mrl BOOLEAN;
    ALTER TABLE embedding_config ADD COLUMN matryoshka_dims INTEGER[];
    ALTER TABLE embedding_config ADD COLUMN default_truncate_dim INTEGER;
    ALTER TABLE embedding_config ADD COLUMN provider TEXT;
    ALTER TABLE embedding_config ADD COLUMN provider_config JSONB;
    ALTER TABLE embedding_config ADD COLUMN content_types TEXT[];
    ALTER TABLE embedding_config ADD COLUMN strengths TEXT[];
    ALTER TABLE embedding_config ADD COLUMN limitations TEXT[];
    ALTER TABLE embedding_config ADD COLUMN recommended_for TEXT[];
    ALTER TABLE embedding_config ADD COLUMN benchmark_scores JSONB;
    ALTER TABLE embedding_config ADD COLUMN is_available BOOLEAN;
    ALTER TABLE embedding_config ADD COLUMN document_composition JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE embedding_config ADD COLUMN created_at_utc TEXT;
    ALTER TABLE embedding_config ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE embedding_config ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE embedding_set ALTER COLUMN is_system DROP NOT NULL;
    ALTER TABLE embedding_set ADD COLUMN usage_hints TEXT;
    ALTER TABLE embedding_set ADD COLUMN embedding_config_id TEXT REFERENCES embedding_config(id);
    ALTER TABLE embedding_set ADD COLUMN auto_embed_rules JSONB;
    ALTER TABLE embedding_set ADD COLUMN index_status TEXT NOT NULL DEFAULT 'empty';
    ALTER TABLE embedding_set ADD COLUMN index_type TEXT;
    ALTER TABLE embedding_set ADD COLUMN last_indexed_at TEXT;
    ALTER TABLE embedding_set ADD COLUMN embeddings_current BOOLEAN;
    ALTER TABLE embedding_set ADD COLUMN index_size_bytes BIGINT;
    ALTER TABLE embedding_set ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    ALTER TABLE embedding_set ADD COLUMN auto_refresh BOOLEAN;
    ALTER TABLE embedding_set ADD COLUMN refresh_interval TEXT;
    ALTER TABLE embedding_set ADD COLUMN last_refresh_at TEXT;
    ALTER TABLE embedding_set ADD COLUMN agent_metadata JSONB;
    ALTER TABLE embedding_set ADD COLUMN created_by TEXT;
    ALTER TABLE embedding_set ADD COLUMN created_at_utc TEXT;
    ALTER TABLE embedding_set ADD COLUMN updated_at_utc TEXT;
    ALTER TABLE embedding_set ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;

    DROP INDEX idx_embedding_vector;
    ALTER TABLE embedding ALTER COLUMN vector TYPE vector;
    ALTER TABLE embedding ALTER COLUMN vector DROP NOT NULL;
    ALTER TABLE embedding ALTER COLUMN note_id DROP NOT NULL;
    ALTER TABLE embedding ALTER COLUMN embedding_set_id DROP NOT NULL;
    ALTER TABLE embedding ALTER COLUMN created_at DROP NOT NULL;
    -- Retain scalar numeric precision without replacing the live vector index.
    ALTER TABLE embedding ADD COLUMN vector_values DOUBLE PRECISION[];
    ALTER TABLE embedding ADD COLUMN created_at_utc TEXT;
    ALTER TABLE embedding ADD COLUMN contract_fingerprint TEXT;
    ALTER TABLE embedding ADD COLUMN shard_contract_fingerprint_present BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX idx_embedding_vector ON embedding USING hnsw ((vector::vector(384)) vector_cosine_ops)
      WITH (m = 16, ef_construction = 64) WHERE vector_dims(vector) = 384;
    CREATE INDEX idx_embedding_vector_768 ON embedding USING hnsw ((vector::vector(768)) vector_cosine_ops)
      WITH (m = 16, ef_construction = 64) WHERE vector_dims(vector) = 768;

    ALTER TABLE embedding_set_member ALTER COLUMN membership_type DROP NOT NULL;
    ALTER TABLE embedding_set_member ALTER COLUMN added_at DROP NOT NULL;
    ALTER TABLE embedding_set_member ADD COLUMN added_at_utc TEXT;
    ALTER TABLE embedding_set_member ADD COLUMN shard_export_present BOOLEAN NOT NULL DEFAULT TRUE;
  `,
}
