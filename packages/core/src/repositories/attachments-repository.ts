/**
 * AttachmentsRepository — attach and retrieve binary files linked to notes.
 *
 * Responsibilities:
 * - Content-addressed blob deduplication via the store-computed BLAKE3 hash
 * - Store blob metadata in DatabaseClient (attachment_blob table)
 * - Store binary data in a BlobStore implementation (bytes-first ordering)
 * - Create/soft-delete attachment records linked to notes
 * - List active attachments for a note
 * - Reconcile/GC blob bytes against the canonical manifest live set
 *   (ADR-013 D2/D4: manifests are the sole lifecycle authority)
 */

import type { DatabaseClient } from '../storage-backend.js'
import type {
  BlobStore,
  BlobGcOptions,
  BlobGcResult,
  BlobReconcileOptions,
  BlobReconcileResult,
} from '../blob-store.js'
import { generateId } from '../uuid.js'

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
   * Bytes are written first (`put()` is idempotent — content addressing makes
   * replays safe), then the metadata rows commit (ADR-013 D5). A crash
   * between the two leaves an unreferenced blob that reconcile/gc sweeps —
   * never a manifest without recoverable state. The store-computed BLAKE3
   * `content_hash` (`blake3:<hex>`) matches the server convention and is the
   * key used by the portable Knowledge-Shard byte sidecar.
   *
   * If a blob row with the same content hash already exists, it is reused
   * (deduplication) — re-putting the bytes also heals a previously
   * reference-only blob whose bytes went missing.
   *
   * Returns the newly created AttachmentRow.
   */
  async attach(input: AttachInput): Promise<AttachmentRow> {
    const contentHash = await this.blobStore.put(input.data)
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
      await this.db.query(
        `INSERT INTO attachment_blob (id, content_hash, size_bytes) VALUES ($1, $2, $3)`,
        [blobId, contentHash, sizeBytes],
      )
    }

    // ── attachment record ───────────────────────────────────────────────────
    // Browser extraction happens at attach time: text present == processing
    // done, which keeps the status-gated searchable-text join (0017, server
    // parity) including these rows.
    const attachmentId = generateId()
    await this.db.query(
      `INSERT INTO attachment (id, note_id, blob_id, filename, display_name, mime_type, extracted_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        attachmentId,
        input.noteId,
        blobId,
        input.filename,
        input.displayName ?? null,
        input.mimeType ?? null,
        input.extractedText ?? null,
        input.extractedText ? 'completed' : 'uploaded',
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
   * Returns null when the bytes are not present — the attachment is then in
   * the recoverable reference-only state (metadata intact, bytes
   * re-hydratable from a shard sidecar or a re-attach of the same content).
   */
  async getBlob(attachmentId: string): Promise<Uint8Array | null> {
    const checksum = await this.blobChecksumOf(attachmentId)
    if (checksum === null) return null
    return this.blobStore.read(checksum)
  }

  /**
   * True when the attachment's bytes are physically present in the BlobStore.
   * False means reference-only (recoverable), not an error.
   */
  async hasBlob(attachmentId: string): Promise<boolean> {
    const checksum = await this.blobChecksumOf(attachmentId)
    if (checksum === null) return false
    return this.blobStore.has(checksum)
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
   * The blob row is untouched and no bytes are removed inline — physical
   * removal happens only through deferred `reconcileBlobs()`/`gcBlobs()`
   * against the canonical live set (ADR-013 D4).
   */
  async delete(id: string): Promise<void> {
    await this.db.query(
      `UPDATE attachment SET deleted_at = now() WHERE id = $1`,
      [id],
    )
  }

  /**
   * The authoritative live-checksum set: content hashes referenced by at
   * least one non-deleted attachment. This — not any refcount — decides
   * which bytes are reachable.
   */
  async liveBlobChecksums(): Promise<string[]> {
    const result = await this.db.query<{ content_hash: string }>(
      `SELECT DISTINCT ab.content_hash
       FROM attachment_blob ab
       JOIN attachment a ON a.blob_id = ab.id
       WHERE a.deleted_at IS NULL`,
    )
    return result.rows.map((row) => row.content_hash)
  }

  /**
   * Reconcile the BlobStore against the canonical live set (startup, after
   * quota events, after interrupted writes). `missing` lists reference-only
   * checksums; `unreferenced` lists GC candidates.
   */
  async reconcileBlobs(opts?: BlobReconcileOptions): Promise<BlobReconcileResult> {
    return this.blobStore.reconcile(await this.liveBlobChecksums(), opts)
  }

  /**
   * Deferred, age-thresholded physical removal of unreachable bytes.
   * Runs a reconcile first so GC always acts on current manifest truth.
   */
  async gcBlobs(opts?: BlobGcOptions): Promise<BlobGcResult> {
    await this.reconcileBlobs()
    return this.blobStore.gc(opts)
  }

  private async blobChecksumOf(attachmentId: string): Promise<string | null> {
    const att = await this.get(attachmentId)
    const blob = await this.db.query<{ content_hash: string }>(
      `SELECT content_hash FROM attachment_blob WHERE id = $1`,
      [att.blob_id],
    )
    return blob.rows.length > 0 ? blob.rows[0].content_hash : null
  }
}
