/**
 * Shard export pipeline — query all entities, serialize, pack into .shard archive.
 *
 * Pipeline: query DB → field-map → serialize (JSONL/JSON) → compute checksums → build manifest → tar.gz
 */

import type { PGlite } from '@electric-sql/pglite'
import { VERSION } from '../index.js'
import { packTarGz } from './shard-tar.js'
import { sha256Hex } from './checksum.js'
import {
  noteToShard,
  linkToShard,
  collectionToShard,
  tagsToShard,
  embeddingSetToShard,
  embeddingSetMemberToShard,
  embeddingToShard,
} from './field-mapper.js'
import type { BrowserNoteExport } from './field-mapper.js'
import type { LinkRow } from '../repositories/links-repository.js'
import type { CollectionRow } from '../repositories/collections-repository.js'
import {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
} from './types.js'
import type {
  ExportOptions,
  ShardManifest,
  ShardComponent,
} from './types.js'

const encoder = new TextEncoder()

/**
 * Export knowledge data from the database as a .shard archive (Uint8Array).
 *
 * @param db PGlite database instance
 * @param options Export options (includeEmbeddings, collectionId filter)
 * @returns Compressed shard archive bytes
 */
export async function exportShard(
  db: PGlite,
  options?: ExportOptions,
): Promise<Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const components: ShardComponent[] = []
  const counts: Partial<Record<ShardComponent, number>> = {}

  // ── Query notes ─────────────────────────────────────────────────────
  let noteQuery: string
  let noteParams: unknown[]

  if (options?.collectionId) {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN collection_note cn ON cn.note_id = n.id
       WHERE n.deleted_at IS NULL AND cn.collection_id = $1
       ORDER BY n.created_at`
    noteParams = [options.collectionId]
  } else if (options?.tag) {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       JOIN note_tag nt ON nt.note_id = n.id AND nt.tag = $1
       WHERE n.deleted_at IS NULL
       ORDER BY n.created_at`
    noteParams = [options.tag]
  } else {
    noteQuery = `SELECT n.id, n.title, n.format, n.source, n.is_starred, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.content as original_content,
              c.content as revised_content
       FROM note n
       LEFT JOIN note_original o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.deleted_at IS NULL
       ORDER BY n.created_at`
    noteParams = []
  }

  const noteRows = await db.query<{
    id: string
    title: string | null
    format: string
    source: string
    is_starred: boolean
    is_archived: boolean
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
    original_content: string
    revised_content: string | null
  }>(noteQuery, noteParams)

  // Fetch tags per note
  const tagRows = await db.query<{ note_id: string; tag: string }>(
    `SELECT note_id, tag FROM note_tag ORDER BY note_id, tag`,
  )
  const tagsByNote = new Map<string, string[]>()
  for (const row of tagRows.rows) {
    const tags = tagsByNote.get(row.note_id) ?? []
    tags.push(row.tag)
    tagsByNote.set(row.note_id, tags)
  }

  const notes: BrowserNoteExport[] = noteRows.rows.map((row) => ({
    ...row,
    tags: tagsByNote.get(row.id) ?? [],
  }))

  // Collect exported note IDs for scoping related data
  const exportedNoteIds = new Set(notes.map((n) => n.id))

  const notesJsonl = notes.map((n) => JSON.stringify(noteToShard(n))).join('\n')
  files.set('notes.jsonl', encoder.encode(notesJsonl))
  components.push('notes')
  counts.notes = notes.length

  // ── Query collections ───────────────────────────────────────────────
  const collectionRows = await db.query<CollectionRow>(
    `SELECT * FROM collection WHERE deleted_at IS NULL ORDER BY position, name`,
  )
  // Get note counts per collection
  const collNoteCountRows = await db.query<{ collection_id: string; cnt: string }>(
    `SELECT collection_id, COUNT(*) as cnt FROM collection_note GROUP BY collection_id`,
  )
  const noteCountMap = new Map<string, number>()
  for (const row of collNoteCountRows.rows) {
    noteCountMap.set(row.collection_id, parseInt(row.cnt, 10))
  }

  const shardCollections = collectionRows.rows.map((c) =>
    collectionToShard(c, noteCountMap.get(c.id) ?? 0),
  )
  files.set('collections.json', encoder.encode(JSON.stringify(shardCollections)))
  components.push('collections')
  counts.collections = shardCollections.length

  // ── Query tags (unique list, scoped to exported notes) ──────────────
  const allTagRows = await db.query<{ tag: string }>(
    `SELECT DISTINCT tag FROM note_tag ORDER BY tag`,
  )
  // When filtering, only include tags that appear on exported notes
  const isFiltered = !!(options?.tag || options?.collectionId)
  const relevantTags = isFiltered
    ? allTagRows.rows.filter((r) => {
        for (const note of notes) {
          if (note.tags.includes(r.tag)) return true
        }
        return false
      })
    : allTagRows.rows
  const shardTags = tagsToShard(
    relevantTags.map((r) => ({ name: r.tag, created_at: new Date() })),
  )
  files.set('tags.json', encoder.encode(JSON.stringify(shardTags)))
  components.push('tags')
  counts.tags = shardTags.length

  // ── Query links (scoped to exported notes) ──────────────────────────
  const linkRows = await db.query<LinkRow>(
    `SELECT * FROM link WHERE deleted_at IS NULL ORDER BY created_at`,
  )
  // When filtering, only include links where both endpoints are in the export
  const filteredLinks = (options?.tag || options?.collectionId)
    ? linkRows.rows.filter((l) => exportedNoteIds.has(l.source_note_id) && exportedNoteIds.has(l.target_note_id))
    : linkRows.rows
  const linksJsonl = filteredLinks.map((l) => JSON.stringify(linkToShard(l))).join('\n')
  files.set('links.jsonl', encoder.encode(linksJsonl))
  components.push('links')
  counts.links = filteredLinks.length

  // ── Query embeddings (optional) ─────────────────────────────────────
  if (options?.includeEmbeddings) {
    const embSetRows = await db.query<{
      id: string
      model_name: string
      dimensions: number
      created_at: Date
    }>(`SELECT * FROM embedding_set ORDER BY created_at`)

    const shardEmbSets = embSetRows.rows.map(embeddingSetToShard)
    files.set('embedding_sets.json', encoder.encode(JSON.stringify(shardEmbSets)))
    components.push('embedding_sets')
    counts.embedding_sets = shardEmbSets.length

    const embMemberRows = await db.query<{
      embedding_set_id: string
      note_id: string
      embedding_id: string
    }>(`SELECT * FROM embedding_set_member`)

    const membersJsonl = embMemberRows.rows
      .map((m) => JSON.stringify(embeddingSetMemberToShard(m)))
      .join('\n')
    files.set('embedding_set_members.jsonl', encoder.encode(membersJsonl))
    components.push('embedding_set_members')
    counts.embedding_set_members = embMemberRows.rows.length

    const embRows = await db.query<{
      id: string
      note_id: string
      embedding_set_id: string
      vector: string
      created_at: Date
    }>(`SELECT * FROM embedding ORDER BY created_at`)

    const embJsonl = embRows.rows.map((e) => JSON.stringify(embeddingToShard(e))).join('\n')
    files.set('embeddings.jsonl', encoder.encode(embJsonl))
    components.push('embeddings')
    counts.embeddings = embRows.rows.length
  }

  // ── Compute checksums ───────────────────────────────────────────────
  const checksums: Record<string, string> = {}
  for (const [filename, data] of files) {
    checksums[filename] = await sha256Hex(data)
  }

  // ── Build manifest ──────────────────────────────────────────────────
  const manifest: ShardManifest = {
    version: CURRENT_SHARD_VERSION,
    matric_version: VERSION,
    format: SHARD_FORMAT,
    created_at: new Date().toISOString(),
    components,
    counts,
    checksums,
    min_reader_version: '1.0.0',
  }
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest, null, 2)))

  // ── Pack tar.gz ─────────────────────────────────────────────────────
  return packTarGz(files)
}
