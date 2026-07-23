/** Migration 0022: stable timestamps for live full-v1 embedding config production. */

import type { Migration } from '../migration-runner.js'

export const migration0022: Migration = {
  version: 22,
  name: '0022_embedding_config_timestamps',
  sql: `
    ALTER TABLE embedding_config
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE embedding_config
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `,
}
