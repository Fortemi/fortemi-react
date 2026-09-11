import { computeHash } from '../hash.js'
import type { QueryExecutor } from '../storage-backend.js'
import type { NativeApplyProgress } from './native-fields.js'

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

export interface NativeHistoryApplyOptions {
  /** Public restore first moves retained activities away from omitted revisions. */
  deferRevisionCleanup?: boolean
}

export async function removeOmittedNativeRevisions(tx: QueryExecutor, noteIds: readonly string[], retainedRevisionIds: readonly string[]): Promise<void> {
  if (noteIds.length === 0) return
  const owners = noteIds.map(uuid)
  const omitted = (await tx.query<{ id: string }>(
    'SELECT id FROM note_revision WHERE note_id = ANY($1::text[]) AND NOT (id = ANY($2::text[])) ORDER BY id FOR UPDATE',
    [owners, retainedRevisionIds.map(uuid)],
  )).rows.map((row) => row.id)
  const references = await tx.query(`SELECT 1 FROM provenance_edge WHERE revision_id = ANY($1::text[])
    UNION ALL SELECT 1 FROM note_revised_current WHERE last_revision_id = ANY($1::text[])
      AND NOT (note_id = ANY($2::text[])) LIMIT 1`, [omitted, owners])
  if (references.rows.length) throw new Error('Omitted native revisions are referenced by retained live records')
  await tx.query(`UPDATE note_revised_current SET last_revision_id = NULL
    WHERE note_id = ANY($1::text[]) AND last_revision_id = ANY($2::text[])`, [owners, omitted])
  await tx.query('DELETE FROM note_revision WHERE id = ANY($1::text[])', [omitted])
}

/**
 * Internal apply stage, not an archive importer. The caller validates the whole
 * archive and resolves native note conflicts before starting one transaction.
 * Only notes supplied here are replaced; their native note rows must exist.
 */
export async function replaceValidatedNativeNoteHistory(
  tx: QueryExecutor,
  notes: readonly NativeHistoryNote[],
  history: NativeNoteHistory,
  progress?: NativeApplyProgress,
  options: NativeHistoryApplyOptions = {},
): Promise<Record<keyof NativeNoteHistory, number>> {
  const selected = new Set(notes.map((note) => uuid(note.id)))
  const originals = new Map(history.note_originals.map((row) => [uuid(row.note_id), row]))
  const currents = new Map(history.note_revised_current.map((row) => [uuid(row.note_id), row]))
  const revisions = new Map(history.note_revisions.map((row) => [uuid(row.id), row]))
  const counts = { note_originals: 0, note_original_history: 0, note_revisions: 0, note_revised_current: 0 }
  if (selected.size === 0) return counts
  await tx.query(`DELETE FROM note_original_history WHERE note_id = ANY($1::text[])
    AND NOT (id = ANY($2::text[]))`, [[...selected], history.note_original_history.map((row) => uuid(row.id))])
  for (const note of notes) {
    const noteId = uuid(note.id)
    const original = originals.get(noteId)
    await tx.query(
      `INSERT INTO note_original (id, note_id, content, content_hash, created_at,
         version_number, user_created_at, user_last_edited_at, shard_export_present)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (note_id) DO UPDATE SET id = EXCLUDED.id, content = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash, created_at = EXCLUDED.created_at,
         version_number = EXCLUDED.version_number, user_created_at = EXCLUDED.user_created_at,
         user_last_edited_at = EXCLUDED.user_last_edited_at, shard_export_present = EXCLUDED.shard_export_present`,
      [original ? nullableUuid(original.id) : null, noteId, original?.content ?? note.original_content,
        original?.hash ?? computeHash(new TextEncoder().encode(note.original_content)), note.created_at,
        original?.version_number ?? 1, original?.user_created_at ?? null,
        original?.user_last_edited_at ?? null, original !== undefined],
    )
    if (original) { counts.note_originals++; await progress?.('note_originals') }
  }
  for (const row of history.note_original_history) {
    if (!selected.has(uuid(row.note_id))) continue
    await tx.query(
      `INSERT INTO note_original_history
         (id, note_id, version_number, content, hash, created_at_utc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET note_id = EXCLUDED.note_id,
         version_number = EXCLUDED.version_number, content = EXCLUDED.content,
         hash = EXCLUDED.hash, created_at_utc = EXCLUDED.created_at_utc, created_by = EXCLUDED.created_by`,
      [uuid(row.id), uuid(row.note_id), row.version_number, row.content, row.hash, row.created_at_utc, row.created_by],
    )
    counts.note_original_history++
    await progress?.('note_original_history')
  }
  for (const row of history.note_revisions) {
    if (!selected.has(uuid(row.note_id))) continue
    await tx.query(
      `INSERT INTO note_revision (id, note_id, parent_revision_id, revision_number, content, type,
         summary, rationale, created_at, created_at_utc, ai_generated_at, user_last_edited_at,
         is_user_edited, generation_count, model, shard_export_present)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::timestamptz, $9::text, $10, $11, $12, $13, $14, TRUE)
       ON CONFLICT (id) DO UPDATE SET note_id = EXCLUDED.note_id,
         parent_revision_id = EXCLUDED.parent_revision_id, revision_number = EXCLUDED.revision_number,
         content = EXCLUDED.content, type = EXCLUDED.type, summary = EXCLUDED.summary,
         rationale = EXCLUDED.rationale, created_at = EXCLUDED.created_at, created_at_utc = EXCLUDED.created_at_utc,
         ai_generated_at = EXCLUDED.ai_generated_at, user_last_edited_at = EXCLUDED.user_last_edited_at,
         is_user_edited = EXCLUDED.is_user_edited, generation_count = EXCLUDED.generation_count,
         model = EXCLUDED.model, ai_metadata = EXCLUDED.ai_metadata, shard_export_present = TRUE`,
      [uuid(row.id), uuid(row.note_id), nullableUuid(row.parent_revision_id), row.revision_number,
        row.content, row.type, row.summary, row.rationale, row.created_at_utc,
        row.ai_generated_at, row.user_last_edited_at, row.is_user_edited, row.generation_count, row.model],
    )
    counts.note_revisions++
    await progress?.('note_revisions')
  }
  for (const note of notes) {
    const noteId = uuid(note.id)
    const current = currents.get(noteId)
    const last = current?.last_revision_id ? revisions.get(uuid(current.last_revision_id)) : undefined
    await tx.query(
      `INSERT INTO note_revised_current (note_id, content, last_revision_id, ai_metadata,
         generation_count, model, is_user_edited, updated_at, shard_export_present)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       ON CONFLICT (note_id) DO UPDATE SET content = EXCLUDED.content,
         last_revision_id = EXCLUDED.last_revision_id, ai_metadata = EXCLUDED.ai_metadata,
         generation_count = EXCLUDED.generation_count, model = EXCLUDED.model,
         is_user_edited = EXCLUDED.is_user_edited, updated_at = EXCLUDED.updated_at,
         shard_export_present = EXCLUDED.shard_export_present`,
      [noteId, current ? current.content : note.revised_content, current ? nullableUuid(current.last_revision_id) : null,
        JSON.stringify(current ? current.ai_metadata : note.metadata), last?.generation_count ?? 0,
        last?.model ?? null, last?.is_user_edited ?? false, note.updated_at, current !== undefined],
    )
    if (current) { counts.note_revised_current++; await progress?.('note_revised_current') }
  }
  if (!options.deferRevisionCleanup) await removeOmittedNativeRevisions(tx, [...selected],
    history.note_revisions.filter((row) => selected.has(uuid(row.note_id))).map((row) => row.id))
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
