import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from '../event-bus.js'
import { z } from 'zod'
import { NotesRepository } from '../repositories/notes-repository.js'
import type { NoteSummary, PaginatedResult } from '../repositories/types.js'

export const ListNotesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'updated_at', 'title']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  is_starred: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  collection_id: z.string().optional(),
  include_deleted: z.boolean().optional(),
})
export type ListNotesInput = z.infer<typeof ListNotesInputSchema>

export async function listNotes(db: PGlite, rawInput: unknown, events?: TypedEventBus): Promise<PaginatedResult<NoteSummary>> {
  const input = ListNotesInputSchema.parse(rawInput)
  const repo = new NotesRepository(db, events)
  return repo.list(input)
}
