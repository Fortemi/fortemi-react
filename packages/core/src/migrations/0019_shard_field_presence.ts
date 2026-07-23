/** Migration 0019: transactional schema-2.0 field-presence sidecar. */

import type { Migration } from '../migration-runner.js'

export const migration0019: Migration = {
  version: 19,
  name: '0019_shard_field_presence',
  sql: `
    CREATE TABLE IF NOT EXISTS shard_field_presence (
      schema_version TEXT NOT NULL,
      profile TEXT NOT NULL,
      component TEXT NOT NULL,
      record_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('absent', 'null', 'empty', 'value', 'legacy-indeterminate')),
      PRIMARY KEY (schema_version, profile, component, record_id, field_path)
    );

    CREATE INDEX IF NOT EXISTS idx_shard_field_presence_record
      ON shard_field_presence (profile, component, record_id);
  `,
}
