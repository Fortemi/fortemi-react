/**
 * Migration 0017: attachment_blob / attachment schema parity + attachment_embedding.
 *
 * PGlite is the optional PROJECTION of canonical attachment state (#320,
 * ADR-013): bytes never live here, and `attachment_blob.reference_count` is
 * DERIVED projection data — rebuilt from canonical attachment manifests by
 * `projectAttachments()`, never consulted for lifecycle decisions, and
 * deliberately maintained WITHOUT triggers (no second mutable refcount
 * authority; ADR-013 amends the earlier trigger plan in the #282 design doc).
 *
 * Parity source: server migration `20260203000000_attachment_doctype_integration.sql`
 * (v2026.7.0). Documented divergences (see db-table-parity fixtures):
 * - `data` / `object_key` / `object_bucket` are intentionally omitted — bytes
 *   live in the Bytecask BlobStore, never in PGlite.
 * - browser `position` maps to server `display_order` in the shard field-mapper.
 * - `storage_type` uses browser vocabulary `'bytecask' | 'memory'` (honest
 *   about where bytes live) vs server `'database' | 'object_storage'`.
 */

import type { Migration } from '../migration-runner.js'

export const migration0017: Migration = {
  version: 17,
  name: '0017_attachment_blob_parity',
  sql: `
    -- ── attachment_blob parity ─────────────────────────────────────────────
    ALTER TABLE attachment_blob
      ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'application/octet-stream';

    ALTER TABLE attachment_blob
      ADD COLUMN IF NOT EXISTS storage_type TEXT NOT NULL DEFAULT 'bytecask';

    -- DERIVED projection state (ADR-013): rebuilt from canonical manifests;
    -- no trigger maintains it and nothing may treat it as lifecycle truth.
    ALTER TABLE attachment_blob
      ADD COLUMN IF NOT EXISTS reference_count INTEGER NOT NULL DEFAULT 0;

    -- Backfill content_type from the attachment-level MIME denormalization (0010).
    UPDATE attachment_blob ab
    SET content_type = a.mime_type
    FROM attachment a
    WHERE a.blob_id = ab.id
      AND a.mime_type IS NOT NULL
      AND ab.content_type = 'application/octet-stream';

    -- Backfill the derived reference count from live manifests.
    UPDATE attachment_blob ab
    SET reference_count = (
      SELECT COUNT(*) FROM attachment a
      WHERE a.blob_id = ab.id AND a.deleted_at IS NULL
    );

    -- Orphan scan support (projection-side reporting only).
    CREATE INDEX IF NOT EXISTS idx_attachment_blob_orphan
      ON attachment_blob(reference_count) WHERE reference_count = 0;

    -- ── attachment parity additions (additive, nullable-first) ─────────────
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS original_filename TEXT;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uploaded'
      CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed', 'quarantined'));
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS processing_error TEXT;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS extraction_strategy TEXT;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS extraction_config JSONB DEFAULT '{}';
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS extracted_metadata JSONB;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS ai_description TEXT;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS has_preview BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE attachment ADD COLUMN IF NOT EXISTS preview_blob_id TEXT REFERENCES attachment_blob(id);

    -- Backfill: browser attachments that already carry extracted text were
    -- fully processed at attach time — mark them completed so the
    -- status-gated searchable-text join (server parity) keeps including them.
    UPDATE attachment SET status = 'completed'
    WHERE extracted_text IS NOT NULL AND extracted_text <> '';

    -- ── attachment_embedding (server parity; CLIP column reserved) ─────────
    CREATE TABLE IF NOT EXISTS attachment_embedding (
      id TEXT PRIMARY KEY,
      attachment_id TEXT NOT NULL REFERENCES attachment(id),
      embedding_set_id TEXT REFERENCES embedding_set(id),
      chunk_index INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      vector vector(768),
      clip_vector vector(512),
      model TEXT NOT NULL,
      embedding_type TEXT NOT NULL DEFAULT 'text',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (attachment_id, embedding_set_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_attachment_embedding_attachment
      ON attachment_embedding(attachment_id);
  `,
}
