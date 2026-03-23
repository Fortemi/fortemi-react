/**
 * Shared SQL condition builder for note filtering.
 * Used by both SearchRepository and NotesRepository to prevent drift
 * when adding new filter fields.
 *
 * @implements #87 shared condition builder
 */

import type { SearchOptions } from './types.js'

export interface ConditionResult {
  conditions: string[]
  params: unknown[]
  nextIdx: number
}

/**
 * Build WHERE clause conditions for note filtering.
 * Generates parameterized SQL conditions for all shared filter fields.
 *
 * @param options - Filter options (any subset of SearchOptions fields)
 * @param startIdx - Starting parameter index ($N)
 * @param includeDeleted - Whether to include soft-deleted notes (default: false)
 */
export function buildNoteConditions(
  options: Pick<SearchOptions, 'tags' | 'collection_id' | 'date_from' | 'date_to' | 'is_starred' | 'is_archived' | 'format' | 'source' | 'visibility'>,
  startIdx: number,
  includeDeleted = false,
): ConditionResult {
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = startIdx

  if (!includeDeleted) {
    conditions.push('n.deleted_at IS NULL')
  }

  if (options.tags?.length) {
    conditions.push(
      `EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag = ANY($${idx++}))`,
    )
    params.push(options.tags)
  }

  if (options.collection_id) {
    conditions.push(
      `EXISTS (SELECT 1 FROM collection_note cn WHERE cn.note_id = n.id AND cn.collection_id = $${idx++})`,
    )
    params.push(options.collection_id)
  }

  if (options.date_from) {
    conditions.push(`n.created_at >= $${idx++}`)
    params.push(options.date_from)
  }

  if (options.date_to) {
    conditions.push(`n.created_at <= $${idx++}`)
    params.push(options.date_to)
  }

  if (options.is_starred !== undefined) {
    conditions.push(`n.is_starred = $${idx++}`)
    params.push(options.is_starred)
  }

  if (options.is_archived !== undefined) {
    conditions.push(`n.is_archived = $${idx++}`)
    params.push(options.is_archived)
  }

  if (options.format) {
    conditions.push(`n.format = $${idx++}`)
    params.push(options.format)
  }

  if (options.source) {
    conditions.push(`n.source = $${idx++}`)
    params.push(options.source)
  }

  if (options.visibility) {
    conditions.push(`n.visibility = $${idx++}`)
    params.push(options.visibility)
  }

  return { conditions, params, nextIdx: idx }
}
