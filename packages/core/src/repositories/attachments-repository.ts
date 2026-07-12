/**
 * AttachmentsRepository — attach and retrieve binary files linked to notes.
 *
 * Responsibilities:
 * - Content-addressed blob deduplication via SHA-256 hash
 * - Store blob metadata in DatabaseClient (attachment_blob table)
 * - Store binary data in a BlobStore implementation
 * - Create/soft-delete attachment records linked to notes
 * - List active attachments for a note
 */

import type { DatabaseClient } from '../storage-backend.js'
import type { BlobStore } from '../blob-store.js'
import { generateId } from '../uuid.js'
import { computeBlobHash } from '../hash.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttachmentRow {
  id: string
  note_id: string
  blob_id: string
  document_type_id: string | null
  mime_type: string | null
  extracted_text: string | null
  filename: string
  display_name: string | null
  position: number
  created_at: Date
  deleted_at: Date | null
}

export interface AttachmentBlobRow {
  id: string
  content_hash: string
  size_bytes: number
  storage_path: string | null
  created_at: Date
}

export interface AttachInput {
  noteId: string
  data: Uint8Array
  filename: string
  mimeType?: string
  extractedText?: string
  displayName?: string
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AttachmentsRepository {
  constructor(
    private db: DatabaseClient,
    private blobStore: BlobStore,
  ) {}

  /**
   * Attach a binary file to a note.
   *
   * If a blob with the same BLAKE3 content hash already exists, the existing
   * blob row is reused (deduplication). Otherwise a new blob row is inserted
   * and the raw bytes are written to the BlobStore. The BLAKE3 `content_hash`
   * (`blake3:<hex>`) matches the server convention and is the key used by the
   * portable Knowledge-Shard byte sidecar.
   *
   * Returns the newly created AttachmentRow.
   */
  async attach(input: AttachInput): Promise<AttachmentRow> {
    const contentHash = computeBlobHash(input.data)
    const sizeBytes = input.data.length

    // ── blob deduplication ──────────────────────────────────────────────────
    let blobId: string
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM attachment_blob WHERE content_hash = $1`,
      [contentHash],
    )

    if (existing.rows.length > 0) {
      blobId = existing.rows[0].id
    } else {
      blobId = generateId()
      await this.blobStore.write(contentHash, input.data)
      await this.db.query(
        `INSERT INTO attachment_blob (id, content_hash, size_bytes) VALUES ($1, $2, $3)`,
        [blobId, contentHash, sizeBytes],
      )
    }

    // ── attachment record ───────────────────────────────────────────────────
    const attachmentId = generateId()
    await this.db.query(
      `INSERT INTO attachment (id, note_id, blob_id, filename, display_name, mime_type, extracted_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        attachmentId,
        input.noteId,
        blobId,
        input.filename,
        input.displayName ?? null,
        input.mimeType ?? null,
        input.extractedText ?? null,
      ],
    )

    return this.get(attachmentId)
  }

  /**
   * Fetch an attachment row by its ID.
   * Throws when no row exists.
   */
  async get(id: string): Promise<AttachmentRow> {
    const result = await this.db.query<AttachmentRow>(
      `SELECT * FROM attachment WHERE id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new Error(`Attachment not found: ${id}`)
    return result.rows[0]
  }

  /**
   * Retrieve the raw binary data for an attachment.
   * Returns null if the blob cannot be found in the BlobStore.
   */
  async getBlob(attachmentId: string): Promise<Uint8Array | null> {
    const att = await this.get(attachmentId)
    const blob = await this.db.query<{ content_hash: string }>(
      `SELECT content_hash FROM attachment_blob WHERE id = $1`,
      [att.blob_id],
    )
    if (blob.rows.length === 0) return null
    return this.blobStore.read(blob.rows[0].content_hash)
  }

  /**
   * List active (non-deleted) attachments for a note.
   * Ordered by position ascending, then created_at ascending.
   */
  async list(noteId: string): Promise<AttachmentRow[]> {
    const result = await this.db.query<AttachmentRow>(
      `SELECT * FROM attachment
       WHERE note_id = $1 AND deleted_at IS NULL
       ORDER BY position ASC, created_at ASC`,
      [noteId],
    )
    return result.rows
  }

  /**
   * Soft-delete an attachment by setting deleted_at to the current timestamp.
   * The underlying blob row and BlobStore data are not removed.
   */
  async delete(id: string): Promise<void> {
    await this.db.query(
      `UPDATE attachment SET deleted_at = now() WHERE id = $1`,
      [id],
    )
  }
}
