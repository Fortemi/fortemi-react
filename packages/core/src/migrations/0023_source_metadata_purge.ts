/**
 * Migration 0023: source-addressed import, typed metadata indexes, and
 * terminal purge receipts.
 */

import type { Migration } from '../migration-runner.js'

export const migration0023: Migration = {
  version: 23,
  name: '0023_source_metadata_purge',
  sql: `
    CREATE TABLE IF NOT EXISTS source_identity (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      archive_id TEXT,
      namespace TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_id_hash TEXT NOT NULL,
      source_schema_version TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      import_run_id TEXT NOT NULL,
      caller_stable_id TEXT,
      note_id TEXT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, archive_id, namespace, external_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_identity_scope_key
      ON source_identity(tenant_id, COALESCE(archive_id, ''), namespace, external_id);
    CREATE INDEX IF NOT EXISTS idx_source_identity_note ON source_identity(note_id);
    CREATE INDEX IF NOT EXISTS idx_source_identity_import_run ON source_identity(import_run_id);
    CREATE INDEX IF NOT EXISTS idx_source_identity_hash ON source_identity(external_id_hash);

    CREATE TABLE IF NOT EXISTS source_import_run (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      archive_id TEXT,
      namespace TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      checkpoint JSONB NOT NULL DEFAULT '{}',
      receipt JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS metadata_index_path (
      path TEXT PRIMARY KEY,
      value_type TEXT NOT NULL,
      indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO metadata_index_path (path, value_type) VALUES
      ('provider', 'string'),
      ('model', 'string'),
      ('role', 'string'),
      ('event_kind', 'string'),
      ('sensitivity', 'string'),
      ('import_run_id', 'string')
    ON CONFLICT (path) DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_note_metadata_provider
      ON note_revised_current ((ai_metadata ->> 'provider'));
    CREATE INDEX IF NOT EXISTS idx_note_metadata_model
      ON note_revised_current ((ai_metadata ->> 'model'));
    CREATE INDEX IF NOT EXISTS idx_note_metadata_role
      ON note_revised_current ((ai_metadata ->> 'role'));
    CREATE INDEX IF NOT EXISTS idx_note_metadata_event_kind
      ON note_revised_current ((ai_metadata ->> 'event_kind'));
    CREATE INDEX IF NOT EXISTS idx_note_metadata_sensitivity
      ON note_revised_current ((ai_metadata ->> 'sensitivity'));

    CREATE TABLE IF NOT EXISTS deletion_receipt (
      id TEXT PRIMARY KEY,
      operation_key TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      archive_id TEXT,
      selector_hash TEXT NOT NULL,
      outcome TEXT NOT NULL,
      counts JSONB NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      policy JSONB NOT NULL DEFAULT '{}'
    );
  `,
}
