/**
 * Migration 0006: Embedding set authoring metadata.
 * Adds human-facing labels so multiple embedding sets can be selected in UI.
 */

import type { Migration } from '../migration-runner.js'

export const migration0006: Migration = {
  version: 6,
  name: '0006_embedding_set_metadata',
  sql: `
    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Full content';

    ALTER TABLE embedding_set
      ADD COLUMN IF NOT EXISTS purpose TEXT;
  `,
}
