/**
 * Canonical attachments repository — DB-free attachment manifests over the
 * RecordStore, bytes through the Bytecask BlobStore (#323, ADR-013 D2/D4/D5).
 *
 * Same lifecycle semantics as the SQL-backed AttachmentsRepository: bytes
 * first (idempotent put), then manifest commit; soft-delete never removes
 * bytes inline; the manifest-derived live set drives reconcile/gc; missing
 * bytes are the recoverable reference-only state.
 */

import type { RecordStore } from './types.js'
import type { AttachmentRecord } from './types.js'
import type {
  BlobStore,
  BlobGcOptions,
  BlobGcResult,
  BlobReconcileOptions,
  BlobReconcileResult,
} from '../blob-store.js'
import { generateId } from '../uuid.js'

export interface CanonicalAttachInput {
  noteId: string
  data: Uint8Array
  filename: string
  mimeType?: string
  extractedText?: string
  displayName?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

export class CanonicalAttachmentsRepository {
  constructor(
    private store: RecordStore,
    private blobStore: BlobStore,
  ) {}

  /** Bytes-first attach (ADR-013 D5); dedupes on the store-computed hash. */
  async attach(input: CanonicalAttachInput): Promise<AttachmentRecord> {
    const contentHash = await this.blobStore.put(input.data)

    let blob = (await this.store.list('attachment_blob')).find(
      (b) => b.content_hash === contentHash,
    )
    if (!blob) {
      blob = {
        id: generateId(),
        content_hash: contentHash,
        size_bytes: input.data.length,
        created_at: nowIso(),
      }
      await this.store.put('attachment_blob', blob)
    }

    const attachment: AttachmentRecord = {
      id: generateId(),
      note_id: input.noteId,
      blob_id: blob.id,
      document_type_id: null,
      mime_type: input.mimeType ?? null,
      extracted_text: input.extractedText ?? null,
      filename: input.filename,
      display_name: input.displayName ?? null,
      position: 0,
      created_at: nowIso(),
      deleted_at: null,
    }
    await this.store.put('attachment', attachment)
    return attachment
  }

  async get(id: string): Promise<AttachmentRecord> {
    const attachment = await this.store.get('attachment', id)
    if (!attachment) throw new Error(`Attachment not found: ${id}`)
    return attachment
  }

  /** Null when bytes are absent — the recoverable reference-only state. */
  async getBlob(attachmentId: string): Promise<Uint8Array | null> {
    const checksum = await this.checksumOf(attachmentId)
    return checksum === null ? null : this.blobStore.read(checksum)
  }

  async hasBlob(attachmentId: string): Promise<boolean> {
    const checksum = await this.checksumOf(attachmentId)
    return checksum === null ? false : this.blobStore.has(checksum)
  }

  async list(noteId: string): Promise<AttachmentRecord[]> {
    const items = (await this.store.list('attachment')).filter(
      (a) => a.note_id === noteId && a.deleted_at === null,
    )
    items.sort(
      (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
    )
    return items
  }

  /** Soft-delete the manifest; bytes are only swept via reconcile/gc. */
  async delete(id: string): Promise<void> {
    const attachment = await this.get(id)
    await this.store.put('attachment', { ...attachment, deleted_at: nowIso() })
  }

  /** Authoritative live set: hashes referenced by non-deleted manifests. */
  async liveBlobChecksums(): Promise<string[]> {
    const liveBlobIds = new Set(
      (await this.store.list('attachment'))
        .filter((a) => a.deleted_at === null)
        .map((a) => a.blob_id),
    )
    return (await this.store.list('attachment_blob'))
      .filter((b) => liveBlobIds.has(b.id))
      .map((b) => b.content_hash)
  }

  /** Startup / post-quota reconciliation against canonical manifests (ADR-013 D4). */
  async reconcileBlobs(opts?: BlobReconcileOptions): Promise<BlobReconcileResult> {
    return this.blobStore.reconcile(await this.liveBlobChecksums(), opts)
  }

  /** Deferred reachability-based blob GC. */
  async gcBlobs(opts?: BlobGcOptions): Promise<BlobGcResult> {
    await this.reconcileBlobs()
    return this.blobStore.gc(opts)
  }

  private async checksumOf(attachmentId: string): Promise<string | null> {
    const attachment = await this.get(attachmentId)
    const blob = await this.store.get('attachment_blob', attachment.blob_id)
    return blob?.content_hash ?? null
  }
}
