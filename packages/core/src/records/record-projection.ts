/**
 * PGlite record projection — notes tier (#323 cycle 2, ADR-013 D3).
 *
 * Projects canonical note / tag / link / collection state (RecordStore) into
 * the optional PGlite tables, completing the projection the attachment tier
 * (#320, attachment-projection.ts) deferred to this cycle. Properties:
 *
 * - Idempotent: rows upsert on their primary keys; re-running with the same
 *   canonical state changes nothing.
 * - Rebuildable: dropping the projection rows and re-projecting yields
 *   equivalent query results — canonical records are the source of truth.
 * - Reconciling: canonically hard-removed rows (note_tag, collection_note)
 *   are deleted from the projection so parity holds after removals, not just
 *   after inserts.
 * - Bytes never enter PGlite; `projectRecords` composes this pass with the
 *   attachment projection for a full canonical → PGlite rebuild.
 */

import type { DatabaseClient } from '../storage-backend.js'
import type { RecordStore } from './types.js'
import { projectAttachments } from './attachment-projection.js'
import type { AttachmentProjectionResult } from './attachment-projection.js'

export interface NoteProjectionResult {
  notes: number
  tags: number
  links: number
  collections: number
  memberships: number
}

export interface RecordProjectionResult extends NoteProjectionResult {
  attachments: AttachmentProjectionResult
}

/**
 * Project all canonical note-tier records into PGlite. Safe to run at any
 * time: startup, after journal consumption, or as a full rebuild after the
 * projection was dropped. Parent rows land before children (note before
 * note_original / tags / links / memberships) so FKs hold.
 */
export async function projectNotes(
  db: DatabaseClient,
  store: RecordStore,
): Promise<NoteProjectionResult> {
  const [noteRows, originals, revised, tags, links, collections, memberships] = await Promise.all([
    store.list('note'),
    store.list('note_original'),
    store.list('note_revised_current'),
    store.list('note_tag'),
    store.list('link'),
    store.list('collection'),
    store.list('collection_note'),
  ])

  for (const c of collections) {
    await db.query(
      `INSERT INTO collection (id, name, description, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at`,
      [c.id, c.name, c.description, c.created_at, c.updated_at, c.deleted_at],
    )
  }

  for (const n of noteRows) {
    await db.query(
      `INSERT INTO note (
         id, archive_id, title, format, source, visibility, revision_mode,
         is_starred, is_pinned, is_archived, created_at, updated_at, deleted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         archive_id = EXCLUDED.archive_id,
         title = EXCLUDED.title,
         format = EXCLUDED.format,
         source = EXCLUDED.source,
         visibility = EXCLUDED.visibility,
         revision_mode = EXCLUDED.revision_mode,
         is_starred = EXCLUDED.is_starred,
         is_pinned = EXCLUDED.is_pinned,
         is_archived = EXCLUDED.is_archived,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at`,
      [
        n.id, n.archive_id, n.title, n.format, n.source, n.visibility,
        n.revision_mode, n.is_starred, n.is_pinned, n.is_archived,
        n.created_at, n.updated_at, n.deleted_at,
      ],
    )
  }

  for (const o of originals) {
    await db.query(
      `INSERT INTO note_original (id, note_id, content, content_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash`,
      [o.id, o.note_id, o.content, o.content_hash, o.created_at],
    )
  }

  for (const r of revised) {
    await db.query(
      `INSERT INTO note_revised_current (
         note_id, content, ai_metadata, generation_count, model, is_user_edited, updated_at
       )
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       ON CONFLICT (note_id) DO UPDATE SET
         content = EXCLUDED.content,
         ai_metadata = EXCLUDED.ai_metadata,
         generation_count = EXCLUDED.generation_count,
         model = EXCLUDED.model,
         is_user_edited = EXCLUDED.is_user_edited,
         updated_at = EXCLUDED.updated_at`,
      [
        r.id, r.content,
        r.ai_metadata == null ? null : JSON.stringify(r.ai_metadata),
        r.generation_count, r.model, r.is_user_edited, r.updated_at,
      ],
    )
  }

  // note_tag rows are hard-removed canonically — upsert live rows, then
  // reconcile away projected rows the canon no longer holds.
  for (const t of tags) {
    await db.query(
      `INSERT INTO note_tag (id, note_id, tag, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (note_id, tag) DO NOTHING`,
      [t.id, t.note_id, t.tag, t.created_at],
    )
  }
  await db.query(
    `DELETE FROM note_tag WHERE NOT (id = ANY($1::text[]))`,
    [tags.map((t) => t.id)],
  )

  for (const l of links) {
    await db.query(
      `INSERT INTO link (id, source_note_id, target_note_id, link_type, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         link_type = EXCLUDED.link_type,
         deleted_at = EXCLUDED.deleted_at`,
      [l.id, l.source_note_id, l.target_note_id, l.link_type, l.created_at, l.deleted_at],
    )
  }

  // collection_note is hard-removed canonically and keyed (collection_id,
  // note_id) in SQL (canonical `created_at` projects to `added_at`).
  for (const m of memberships) {
    await db.query(
      `INSERT INTO collection_note (collection_id, note_id, position, added_at)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (collection_id, note_id) DO NOTHING`,
      [m.collection_id, m.note_id, m.created_at],
    )
  }
  await db.query(
    `DELETE FROM collection_note WHERE NOT ((collection_id || ':' || note_id) = ANY($1::text[]))`,
    [memberships.map((m) => `${m.collection_id}:${m.note_id}`)],
  )

  return {
    notes: noteRows.length,
    tags: tags.length,
    links: links.length,
    collections: collections.length,
    memberships: memberships.length,
  }
}

/**
 * Full canonical → PGlite projection: note tier, then attachment tier
 * (parents before children). This is the "PGlite is a derived, rebuildable
 * projection" invariant (#322 acceptance) made executable.
 */
export async function projectRecords(
  db: DatabaseClient,
  store: RecordStore,
): Promise<RecordProjectionResult> {
  const notes = await projectNotes(db, store)
  const attachments = await projectAttachments(db, store)
  return { ...notes, attachments }
}

/**
 * Drop the note-tier projection rows (test/rebuild support). Canonical
 * records are untouched. Callers must drop dependent projections first
 * (attachments via `dropAttachmentProjection`, plus any embedding/SKOS rows
 * created outside the canonical tier) so FKs allow the deletes.
 */
export async function dropNoteProjection(db: DatabaseClient): Promise<void> {
  await db.query(`DELETE FROM collection_note`)
  await db.query(`DELETE FROM note_tag`)
  await db.query(`DELETE FROM link`)
  await db.query(`DELETE FROM note_revised_current`)
  await db.query(`DELETE FROM note_revision`)
  await db.query(`DELETE FROM note_original`)
  await db.query(`DELETE FROM job_queue`)
  await db.query(`DELETE FROM note`)
  await db.query(`DELETE FROM collection`)
}
