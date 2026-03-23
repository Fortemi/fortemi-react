/**
 * manageNote — tool function for note lifecycle operations.
 *
 * Supports: update, delete, restore, archive, unarchive, star, unstar.
 *
 * Input is Zod-validated at entry. All mutations delegate to NotesRepository.
 */

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from '../event-bus.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import { ManageNoteInputSchema } from './schemas.js'
import type { NoteFull } from '../repositories/types.js'

export interface ManageNoteResult {
  action: string
  note_id: string
  note?: NoteFull
}

export async function manageNote(
  db: PGlite,
  rawInput: unknown,
  events?: TypedEventBus,
): Promise<ManageNoteResult> {
  const input = ManageNoteInputSchema.parse(rawInput)
  const repo = new NotesRepository(db, events)

  switch (input.action) {
    case 'update': {
      const note = await repo.update(input.note_id, {
        title: input.title,
        content: input.content,
        format: input.format,
        visibility: input.visibility,
      })
      return { action: 'update', note_id: input.note_id, note }
    }

    case 'delete': {
      await repo.delete(input.note_id)
      return { action: 'delete', note_id: input.note_id }
    }

    case 'restore': {
      const note = await repo.restore(input.note_id)
      return { action: 'restore', note_id: input.note_id, note }
    }

    case 'archive': {
      await repo.archive(input.note_id, true)
      const note = await repo.get(input.note_id)
      return { action: 'archive', note_id: input.note_id, note }
    }

    case 'unarchive': {
      await repo.archive(input.note_id, false)
      const note = await repo.get(input.note_id)
      return { action: 'unarchive', note_id: input.note_id, note }
    }

    case 'star': {
      await repo.star(input.note_id, true)
      const note = await repo.get(input.note_id)
      return { action: 'star', note_id: input.note_id, note }
    }

    case 'unstar': {
      await repo.star(input.note_id, false)
      const note = await repo.get(input.note_id)
      return { action: 'unstar', note_id: input.note_id, note }
    }
  }
}
