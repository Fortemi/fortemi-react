/**
 * PGlite attachment projection (#320, ADR-013 D3).
 *
 * Projects canonical attachment state (RecordStore) into the optional PGlite
 * `attachment_blob` / `attachment` tables. Properties:
 *
 * - Idempotent: every row upserts on its primary key; re-running with the
 *   same canonical state changes nothing.
 * - Rebuildable: dropping the projection rows and re-projecting yields
 *   equivalent query results — the canonical records are the source of truth.
 * - Derived refcounts: `attachment_blob.reference_count` is recomputed from
 *   live manifests on every projection pass; it is never lifecycle authority
 *   and no trigger touches it.
 * - Bytes never enter PGlite; only metadata is projected.
 */

import type { DatabaseClient } from '../storage-backend.js'
import type { RecordStore } from './types.js'

export interface AttachmentProjectionResult {
  blobs: number
  attachments: number
}

/**
 * Project all canonical attachment records into PGlite. Safe to run at any
 * time: startup, after journal consumption, or as a full rebuild after the
 * projection was dropped.
 *
 * The parent `note` rows must already exist in the projection (note
 * projection is the #323 cycle-2 surface); this function owns only the
 * attachment tables.
 */
export async function projectAttachments(
  db: DatabaseClient,
  store: RecordStore,
): Promise<AttachmentProjectionResult> {
  const blobs = await store.list('attachment_blob')
  const attachments = await store.list('attachment')

  for (const blob of blobs) {
    await db.query(
      `INSERT INTO attachment_blob (id, content_hash, size_bytes, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         size_bytes = EXCLUDED.size_bytes`,
      [blob.id, blob.content_hash, blob.size_bytes, blob.created_at],
    )
  }

  for (const att of attachments) {
    await db.query(
      `INSERT INTO attachment (
         id, note_id, blob_id, document_type_id, mime_type, extracted_text,
         filename, display_name, position, status, created_at, deleted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         mime_type = EXCLUDED.mime_type,
         extracted_text = EXCLUDED.extracted_text,
         filename = EXCLUDED.filename,
         display_name = EXCLUDED.display_name,
         position = EXCLUDED.position,
         status = EXCLUDED.status,
         deleted_at = EXCLUDED.deleted_at`,
      [
        att.id,
        att.note_id,
        att.blob_id,
        att.document_type_id,
        att.mime_type,
        att.extracted_text,
        att.filename,
        att.display_name,
        att.position,
        // Browser attach-time extraction: text present == processing done.
        att.extracted_text !== null && att.extracted_text !== '' ? 'completed' : 'uploaded',
        att.created_at,
        att.deleted_at,
      ],
    )
  }

  // Derived reference counts — recomputed wholesale from live manifests.
  await db.query(
    `UPDATE attachment_blob ab
     SET reference_count = (
       SELECT COUNT(*) FROM attachment a
       WHERE a.blob_id = ab.id AND a.deleted_at IS NULL
     )`,
  )

  return { blobs: blobs.length, attachments: attachments.length }
}

/**
 * Drop the attachment projection rows (test/rebuild support). Canonical
 * records and Bytecask bytes are untouched — this is the "PGlite can be
 * dropped and rebuilt" invariant made executable.
 */
export async function dropAttachmentProjection(db: DatabaseClient): Promise<void> {
  await db.query(`DELETE FROM attachment_embedding`)
  await db.query(`DELETE FROM attachment`)
  await db.query(`DELETE FROM attachment_blob`)
}
