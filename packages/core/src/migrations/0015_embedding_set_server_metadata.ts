/**
 * Migration 0015: Server embedding set metadata.
 * Preserves server shard fields that do not exist in the React-native selector model.
 */

import type { Migration } from '../migration-runner.js'

export const migration0015: Migration = {
  version: 15,
  name: '0015_embedding_set_server_metadata',
  sql: `
    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS slug TEXT;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS description TEXT;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS document_count INTEGER;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS embedding_count INTEGER;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS keywords_json JSONB;
  `,
}
