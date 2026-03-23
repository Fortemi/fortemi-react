import type { PGlite } from '@electric-sql/pglite'
import { z } from 'zod'
import { AttachmentsRepository } from '../repositories/attachments-repository.js'
import type { AttachmentRow } from '../repositories/attachments-repository.js'
import type { BlobStore } from '../blob-store.js'

export const ManageAttachmentsInputSchema = z.object({
  action: z.enum(['attach', 'list', 'get', 'get_blob', 'delete']),
  note_id: z.string().optional(),
  attachment_id: z.string().optional(),
  /** Base64-encoded file data for the 'attach' action */
  data_base64: z.string().optional(),
  filename: z.string().optional(),
  mime_type: z.string().optional(),
  display_name: z.string().optional(),
})
export type ManageAttachmentsInput = z.infer<typeof ManageAttachmentsInputSchema>

export interface ManageAttachmentsResult {
  action: string
  attachment?: AttachmentRow
  attachments?: AttachmentRow[]
  attachment_id?: string
  /** Base64-encoded blob data for 'get_blob' action */
  data_base64?: string
  size_bytes?: number
}

export async function manageAttachments(
  db: PGlite,
  blobStore: BlobStore,
  rawInput: unknown,
): Promise<ManageAttachmentsResult> {
  const input = ManageAttachmentsInputSchema.parse(rawInput)
  const repo = new AttachmentsRepository(db, blobStore)

  switch (input.action) {
    case 'attach': {
      if (!input.note_id) throw new Error('note_id required for attach')
      if (!input.data_base64) throw new Error('data_base64 required for attach')
      if (!input.filename) throw new Error('filename required for attach')

      // Decode base64 to Uint8Array
      const binaryStr = atob(input.data_base64)
      const data = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) data[i] = binaryStr.charCodeAt(i)

      const attachment = await repo.attach({
        noteId: input.note_id,
        data,
        filename: input.filename,
        mimeType: input.mime_type,
        displayName: input.display_name,
      })
      return { action: 'attach', attachment, size_bytes: data.length }
    }
    case 'list': {
      if (!input.note_id) throw new Error('note_id required for list')
      const attachments = await repo.list(input.note_id)
      return { action: 'list', attachments }
    }
    case 'get': {
      if (!input.attachment_id) throw new Error('attachment_id required for get')
      const attachment = await repo.get(input.attachment_id)
      return { action: 'get', attachment }
    }
    case 'get_blob': {
      if (!input.attachment_id) throw new Error('attachment_id required for get_blob')
      const blob = await repo.getBlob(input.attachment_id)
      if (!blob) throw new Error(`Blob not found for attachment ${input.attachment_id}`)

      // Encode Uint8Array to base64 for JSON transport
      let binary = ''
      for (let i = 0; i < blob.length; i++) binary += String.fromCharCode(blob[i])
      const data_base64 = btoa(binary)

      return { action: 'get_blob', attachment_id: input.attachment_id, data_base64, size_bytes: blob.length }
    }
    case 'delete': {
      if (!input.attachment_id) throw new Error('attachment_id required for delete')
      await repo.delete(input.attachment_id)
      return { action: 'delete', attachment_id: input.attachment_id }
    }
  }
}
