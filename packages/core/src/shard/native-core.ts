import type { QueryExecutor } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { nativeUuid, selectNativeFields, upsertNativeFields, type NativeFields, type NativeApplyProgress } from './native-fields.js'
import { replaceValidatedNativeNoteHistory, type NativeNoteHistory, type NativeHistoryApplyOptions } from './native-note-history.js'
import { validateShardComponentRecord } from './schema-validator.js'

export interface NativeAttachmentProjection {
  extracted_text: string | null
  extraction_status: 'extracted' | 'pending' | 'failed' | 'blocked' | 'deferred'
  reason: null | 'extraction_pending' | 'extractor_failed' | 'quarantined' | 'large_binary' | 'unsupported_mime' | 'no_extracted_text'
  attachment: { id: string; path: string; mime: string; checksum: string; bytes: number }
}
export interface NativeNote {
  id: string
  title: string | null
  original_content: string
  revised_content: string
  metadata: unknown
  format: string
  source: string
  starred: boolean
  archived: boolean
  collection_id: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  tags: string[]
  attachments: NativeAttachmentProjection[]
}
export interface NativeCollection {
  id: string; name: string; description: string | null; parent_id: string | null; created_at: string; note_count: number
}
export interface NativeTag { name: string; created_at: string }
export interface NativeTemplate {
  id: string; name: string; description: string | null; content: string; format: string
  default_tags: string[]; collection_id: string | null; created_at: string; updated_at: string
}
export interface NativeLink {
  id: string; from_note_id: string; to_note_id: string | null; to_url: string | null
  kind: string; score: number; created_at: string; metadata: unknown
}
export interface NativeCore {
  notes: NativeNote[]; collections: NativeCollection[]; tags: NativeTag[]; templates: NativeTemplate[]; links: NativeLink[]
}

const noteFields = {
  id: { kind: 'uuid' }, title: {}, metadata: { kind: 'json' }, format: {}, source: {},
  starred: { column: 'is_starred' }, archived: { column: 'is_archived' },
  created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' }, deleted_at: { kind: 'timestamp' },
} satisfies Partial<NativeFields<NativeNote>>
const collectionFields = {
  id: { kind: 'uuid' }, name: {}, description: {}, parent_id: { kind: 'uuid' }, created_at: { kind: 'timestamp' },
} satisfies Partial<NativeFields<NativeCollection>>
const tagFields = { name: {}, created_at: { kind: 'timestamp' } } satisfies NativeFields<NativeTag>
const templateFields = {
  id: { kind: 'uuid' }, name: {}, description: {}, content: {}, format: {}, default_tags: { kind: 'json' },
  collection_id: { kind: 'uuid' }, created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
} satisfies NativeFields<NativeTemplate>
const linkFields = {
  id: { kind: 'uuid' }, from_note_id: { column: 'source_note_id', kind: 'uuid' }, kind: { column: 'link_type' },
  score: { column: 'confidence' }, created_at: { kind: 'timestamp' }, metadata: { column: 'metadata_json', kind: 'json' },
} satisfies Partial<NativeFields<NativeLink>>

/** Internal stage: caller owns archive/signature/blob validation, conflicts and
 * the complete transaction. Only supplied records and selected-note children
 * are replaced; no jobs, archive rows or blob lifecycle decisions are made. */
export async function applyValidatedNativeCore(tx: QueryExecutor, state: NativeCore, history: NativeNoteHistory, progress?: NativeApplyProgress, historyOptions?: NativeHistoryApplyOptions): Promise<void> {
  for (const row of state.collections) await upsertNativeFields(tx, 'collection', row, collectionFields, ['id'], { deleted_at: null })
  for (const row of state.tags) {
    await upsertNativeFields(tx, 'tag', row, tagFields, ['name'], { shard_export_present: true })
    await progress?.('tags')
  }
  for (const row of state.notes) {
    await upsertNativeFields(tx, 'note', { ...row, deleted_at: row.deleted_at ?? null }, noteFields, ['id'], { metadata_independent: true })
    // Explicit import presence wins after the ordinary tombstone-update trigger.
    await tx.query('UPDATE note SET shard_deleted_at_present = $2 WHERE id = $1', [nativeUuid(row.id), Object.hasOwn(row, 'deleted_at')])
  }
  await replaceValidatedNativeNoteHistory(tx, state.notes, history, progress, historyOptions)
  for (const row of state.notes) {
    const id = nativeUuid(row.id)
    await tx.query('DELETE FROM collection_note WHERE note_id = $1 AND collection_id IS DISTINCT FROM $2', [id, nativeUuid(row.collection_id)])
    if (row.collection_id !== null) await tx.query(`INSERT INTO collection_note (collection_id, note_id, added_at)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [nativeUuid(row.collection_id), id, row.created_at])
    await tx.query('DELETE FROM note_tag WHERE note_id = $1 AND NOT (tag = ANY($2))', [id, row.tags])
    for (const [position, tag] of row.tags.entries()) {
      // A live-required membership need not imply a declared tags component row.
      await tx.query(`INSERT INTO tag (name, created_at, shard_export_present) VALUES ($1, $2, FALSE) ON CONFLICT DO NOTHING`, [tag, row.created_at])
      await tx.query(`INSERT INTO note_tag (id, note_id, tag, position, created_at) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (note_id, tag) DO UPDATE SET position = EXCLUDED.position`, [generateId(), id, tag, position, row.created_at])
    }
    const ids = row.attachments.map((projection) => nativeUuid(projection.attachment.id))
    await tx.query(`DELETE FROM attachment_embedding WHERE attachment_id IN
      (SELECT id FROM attachment WHERE note_id = $1 AND NOT (id = ANY($2)))`, [id, ids])
    await tx.query('DELETE FROM attachment WHERE note_id = $1 AND NOT (id = ANY($2))', [id, ids])
    for (const [position, projection] of row.attachments.entries()) {
      const ref = projection.attachment
      const existing = await tx.query<{ id: string; size_bytes: number }>('SELECT id, size_bytes FROM attachment_blob WHERE content_hash = $1', [ref.checksum])
      if (existing.rows[0] && existing.rows[0].size_bytes !== ref.bytes) throw new Error('Native attachment blob size conflicts with validated reference')
      const blobId = existing.rows[0]?.id ?? generateId()
      if (!existing.rows.length) await tx.query(`INSERT INTO attachment_blob (id, content_hash, size_bytes, content_type)
        VALUES ($1, $2, $3, $4)`, [blobId, ref.checksum, ref.bytes, ref.mime])
      const status = { extracted: 'completed', pending: 'uploaded', failed: 'failed', blocked: 'quarantined', deferred: 'uploaded' }[projection.extraction_status]
      await tx.query(`INSERT INTO attachment
        (id, note_id, blob_id, filename, mime_type, extracted_text, extraction_status, extraction_reason, position, created_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET note_id = EXCLUDED.note_id, blob_id = EXCLUDED.blob_id, filename = EXCLUDED.filename,
          mime_type = EXCLUDED.mime_type, extracted_text = EXCLUDED.extracted_text, extraction_status = EXCLUDED.extraction_status,
          extraction_reason = EXCLUDED.extraction_reason, position = EXCLUDED.position, status = EXCLUDED.status, deleted_at = NULL`,
      [nativeUuid(ref.id), id, blobId, ref.path, ref.mime, projection.extracted_text, projection.extraction_status, projection.reason, position, row.created_at, status])
      await tx.query('UPDATE attachment SET extraction_status = $2, extraction_reason = $3 WHERE id = $1',
        [nativeUuid(ref.id), projection.extraction_status, projection.reason])
    }
    await progress?.('notes')
  }
  // Producer semantics: restore snapshot counts after membership mutations.
  for (const row of state.collections) {
    await tx.query('UPDATE collection SET shard_note_count = $2 WHERE id = $1', [nativeUuid(row.id), row.note_count])
    await progress?.('collections')
  }
  for (const row of state.templates) {
    await upsertNativeFields(tx, 'template', row, templateFields, ['id'])
    await progress?.('templates')
  }
  for (const row of state.links) {
    const url = row.to_note_id === null
    if (url && !(await tx.query('SELECT 1 FROM note WHERE id = $1', [nativeUuid(row.from_note_id)])).rows.length) {
      throw new Error('Native URL link owner is missing')
    }
    await tx.query(`DELETE FROM ${url ? 'link' : 'link_url_target'} WHERE id = $1`, [nativeUuid(row.id)])
    await upsertNativeFields(tx, url ? 'link_url_target' : 'link', row,
      url ? { ...linkFields, to_url: {} } : { ...linkFields, to_note_id: { column: 'target_note_id', kind: 'uuid' } }, ['id'], { deleted_at: null })
    await progress?.('links')
  }
  // Reporting projection only. Manifest reachability, never this count, owns GC.
  await tx.query(`UPDATE attachment_blob ab SET reference_count = (SELECT COUNT(*) FROM attachment a
    WHERE a.blob_id = ab.id AND a.deleted_at IS NULL)`)
}

function checked<K extends keyof NativeCore>(component: K, rows: NativeCore[K]): NativeCore[K] {
  for (const row of rows) if (!validateShardComponentRecord(component, row, 'full-v1', '2.0.0').valid) {
    throw new Error(`Native ${component} state is not representable in 2.0.0/full-v1`)
  }
  return rows
}

function byNote<T extends { note_id: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const row of rows) {
    const group = result.get(row.note_id) ?? []
    group.push(row); result.set(row.note_id, group)
  }
  return result
}

export async function readNativeTags(tx: QueryExecutor, deferValidation = false): Promise<NativeTag[]> {
  const rows = (await tx.query<NativeTag>(`SELECT ${selectNativeFields(tagFields)} FROM tag WHERE shard_export_present ORDER BY name`)).rows
  return deferValidation ? rows : checked('tags', rows)
}
export async function readNativeTemplates(tx: QueryExecutor, id?: string, deferValidation = false): Promise<NativeTemplate[]> {
  const rows = (await tx.query<NativeTemplate>(`SELECT ${selectNativeFields(templateFields)} FROM template
    ${id === undefined ? '' : 'WHERE id = $1'} ORDER BY id`, id === undefined ? [] : [nativeUuid(id)])).rows
  return deferValidation ? rows : checked('templates', rows)
}

export async function readNativeLinks(tx: QueryExecutor, id?: string, deferValidation = false): Promise<NativeLink[]> {
  const filter = id === undefined ? '' : ' AND id = $1'
  const links = (await tx.query<NativeLink>(`SELECT ${selectNativeFields(linkFields)}, target_note_id AS to_note_id, NULL::text AS to_url FROM link WHERE deleted_at IS NULL${filter}
    UNION ALL SELECT ${selectNativeFields(linkFields)}, NULL::text AS to_note_id, to_url FROM link_url_target WHERE deleted_at IS NULL${filter} ORDER BY id`,
  id === undefined ? [] : [nativeUuid(id)])).rows
  if (deferValidation) return links
  if (new Set(links.map((link) => link.id)).size !== links.length) throw new Error('Duplicate native link identity')
  return checked('links', links)
}

export async function readNativeCollections(tx: QueryExecutor, id?: string, deferValidation = false): Promise<NativeCollection[]> {
  const rows = (await tx.query<NativeCollection>(`SELECT ${selectNativeFields(collectionFields)},
    COALESCE(shard_note_count, (SELECT COUNT(*)::integer FROM collection_note WHERE collection_id = collection.id)) AS note_count
    FROM collection WHERE deleted_at IS NULL${id === undefined ? '' : ' AND id = $1'} ORDER BY id`,
    id === undefined ? [] : [nativeUuid(id)])).rows
  return deferValidation ? rows : checked('collections', rows)
}

/** Unscoped internal reader; the public serializer must apply validated scope
 * closure before checking selected state. No archived component is consulted. */
export async function readNativeCore(tx: QueryExecutor, options: { noteIds?: readonly string[]; deferValidation?: boolean } = {}): Promise<NativeCore> {
  for (const table of options.deferValidation ? [] : ['collection', 'link', 'link_url_target', 'attachment']) {
    if ((await tx.query(`SELECT 1 FROM ${table} WHERE deleted_at IS NOT NULL LIMIT 1`)).rows.length) {
      throw new Error(`Native ${table} tombstone has no full-v1 representation`)
    }
  }
  const noteRows = (await tx.query<Omit<NativeNote, 'collection_id' | 'tags' | 'attachments'> & { shard_deleted_at_present: boolean }>(
    `SELECT ${selectNativeFields(noteFields)}, shard_deleted_at_present,
      (SELECT content FROM note_original WHERE note_id = note.id) AS original_content,
      (SELECT content FROM note_revised_current WHERE note_id = note.id) AS revised_content FROM note
      ${options.noteIds ? 'WHERE id = ANY($1::text[])' : ''} ORDER BY id`, options.noteIds ? [options.noteIds] : [])).rows
  const memberships = (await tx.query<{ note_id: string; collection_id: string }>('SELECT note_id, collection_id FROM collection_note ORDER BY note_id, collection_id')).rows
  const tags = (await tx.query<{ note_id: string; tag: string }>('SELECT note_id, tag FROM note_tag ORDER BY note_id, position NULLS LAST, tag')).rows
  const attachments = (await tx.query<Pick<NativeAttachmentProjection, 'extracted_text' | 'extraction_status' | 'reason'> & { id: string; note_id: string; path: string; mime: string; checksum: string; bytes: number }>(
    `SELECT a.id, a.note_id, a.filename AS path, a.mime_type AS mime, ab.content_hash AS checksum, ab.size_bytes AS bytes,
      a.extracted_text,
      COALESCE(a.extraction_status, CASE WHEN a.status = 'quarantined' THEN 'blocked' WHEN a.status = 'failed' THEN 'failed'
        WHEN a.extracted_text IS NOT NULL AND a.extracted_text <> '' THEN 'extracted' ELSE 'pending' END) AS extraction_status,
      CASE WHEN a.extraction_status IS NOT NULL THEN a.extraction_reason
        WHEN a.status = 'quarantined' THEN 'quarantined' WHEN a.status = 'failed' THEN 'extractor_failed'
        WHEN a.extracted_text IS NOT NULL AND a.extracted_text <> '' THEN NULL ELSE 'extraction_pending' END AS reason
      FROM attachment a JOIN attachment_blob ab ON ab.id = a.blob_id ORDER BY a.note_id, a.position, a.created_at, a.id`)).rows
  const membershipsByNote = byNote(memberships), tagsByNote = byNote(tags), attachmentsByNote = byNote(attachments)
  const notes = noteRows.map(({ shard_deleted_at_present, ...row }) => {
    const assigned = membershipsByNote.get(row.id) ?? []
    if (assigned.length > 1) throw new Error('Multiple native collection memberships have no full-v1 representation')
    if (!shard_deleted_at_present && row.deleted_at === null) delete row.deleted_at
    return { ...row, collection_id: assigned[0]?.collection_id ?? null,
      tags: (tagsByNote.get(row.id) ?? []).map((tag) => tag.tag),
      attachments: (attachmentsByNote.get(row.id) ?? []).map((attachment) => ({
        extracted_text: attachment.extracted_text, extraction_status: attachment.extraction_status, reason: attachment.reason,
        attachment: { id: attachment.id, path: attachment.path, mime: attachment.mime, checksum: attachment.checksum, bytes: attachment.bytes },
      })),
    }
  })
  return { notes: options.deferValidation ? notes : checked('notes', notes),
    collections: await readNativeCollections(tx, undefined, options.deferValidation), tags: await readNativeTags(tx, options.deferValidation),
    templates: await readNativeTemplates(tx, undefined, options.deferValidation), links: await readNativeLinks(tx, undefined, options.deferValidation) }
}
