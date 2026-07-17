/**
 * Writable non-PGlite `DataBackend` over the canonical RecordStore
 * (#323 cycle 2, ADR-013 D3) — the record tier in the backend seam.
 *
 * Fills the seam's historical gap: the static shard backend is read-only and
 * the PGlite backend needs a database. This adapter serves the canonical
 * repositories' full write surface plus the bounded read tier (id / recent /
 * tag / link lookups and a bounded substring scan) with instant startup.
 *
 * Capability boundary, reported honestly: `semantic: 'none'` (no vectors) and
 * search is a bounded scan, not ranked FTS. SKOS concepts and provenance
 * edges are not part of the canonical record collections, so `conceptsOf` /
 * `provenanceOf` are deliberately absent — callers feature-detect via the
 * optional methods rather than receiving silently empty emulations.
 * `merge: true` is served by `importShardToRecords` (record-shard.ts).
 */

import type {
  DataBackend,
  BackendNote,
  BackendLink,
  BackendSearchHit,
} from '../data-backend.js'
import type { RecordStore, NoteRecord0, LinkRecord0 } from './types.js'
import { CanonicalNotesRepository } from './canonical-notes-repository.js'
import type { CanonicalNoteView } from './canonical-notes-repository.js'
import { ManageNoteInputSchema } from '../tools/schemas.js'

export interface RecordBackendOptions {
  id?: string
}

export interface RecordBackendManageNoteResult {
  action: string
  note_id: string
  note?: CanonicalNoteView
}

function noteToBackend(n: NoteRecord0, tags: string[]): BackendNote {
  return {
    id: n.id,
    title: n.title,
    tags,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    source: n.source,
    starred: n.is_starred,
    archived: n.is_archived,
  }
}

function linkToBackend(link: LinkRecord0): BackendLink {
  return {
    id: link.id,
    fromNoteId: link.source_note_id,
    toNoteId: link.target_note_id,
    kind: link.link_type,
    score: null,
    createdAt: link.created_at,
  }
}

/**
 * Wrap a canonical `RecordStore` as a writable `DataBackend`. Reads and
 * writes delegate to `CanonicalNotesRepository`; `manageNote` accepts the
 * same Zod-validated input as the PGlite tool (update / delete / restore /
 * archive / unarchive / star / unstar).
 */
export function createRecordBackend(
  store: RecordStore,
  options: RecordBackendOptions = {},
): DataBackend {
  const notes = new CanonicalNotesRepository(store)

  async function tagsByNote(): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    for (const row of await store.list('note_tag')) {
      const tags = map.get(row.note_id) ?? []
      tags.push(row.tag)
      map.set(row.note_id, tags)
    }
    for (const tags of map.values()) tags.sort()
    return map
  }

  return {
    id: options.id ?? 'canonical-records',
    capabilities: {
      read: true,
      write: true,
      merge: true, // via importShardToRecords (record-shard.ts)
      multiUser: false,
      semantic: 'none',
      startupCost: 'instant',
    },

    async listNotes(o) {
      const all = (await store.list('note')).filter((n) => n.deleted_at === null)
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      const offset = o?.offset ?? 0
      const limit = o?.limit ?? 50
      const tags = await tagsByNote()
      return {
        items: all.slice(offset, offset + limit).map((n) => noteToBackend(n, tags.get(n.id) ?? [])),
        total: all.length,
      }
    },

    async getNote(id) {
      const view = await notes.get(id)
      if (!view || view.note.deleted_at !== null) return null
      return noteToBackend(view.note, view.tags)
    },

    async search(query, o) {
      // Bounded substring scan (RECORD_STORE_CAPABILITIES.boundedTextScan) —
      // deliberately unranked, so hits carry no rank/snippet.
      const offset = o?.offset ?? 0
      const limit = o?.limit ?? 20
      let matched = await notes.searchText(query, offset + limit)
      if (o?.tags?.length) {
        const tags = await tagsByNote()
        matched = matched.filter((n) => o.tags!.every((t) => (tags.get(n.id) ?? []).includes(t)))
      }
      if (o?.source?.length) {
        matched = matched.filter((n) => o.source!.includes(n.source))
      }
      const tags = await tagsByNote()
      const hits: BackendSearchHit[] = matched
        .slice(offset, offset + limit)
        .map((n) => ({ note: noteToBackend(n, tags.get(n.id) ?? []) }))
      return { hits, total: matched.length }
    },

    async getNoteFull(id) {
      const view = await notes.get(id)
      if (!view || view.note.deleted_at !== null) return null
      return {
        ...noteToBackend(view.note, view.tags),
        content: view.revised_content,
        links: (await notes.linksOf(id)).map(linkToBackend),
      }
    },

    async linksOf(id) {
      return (await notes.linksOf(id)).map(linkToBackend)
    },

    async manageNote(input): Promise<RecordBackendManageNoteResult> {
      const parsed = ManageNoteInputSchema.parse(input)
      switch (parsed.action) {
        case 'update': {
          const note = await notes.update(parsed.note_id, {
            title: parsed.title,
            content: parsed.content,
            format: parsed.format,
            visibility: parsed.visibility,
          })
          return { action: 'update', note_id: parsed.note_id, note }
        }
        case 'delete':
          await notes.softDelete(parsed.note_id)
          return { action: 'delete', note_id: parsed.note_id }
        case 'restore': {
          await notes.restore(parsed.note_id)
          return { action: 'restore', note_id: parsed.note_id, note: (await notes.get(parsed.note_id))! }
        }
        case 'archive': {
          const note = await notes.update(parsed.note_id, { is_archived: true })
          return { action: 'archive', note_id: parsed.note_id, note }
        }
        case 'unarchive': {
          const note = await notes.update(parsed.note_id, { is_archived: false })
          return { action: 'unarchive', note_id: parsed.note_id, note }
        }
        case 'star': {
          const note = await notes.update(parsed.note_id, { is_starred: true })
          return { action: 'star', note_id: parsed.note_id, note }
        }
        case 'unstar': {
          const note = await notes.update(parsed.note_id, { is_starred: false })
          return { action: 'unstar', note_id: parsed.note_id, note }
        }
      }
    },
  }
}
