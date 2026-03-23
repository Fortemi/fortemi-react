/**
 * captureKnowledge — tool function for creating notes.
 *
 * Supports three sub-actions:
 *   create        — create a single note from content
 *   bulk_create   — create multiple notes in sequence
 *   from_template — interpolate a template string and create a note
 *
 * Input is Zod-validated at entry. All writes delegate to NotesRepository.
 */

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from '../event-bus.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import { CaptureKnowledgeInputSchema } from './schemas.js'
import type { NoteFull } from '../repositories/types.js'

export interface CaptureKnowledgeResult {
  action: string
  notes: NoteFull[]
}

export async function captureKnowledge(
  db: PGlite,
  rawInput: unknown,
  events?: TypedEventBus,
): Promise<CaptureKnowledgeResult> {
  const input = CaptureKnowledgeInputSchema.parse(rawInput)
  const repo = new NotesRepository(db, events)

  switch (input.action) {
    case 'create': {
      if (!input.content) throw new Error('content is required for create action')
      const note = await repo.create({
        content: input.content,
        title: input.title,
        format: input.format,
        source: input.source,
        visibility: input.visibility,
        tags: input.tags,
        archive_id: input.archive_id,
      })
      return { action: 'create', notes: [note] }
    }

    case 'bulk_create': {
      if (!input.notes?.length) throw new Error('notes array is required for bulk_create action')
      const results: NoteFull[] = []
      for (const noteInput of input.notes) {
        const note = await repo.create({
          content: noteInput.content,
          title: noteInput.title,
          format: noteInput.format,
          tags: noteInput.tags,
        })
        results.push(note)
      }
      return { action: 'bulk_create', notes: results }
    }

    case 'from_template': {
      if (!input.template) throw new Error('template is required for from_template action')
      let content = input.template
      if (input.variables) {
        for (const [key, value] of Object.entries(input.variables)) {
          content = content.replaceAll(`{{${key}}}`, value)
        }
      }
      const note = await repo.create({
        content,
        title: input.title,
        format: input.format,
        tags: input.tags,
      })
      return { action: 'from_template', notes: [note] }
    }
  }
}
