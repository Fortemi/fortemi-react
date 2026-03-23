/**
 * AttachmentsRepository — attach and retrieve binary files linked to notes.
 *
 * Responsibilities:
 * - Content-addressed blob deduplication via SHA-256 hash
 * - Store blob metadata in PGlite (attachment_blob table)
 * - Store binary data in a BlobStore implementation
 * - Create/soft-delete attachment records linked to notes
 * - List active attachments for a note
 */

import type { PGlite } from '@electric-sql/pglite'
import type { BlobStore } from '../blob-store.js'
import { generateId } from '../uuid.js'
import { computeHash } from '../hash.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttachmentRow {
  id: string
  note_id: string
  blob_id: string
  document_type_id: string | null
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
  displayName?: string
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AttachmentsRepository {
  constructor(
    private db: PGlite,
    private blobStore: BlobStore,
  ) {}

  /**
   * Attach a binary file to a note.
   *
   * If a blob with the same SHA-256 content hash already exists, the existing
   * blob row is reused (deduplication). Otherwise a new blob row is inserted
   * and the raw bytes are written to the BlobStore.
   *
   * Returns the newly created AttachmentRow.
   */
  async attach(input: AttachInput): Promise<AttachmentRow> {
    const contentHash = computeHash(input.data)
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
      `INSERT INTO attachment (id, note_id, blob_id, filename, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [attachmentId, input.noteId, blobId, input.filename, input.displayName ?? null],
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
