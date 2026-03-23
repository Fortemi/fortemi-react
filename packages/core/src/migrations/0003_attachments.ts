/**
 * Migration 0003: Attachments schema.
 * Creates: document_type, attachment_blob, attachment.
 */

import type { Migration } from '../migration-runner.js'

export const migration0003: Migration = {
  version: 3,
  name: '0003_attachments',
  sql: `
    -- Document type (MIME classification)
    CREATE TABLE IF NOT EXISTS document_type (
      id TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Attachment blob (content-addressable storage metadata)
    CREATE TABLE IF NOT EXISTS attachment_blob (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Attachment (links note to blob)
    CREATE TABLE IF NOT EXISTS attachment (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES note(id),
      blob_id TEXT NOT NULL REFERENCES attachment_blob(id),
      document_type_id TEXT REFERENCES document_type(id),
      filename TEXT NOT NULL,
      display_name TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_attachment_note ON attachment(note_id);
    CREATE INDEX IF NOT EXISTS idx_attachment_blob ON attachment(blob_id);
  `,
}
