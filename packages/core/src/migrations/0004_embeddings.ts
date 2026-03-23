/**
 * Migration 0004: Embeddings and vector linking schema.
 * Creates: embedding_set, embedding, embedding_set_member.
 * Requires: pgvector extension (loaded via PGlite vector extension).
 */

import type { Migration } from '../migration-runner.js'

export const migration0004: Migration = {
  version: 4,
  name: '0004_embeddings',
  sql: `
    -- Embedding set (model configuration)
    CREATE TABLE IF NOT EXISTS embedding_set (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      dimensions INTEGER NOT NULL DEFAULT 384,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Embedding (vector per note)
    CREATE TABLE IF NOT EXISTS embedding (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      embedding_set_id TEXT NOT NULL REFERENCES embedding_set(id),
      vector vector(384) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (note_id, embedding_set_id)
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_note ON embedding(note_id);
    CREATE INDEX IF NOT EXISTS idx_embedding_set ON embedding(embedding_set_id);
    CREATE INDEX IF NOT EXISTS idx_embedding_vector ON embedding USING hnsw (vector vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);

    -- Embedding set member (tracks which notes have embeddings)
    CREATE TABLE IF NOT EXISTS embedding_set_member (
      embedding_set_id TEXT NOT NULL REFERENCES embedding_set(id),
      note_id TEXT NOT NULL REFERENCES note(id),
      embedding_id TEXT NOT NULL REFERENCES embedding(id),
      PRIMARY KEY (embedding_set_id, note_id)
    );
  `,
}
