/**
 * Migration 0014: Server shard URL-target links.
 * Stores shard links whose target is a URL instead of a local note.
 */

import type { Migration } from '../migration-runner.js'

export const migration0014: Migration = {
  version: 14,
  name: '0014_url_links',
  sql: `
    CREATE TABLE IF NOT EXISTS link_url_target (
      id TEXT PRIMARY KEY,
      source_note_id TEXT NOT NULL,
      to_url TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'reference',
      confidence REAL,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_link_url_source ON link_url_target(source_note_id);
  `,
}
