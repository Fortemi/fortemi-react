/**
 * Migration 0011: Server-compatible embedding set membership metadata.
 * Allows server shard memberships to exist before local vectors are materialized.
 */

import type { Migration } from '../migration-runner.js'

export const migration0011: Migration = {
  version: 11,
  name: '0011_embedding_member_metadata',
  sql: `
    ALTER TABLE embedding_set_member
      ALTER COLUMN embedding_id DROP NOT NULL;

    ALTER TABLE embedding_set_member
      ADD COLUMN IF NOT EXISTS membership_type TEXT NOT NULL DEFAULT 'materialized';

    ALTER TABLE embedding_set_member
      ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT now();

    ALTER TABLE embedding_set_member
      ADD COLUMN IF NOT EXISTS added_by TEXT;
  `,
}
