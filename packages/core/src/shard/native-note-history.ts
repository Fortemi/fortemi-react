import { computeHash } from '../hash.js'
import type { QueryExecutor } from '../storage-backend.js'

export interface NativeHistoryNote {
  id: string
  original_content: string
  revised_content: string
  metadata: unknown
  created_at: string
  updated_at: string
}

export interface NativeOriginal {
  id: string | null
  note_id: string
  content: string
  hash: string
  user_created_at: string | null
  user_last_edited_at: string | null
  version_number: number
}

export interface NativeOriginalHistory {
  id: string
  note_id: string
  version_number: number
  content: string
  hash: string
  created_at_utc: string
  created_by: string
}

export interface NativeRevision {
  id: string
  note_id: string
  parent_revision_id: string | null
  revision_number: number
  content: string
  type: string
  summary: string | null
  rationale: string | null
  created_at_utc: string
  ai_generated_at: string | null
  user_last_edited_at: string | null
  is_user_edited: boolean
  generation_count: number
  model: string | null
}

export interface NativeCurrentRevision {
  note_id: string
  /** Native state permits null; full-v1 export must reject it, not substitute content. */
  content: string | null
  last_revision_id: string | null
  ai_metadata: unknown
}

export interface NativeNoteHistory {
  note_originals: NativeOriginal[]
  note_original_history: NativeOriginalHistory[]
  note_revisions: NativeRevision[]
  note_revised_current: NativeCurrentRevision[]
}

const uuid = (value: string): string => value.toLowerCase()
const nullableUuid = (value: string | null): string | null => value === null ? null : uuid(value)

/**
 * Internal apply stage, not an archive importer. The caller validates the whole
 * archive and resolves native note conflicts before starting one transaction.
 * Only notes supplied here are replaced; their native note rows must exist.
 */
export async function replaceValidatedNativeNoteHistory(
  tx: QueryExecutor,
  notes: readonly NativeHistoryNote[],
  history: NativeNoteHistory,
): Promise<Record<keyof NativeNoteHistory, number>> {
  const selected = new Set(notes.map((note) => uuid(note.id)))
  const originals = new Map(history.note_originals.map((row) => [uuid(row.note_id), row]))
  const currents = new Map(history.note_revised_current.map((row) => [uuid(row.note_id), row]))
  const revisions = new Map(history.note_revisions.map((row) => [uuid(row.id), row]))
  const counts = { note_originals: 0, note_original_history: 0, note_revisions: 0, note_revised_current: 0 }
  if (selected.size === 0) return counts
  for (const table of ['note_revised_current', 'note_original_history', 'note_revision', 'note_original']) {
    await tx.query(`DELETE FROM ${table} WHERE note_id = ANY($1)`, [[...selected]])
  }
  for (const note of notes) {
    const noteId = uuid(note.id)
    const original = originals.get(noteId)
    await tx.query(
      `INSERT INTO note_original (id, note_id, content, content_hash, created_at,
         version_number, user_created_at, user_last_edited_at, shard_export_present)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [original ? nullableUuid(original.id) : null, noteId, original?.content ?? note.original_content,
        original?.hash ?? computeHash(new TextEncoder().encode(note.original_content)), note.created_at,
        original?.version_number ?? 1, original?.user_created_at ?? null,
        original?.user_last_edited_at ?? null, original !== undefined],
    )
    if (original) counts.note_originals++
  }
  for (const row of history.note_original_history) {
    if (!selected.has(uuid(row.note_id))) continue
    await tx.query(
      `INSERT INTO note_original_history
         (id, note_id, version_number, content, hash, created_at_utc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(row.id), uuid(row.note_id), row.version_number, row.content, row.hash, row.created_at_utc, row.created_by],
    )
    counts.note_original_history++
  }
  for (const row of history.note_revisions) {
    if (!selected.has(uuid(row.note_id))) continue
    await tx.query(
      `INSERT INTO note_revision (id, note_id, parent_revision_id, revision_number, content, type,
         summary, rationale, created_at, created_at_utc, ai_generated_at, user_last_edited_at,
         is_user_edited, generation_count, model, shard_export_present)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::timestamptz, $9::text, $10, $11, $12, $13, $14, TRUE)`,
      [uuid(row.id), uuid(row.note_id), nullableUuid(row.parent_revision_id), row.revision_number,
        row.content, row.type, row.summary, row.rationale, row.created_at_utc,
        row.ai_generated_at, row.user_last_edited_at, row.is_user_edited, row.generation_count, row.model],
    )
    counts.note_revisions++
  }
  for (const note of notes) {
    const noteId = uuid(note.id)
    const current = currents.get(noteId)
    const last = current?.last_revision_id ? revisions.get(uuid(current.last_revision_id)) : undefined
    await tx.query(
      `INSERT INTO note_revised_current (note_id, content, last_revision_id, ai_metadata,
         generation_count, model, is_user_edited, updated_at, shard_export_present)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
      [noteId, current ? current.content : note.revised_content, current ? nullableUuid(current.last_revision_id) : null,
        JSON.stringify(current ? current.ai_metadata : note.metadata), last?.generation_count ?? 0,
        last?.model ?? null, last?.is_user_edited ?? false, note.updated_at, current !== undefined],
    )
    if (current) counts.note_revised_current++
  }
  return counts
}

/** Read typed native state. Fallback live-required rows are not wire records. */
export async function readNativeNoteHistory(
  tx: QueryExecutor,
  noteIds?: readonly string[],
): Promise<NativeNoteHistory> {
  const filter = noteIds ? ' AND note_id = ANY($1)' : ''
  const params = noteIds ? [noteIds.map(uuid)] : []
  const originals = await tx.query<NativeOriginal>(
    `SELECT id, note_id, content, content_hash AS hash, user_created_at, user_last_edited_at, version_number
       FROM note_original WHERE shard_export_present${filter} ORDER BY note_id`, params,
  )
  const originalHistory = await tx.query<NativeOriginalHistory>(
    `SELECT id, note_id, version_number, content, hash, created_at_utc, created_by
       FROM note_original_history WHERE TRUE${filter} ORDER BY note_id, version_number`, params,
  )
  const revisions = await tx.query<NativeRevision>(
    `SELECT id, note_id, parent_revision_id, revision_number, content, type, summary, rationale,
       CASE WHEN created_at_utc::timestamptz = created_at THEN created_at_utc
         ELSE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS created_at_utc,
       ai_generated_at, user_last_edited_at, is_user_edited, generation_count, model
       FROM note_revision WHERE shard_export_present${filter} ORDER BY note_id, revision_number`, params,
  )
  const current = await tx.query<NativeCurrentRevision>(
    `SELECT note_id, content, last_revision_id, ai_metadata FROM note_revised_current
       WHERE shard_export_present${filter} ORDER BY note_id`, params,
  )
  return { note_originals: originals.rows, note_original_history: originalHistory.rows,
    note_revisions: revisions.rows, note_revised_current: current.rows }
}
