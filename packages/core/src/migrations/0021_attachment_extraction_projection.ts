/** Migration 0021: lossless Knowledge Shard attachment extraction projection. */

import type { Migration } from '../migration-runner.js'

export const migration0021: Migration = {
  version: 21,
  name: '0021_attachment_extraction_projection',
  sql: `
    ALTER TABLE attachment
      ADD COLUMN IF NOT EXISTS extraction_status TEXT;
    ALTER TABLE attachment
      ADD COLUMN IF NOT EXISTS extraction_reason TEXT;
  `,
}
