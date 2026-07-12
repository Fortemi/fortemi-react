/**
 * Migration 0013: Server shard note templates.
 * Preserves templates.json rows from server-generated Knowledge Shards.
 */

import type { Migration } from '../migration-runner.js'

export const migration0013: Migration = {
  version: 13,
  name: '0013_templates',
  sql: `
    CREATE TABLE IF NOT EXISTS template (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'markdown',
      default_tags JSONB NOT NULL DEFAULT '[]',
      collection_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_template_collection ON template(collection_id);
  `,
}
