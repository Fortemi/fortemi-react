/**
 * Migration 0016: Server embedding metadata.
 * Preserves chunked server embedding records while keeping local set scoping.
 */

import type { Migration } from '../migration-runner.js'

export const migration0016: Migration = {
  version: 16,
  name: '0016_embedding_server_metadata',
  sql: `
    ALTER TABLE embedding
      ADD COLUMN IF NOT EXISTS chunk_index INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE embedding
      ADD COLUMN IF NOT EXISTS text TEXT NOT NULL DEFAULT '';

    ALTER TABLE embedding
      ADD COLUMN IF NOT EXISTS model TEXT;

    ALTER TABLE embedding
      DROP CONSTRAINT IF EXISTS embedding_note_id_embedding_set_id_key;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_note_set_chunk
      ON embedding(note_id, embedding_set_id, chunk_index);
  `,
}
