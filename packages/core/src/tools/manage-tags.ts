import type { PGlite } from '@electric-sql/pglite'
import { z } from 'zod'
import { TagsRepository } from '../repositories/tags-repository.js'

export const ManageTagsInputSchema = z.object({
  action: z.enum(['add', 'remove', 'list_for_note', 'list_all']),
  note_id: z.string().optional(),
  tag: z.string().optional(),
})
export type ManageTagsInput = z.infer<typeof ManageTagsInputSchema>

export interface ManageTagsResult {
  action: string
  tags?: string[]
  all_tags?: Array<{ tag: string; count: number }>
}

export async function manageTags(db: PGlite, rawInput: unknown): Promise<ManageTagsResult> {
  const input = ManageTagsInputSchema.parse(rawInput)
  const repo = new TagsRepository(db)

  switch (input.action) {
    case 'add': {
      if (!input.note_id || !input.tag) throw new Error('note_id and tag required for add')
      await repo.addTag(input.note_id, input.tag)
      const tags = await repo.getTagsForNote(input.note_id)
      return { action: 'add', tags }
    }
    case 'remove': {
      if (!input.note_id || !input.tag) throw new Error('note_id and tag required for remove')
      await repo.removeTag(input.note_id, input.tag)
      const tags = await repo.getTagsForNote(input.note_id)
      return { action: 'remove', tags }
    }
    case 'list_for_note': {
      if (!input.note_id) throw new Error('note_id required for list_for_note')
      const tags = await repo.getTagsForNote(input.note_id)
      return { action: 'list_for_note', tags }
    }
    case 'list_all': {
      const all_tags = await repo.listAllTags()
      return { action: 'list_all', all_tags }
    }
  }
}
