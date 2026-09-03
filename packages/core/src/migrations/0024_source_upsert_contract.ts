/** Migration 0024: source-addressed atomic batch replay journal (contract 1.0.0). */

import type { Migration } from '../migration-runner.js'

export const migration0024: Migration = {
  version: 24,
  name: '0024_source_upsert_contract',
  sql: `
    ALTER TABLE source_import_run ADD COLUMN IF NOT EXISTS external_run_id TEXT;
    ALTER TABLE source_import_run ADD COLUMN IF NOT EXISTS source_id TEXT;
    ALTER TABLE source_import_run ADD COLUMN IF NOT EXISTS source_schema_version TEXT;
    ALTER TABLE source_import_run ADD COLUMN IF NOT EXISTS workspace_id TEXT;
    UPDATE source_import_run SET external_run_id = id WHERE external_run_id IS NULL;
    UPDATE source_import_run SET source_schema_version = 'legacy' WHERE source_schema_version IS NULL;
    ALTER TABLE source_import_run ALTER COLUMN external_run_id SET NOT NULL;
    ALTER TABLE source_import_run ALTER COLUMN source_schema_version SET NOT NULL;
    ALTER TABLE source_import_run ADD CONSTRAINT source_import_run_contract_lengths
      CHECK (
        length(external_run_id) BETWEEN 1 AND 200
        AND (source_id IS NULL OR length(source_id) BETWEEN 1 AND 500)
        AND length(source_schema_version) BETWEEN 1 AND 100
        AND (workspace_id IS NULL OR length(workspace_id) BETWEEN 1 AND 500)
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_import_run_scope
      ON source_import_run(tenant_id, COALESCE(archive_id, ''), namespace, external_run_id);

    ALTER TABLE source_identity ADD COLUMN IF NOT EXISTS source_id TEXT;
    ALTER TABLE source_identity ADD CONSTRAINT source_identity_source_id_length
      CHECK (source_id IS NULL OR length(source_id) BETWEEN 1 AND 500);

    CREATE TABLE IF NOT EXISTS source_import_batch (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      archive_id TEXT,
      namespace TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      import_run_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      checkpoint JSONB NOT NULL DEFAULT '{}',
      receipt JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_import_batch_scope
      ON source_import_batch(tenant_id, COALESCE(archive_id, ''), namespace, batch_id);
    CREATE INDEX IF NOT EXISTS idx_source_import_batch_run
      ON source_import_batch(import_run_id);
  `,
}
