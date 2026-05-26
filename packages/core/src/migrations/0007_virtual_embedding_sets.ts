/**
 * Migration 0007: Virtual embedding set metadata.
 * Adds durable selector-definition fields while preserving existing physical sets.
 */

import type { Migration } from '../migration-runner.js'

export const migration0007: Migration = {
  version: 7,
  name: '0007_virtual_embedding_sets',
  sql: `
    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'physical';

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS mode TEXT;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS truncate_dimension INTEGER;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS criteria_json JSONB;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS source_json JSONB;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS compatibility_json JSONB;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS materialization_json JSONB;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS freshness_json JSONB;

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `,
}
