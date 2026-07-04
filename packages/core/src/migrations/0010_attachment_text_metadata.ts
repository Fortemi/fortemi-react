/**
 * Migration 0010: attachment extracted-text metadata.
 *
 * Raw bytes stay in BlobStore only. Search/export/index surfaces carry extracted
 * text plus a reference to the content-addressed attachment metadata.
 */

import type { Migration } from '../migration-runner.js'

export const migration0010: Migration = {
  version: 10,
  name: '0010_attachment_text_metadata',
  sql: `
    ALTER TABLE attachment
      ADD COLUMN IF NOT EXISTS mime_type TEXT;

    ALTER TABLE attachment
      ADD COLUMN IF NOT EXISTS extracted_text TEXT;
  `,
}
