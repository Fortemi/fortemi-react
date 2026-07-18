/**
 * Migration 0018: Preserve an explicit null current revision from legacy
 * Knowledge Shards without coalescing it to original or empty content.
 */

import type { Migration } from '../migration-runner.js'

export const migration0018: Migration = {
  version: 18,
  name: '0018_nullable_revised_content',
  sql: `
    ALTER TABLE note_revised_current
      ALTER COLUMN content DROP NOT NULL;
  `,
}
