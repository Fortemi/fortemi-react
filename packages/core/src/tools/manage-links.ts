import type { PGlite } from '@electric-sql/pglite'
import { z } from 'zod'
import { LinksRepository } from '../repositories/links-repository.js'
import type { LinkRow } from '../repositories/links-repository.js'

export const ManageLinksInputSchema = z.object({
  action: z.enum(['create', 'list', 'backlinks', 'delete']),
  source_note_id: z.string().optional(),
  target_note_id: z.string().optional(),
  link_id: z.string().optional(),
  link_type: z.string().default('related'),
  note_id: z.string().optional(),
})
export type ManageLinksInput = z.infer<typeof ManageLinksInputSchema>

export interface ManageLinksResult {
  action: string
  link?: LinkRow
  outbound?: LinkRow[]
  inbound?: LinkRow[]
  backlinks?: string[]
  link_id?: string
}

export async function manageLinks(db: PGlite, rawInput: unknown): Promise<ManageLinksResult> {
  const input = ManageLinksInputSchema.parse(rawInput)
  const repo = new LinksRepository(db)

  switch (input.action) {
    case 'create': {
      if (!input.source_note_id || !input.target_note_id) throw new Error('source_note_id and target_note_id required')
      const link = await repo.create(input.source_note_id, input.target_note_id, input.link_type)
      return { action: 'create', link }
    }
    case 'list': {
      if (!input.note_id) throw new Error('note_id required for list')
      const { outbound, inbound } = await repo.listForNote(input.note_id)
      return { action: 'list', outbound, inbound }
    }
    case 'backlinks': {
      if (!input.note_id) throw new Error('note_id required for backlinks')
      const backlinks = await repo.getBacklinks(input.note_id)
      return { action: 'backlinks', backlinks }
    }
    case 'delete': {
      if (!input.link_id) throw new Error('link_id required for delete')
      await repo.delete(input.link_id)
      return { action: 'delete', link_id: input.link_id }
    }
  }
}
