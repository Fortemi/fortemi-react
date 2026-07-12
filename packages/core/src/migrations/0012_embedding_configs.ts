/**
 * Migration 0012: Server shard embedding configuration records.
 * Preserves embedding_configs.json rows from server-generated Knowledge Shards.
 */

import type { Migration } from '../migration-runner.js'

export const migration0012: Migration = {
  version: 12,
  name: '0012_embedding_configs',
  sql: `
    CREATE TABLE IF NOT EXISTS embedding_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      chunk_overlap INTEGER NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_config_default ON embedding_config(is_default);
  `,
}
