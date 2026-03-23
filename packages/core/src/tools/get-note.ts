import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from '../event-bus.js'
import { z } from 'zod'
import { NotesRepository } from '../repositories/notes-repository.js'
import type { NoteFull } from '../repositories/types.js'

export const GetNoteInputSchema = z.object({ note_id: z.string() })
export type GetNoteInput = z.infer<typeof GetNoteInputSchema>

export async function getNote(db: PGlite, rawInput: unknown, events?: TypedEventBus): Promise<NoteFull> {
  const input = GetNoteInputSchema.parse(rawInput)
  const repo = new NotesRepository(db, events)
  return repo.get(input.note_id)
}
