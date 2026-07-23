/** Migration 0020: schema-validated complete full-v1 snapshot persistence. */

import type { Migration } from '../migration-runner.js'

export const migration0020: Migration = {
  version: 20,
  name: '0020_full_v1_snapshot',
  sql: `
    CREATE TABLE IF NOT EXISTS knowledge_shard_snapshot (
      schema_version TEXT NOT NULL,
      profile TEXT NOT NULL,
      archive_sha256 TEXT NOT NULL,
      manifest_json JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (schema_version, profile)
    );

    CREATE TABLE IF NOT EXISTS knowledge_shard_file (
      schema_version TEXT NOT NULL,
      profile TEXT NOT NULL,
      path TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      PRIMARY KEY (schema_version, profile, path),
      FOREIGN KEY (schema_version, profile)
        REFERENCES knowledge_shard_snapshot(schema_version, profile)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_shard_component_record (
      schema_version TEXT NOT NULL,
      profile TEXT NOT NULL,
      component TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      record_key TEXT NOT NULL,
      record_json JSONB NOT NULL,
      PRIMARY KEY (schema_version, profile, component, ordinal),
      UNIQUE (schema_version, profile, component, record_key),
      FOREIGN KEY (schema_version, profile)
        REFERENCES knowledge_shard_snapshot(schema_version, profile)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_shard_component_key
      ON knowledge_shard_component_record (component, record_key);

    CREATE TABLE IF NOT EXISTS knowledge_shard_blob_reference (
      schema_version TEXT NOT NULL,
      profile TEXT NOT NULL,
      checksum TEXT NOT NULL,
      ref_count INTEGER NOT NULL CHECK (ref_count > 0),
      PRIMARY KEY (schema_version, profile, checksum),
      FOREIGN KEY (schema_version, profile)
        REFERENCES knowledge_shard_snapshot(schema_version, profile)
        ON DELETE CASCADE
    );
  `,
}
