/**
 * Migration 0005: Add confidence score and updated_at to link table.
 * The linkingHandler stores similarity confidence (1 - cosine distance)
 * and the server's link table includes these columns.
 */

import type { Migration } from '../migration-runner.js'

export const migration0005: Migration = {
  version: 5,
  name: '0005_link_confidence',
  sql: `
    ALTER TABLE link ADD COLUMN IF NOT EXISTS confidence REAL;
    ALTER TABLE link ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  `,
}
