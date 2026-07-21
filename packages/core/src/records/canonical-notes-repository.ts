/**
 * Canonical notes repository — DB-free note/tag/link/collection workflows
 * over the RecordStore (#323). Mirrors the SQL repositories' semantics
 * (UUIDv7 ids, immutable note_original, mutable note_revised_current,
 * soft-delete everywhere) so the PGlite projection replay is row-for-row.
 *
 * Query tier: id/recent/tag/link/collection lookups plus a bounded substring
 * text scan. Ranked FTS, vectors, and complex joins are explicitly NOT
 * served here — `store.capabilities` reports the boundary (ADR-013 D3).
 */

import type { RecordStore } from './types.js'
import type {
  CollectionRecord,
  LinkRecord0 as LinkRecord,
  NoteRecord0 as NoteRecord,
} from './types.js'
import { generateId } from '../uuid.js'
import { computeHash } from '../hash.js'

export interface CanonicalNoteCreateInput {
  id?: string
  title?: string
  content: string
  format?: string
  source?: string
  visibility?: string
}

export interface CanonicalNoteUpdateInput {
  title?: string
  content?: string
  format?: string
  visibility?: string
  is_starred?: boolean
  is_pinned?: boolean
  is_archived?: boolean
}

export interface CanonicalNoteView {
  note: NoteRecord
  original_content: string
  revised_content: string
  tags: string[]
}

function nowIso(): string {
  return new Date().toISOString()
}

export class CanonicalNotesRepository {
  constructor(private store: RecordStore) {}

  // ── Notes ─────────────────────────────────────────────────────────────────

  async create(input: CanonicalNoteCreateInput): Promise<CanonicalNoteView> {
    const noteId = input.id ?? generateId()
    const ts = nowIso()

    await this.store.put('note', {
      id: noteId,
      archive_id: null,
      title: input.title ?? null,
      format: input.format ?? 'markdown',
      source: input.source ?? 'user',
      visibility: input.visibility ?? 'private',
      revision_mode: 'standard',
      is_starred: false,
      is_pinned: false,
      is_archived: false,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    })
    await this.store.put('note_original', {
      id: generateId(),
      note_id: noteId,
      content: input.content,
      content_hash: computeHash(new TextEncoder().encode(input.content)),
      created_at: ts,
    })
    await this.store.put('note_revised_current', {
      id: noteId,
      content: input.content,
      ai_metadata: null,
      generation_count: 0,
      model: null,
      is_user_edited: false,
      updated_at: ts,
    })

    return (await this.get(noteId))!
  }

  async get(noteId: string): Promise<CanonicalNoteView | null> {
    const note = await this.store.get('note', noteId)
    if (!note) return null
    const revised = await this.store.get('note_revised_current', noteId)
    const originals = (await this.store.list('note_original')).filter(
      (o) => o.note_id === noteId,
    )
    const tags = (await this.store.list('note_tag'))
      .filter((t) => t.note_id === noteId)
      .map((t) => t.tag)
      .sort()
    return {
      note,
      original_content: originals[0]?.content ?? '',
      revised_content: revised?.content ?? originals[0]?.content ?? '',
      tags,
    }
  }

  async update(noteId: string, input: CanonicalNoteUpdateInput): Promise<CanonicalNoteView> {
    const note = await this.store.get('note', noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    const ts = nowIso()

    await this.store.put('note', {
      ...note,
      title: input.title !== undefined ? input.title : note.title,
      format: input.format ?? note.format,
      visibility: input.visibility ?? note.visibility,
      is_starred: input.is_starred ?? note.is_starred,
      is_pinned: input.is_pinned ?? note.is_pinned,
      is_archived: input.is_archived ?? note.is_archived,
      updated_at: ts,
    })

    if (input.content !== undefined) {
      const revised = await this.store.get('note_revised_current', noteId)
      await this.store.put('note_revised_current', {
        id: noteId,
        content: input.content,
        ai_metadata: revised?.ai_metadata ?? null,
        generation_count: revised?.generation_count ?? 0,
        model: revised?.model ?? null,
        is_user_edited: true,
        updated_at: ts,
      })
    }

    return (await this.get(noteId))!
  }

  /** Soft-delete: sets `deleted_at`; the record (and history) remains. */
  async softDelete(noteId: string): Promise<void> {
    const note = await this.store.get('note', noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    await this.store.put('note', { ...note, deleted_at: nowIso(), updated_at: nowIso() })
  }

  async restore(noteId: string): Promise<void> {
    const note = await this.store.get('note', noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    await this.store.put('note', { ...note, deleted_at: null, updated_at: nowIso() })
  }

  /** Non-deleted notes, most recently updated first. */
  async listRecent(limit = 50): Promise<NoteRecord[]> {
    const notes = (await this.store.list('note')).filter((n) => n.deleted_at === null)
    notes.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return notes.slice(0, limit)
  }

  /**
   * Bounded substring scan over title + revised content (case-insensitive).
   * This is deliberately not ranked FTS — see `store.capabilities`.
   */
  async searchText(query: string, limit = 20): Promise<NoteRecord[]> {
    const needle = query.toLowerCase()
    const revised = new Map(
      (await this.store.list('note_revised_current')).map((r) => [r.id, r.content]),
    )
    const hits: NoteRecord[] = []
    for (const note of await this.store.list('note')) {
      if (note.deleted_at !== null) continue
      const haystack = `${note.title ?? ''}\n${revised.get(note.id) ?? ''}`.toLowerCase()
      if (haystack.includes(needle)) {
        hits.push(note)
        if (hits.length >= limit) break
      }
    }
    return hits
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async addTag(noteId: string, tag: string): Promise<void> {
    const existing = (await this.store.list('note_tag')).find(
      (t) => t.note_id === noteId && t.tag === tag,
    )
    if (existing) return // UNIQUE(note_id, tag) semantics
    await this.store.put('note_tag', {
      id: generateId(),
      note_id: noteId,
      tag,
      created_at: nowIso(),
    })
  }

  async removeTag(noteId: string, tag: string): Promise<void> {
    const existing = (await this.store.list('note_tag')).find(
      (t) => t.note_id === noteId && t.tag === tag,
    )
    if (existing) await this.store.remove('note_tag', existing.id)
  }

  async notesByTag(tag: string): Promise<NoteRecord[]> {
    const noteIds = new Set(
      (await this.store.list('note_tag')).filter((t) => t.tag === tag).map((t) => t.note_id),
    )
    return (await this.store.list('note')).filter(
      (n) => noteIds.has(n.id) && n.deleted_at === null,
    )
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  async createLink(
    sourceNoteId: string,
    targetNoteId: string,
    linkType = 'related',
  ): Promise<LinkRecord> {
    const link: LinkRecord = {
      id: generateId(),
      source_note_id: sourceNoteId,
      target_note_id: targetNoteId,
      link_type: linkType,
      created_at: nowIso(),
      deleted_at: null,
    }
    await this.store.put('link', link)
    return link
  }

  async softDeleteLink(linkId: string): Promise<void> {
    const link = await this.store.get('link', linkId)
    if (!link) throw new Error(`Link not found: ${linkId}`)
    await this.store.put('link', { ...link, deleted_at: nowIso() })
  }

  /** Active links touching a note (either direction). */
  async linksOf(noteId: string): Promise<LinkRecord[]> {
    return (await this.store.list('link')).filter(
      (l) =>
        l.deleted_at === null &&
        (l.source_note_id === noteId || l.target_note_id === noteId),
    )
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async createCollection(
    name: string,
    description?: string,
    parentId: string | null = null,
  ): Promise<CollectionRecord> {
    if (parentId !== null && !(await this.store.get('collection', parentId))) {
      throw new Error(`Parent collection not found: ${parentId}`)
    }
    const ts = nowIso()
    const collection: CollectionRecord = {
      id: generateId(),
      name,
      description: description ?? null,
      parent_id: parentId,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    }
    await this.store.put('collection', collection)
    return collection
  }

  async addNoteToCollection(collectionId: string, noteId: string): Promise<void> {
    const existing = (await this.store.list('collection_note')).find(
      (cn) => cn.collection_id === collectionId && cn.note_id === noteId,
    )
    if (existing) return
    await this.store.put('collection_note', {
      id: generateId(),
      collection_id: collectionId,
      note_id: noteId,
      created_at: nowIso(),
    })
  }

  async notesInCollection(collectionId: string): Promise<NoteRecord[]> {
    const noteIds = new Set(
      (await this.store.list('collection_note'))
        .filter((cn) => cn.collection_id === collectionId)
        .map((cn) => cn.note_id),
    )
    return (await this.store.list('note')).filter(
      (n) => noteIds.has(n.id) && n.deleted_at === null,
    )
  }
}
