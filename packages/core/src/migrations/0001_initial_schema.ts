/**
 * Migration 0001: Core tables.
 * Creates: archive, note, note_original, note_revised_current,
 *          note_revision, collection, job_queue, api_key, link,
 *          provenance_edge.
 * All tables use UUIDv7 PKs, soft-delete (deleted_at), timestamps.
 */

import type { Migration } from '../migration-runner.js'

export const migration0001: Migration = {
  version: 1,
  name: '0001_initial_schema',
  sql: `
    -- Archive (multi-database tracking)
    CREATE TABLE IF NOT EXISTS archive (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Note (core entity)
    CREATE TABLE IF NOT EXISTS note (
      id TEXT PRIMARY KEY,
      archive_id TEXT REFERENCES archive(id),
      title TEXT,
      format TEXT NOT NULL DEFAULT 'markdown',
      source TEXT NOT NULL DEFAULT 'user',
      visibility TEXT NOT NULL DEFAULT 'private',
      revision_mode TEXT NOT NULL DEFAULT 'standard',
      is_starred BOOLEAN NOT NULL DEFAULT false,
      is_pinned BOOLEAN NOT NULL DEFAULT false,
      is_archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED
    );

    -- Note original content (immutable)
    CREATE TABLE IF NOT EXISTS note_original (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Note revised current (mutable, latest revision)
    CREATE TABLE IF NOT EXISTS note_revised_current (
      note_id TEXT PRIMARY KEY REFERENCES note(id),
      content TEXT NOT NULL,
      ai_metadata JSONB,
      generation_count INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      is_user_edited BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Note revision history
    CREATE TABLE IF NOT EXISTS note_revision (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      revision_number INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'ai',
      content TEXT NOT NULL,
      ai_metadata JSONB,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (note_id, revision_number)
    );

    -- Collection (folders/categories)
    CREATE TABLE IF NOT EXISTS collection (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT REFERENCES collection(id),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- Collection membership
    CREATE TABLE IF NOT EXISTS collection_note (
      collection_id TEXT NOT NULL REFERENCES collection(id),
      note_id TEXT NOT NULL REFERENCES note(id),
      position INTEGER NOT NULL DEFAULT 0,
      added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, note_id)
    );

    -- Job queue (async processing)
    CREATE TABLE IF NOT EXISTS job_queue (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 5,
      required_capability TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- API key
    CREATE TABLE IF NOT EXISTS api_key (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '[]',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- Link (bidirectional note links)
    CREATE TABLE IF NOT EXISTS link (
      id TEXT PRIMARY KEY,
      source_note_id TEXT NOT NULL REFERENCES note(id),
      target_note_id TEXT NOT NULL REFERENCES note(id),
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- Provenance edge
    CREATE TABLE IF NOT EXISTS provenance_edge (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      activity TEXT NOT NULL,
      agent TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ,
      attributes JSONB
    );

    CREATE INDEX IF NOT EXISTS idx_note_deleted_at ON note(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_note_created_at ON note(created_at);
    CREATE INDEX IF NOT EXISTS idx_note_tsv ON note USING gin(tsv);
    CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_job_queue_note ON job_queue(note_id);
    CREATE INDEX IF NOT EXISTS idx_collection_parent ON collection(parent_id);
    CREATE INDEX IF NOT EXISTS idx_link_source ON link(source_note_id);
    CREATE INDEX IF NOT EXISTS idx_link_target ON link(target_note_id);
    CREATE INDEX IF NOT EXISTS idx_provenance_entity ON provenance_edge(entity_type, entity_id);
  `,
}
