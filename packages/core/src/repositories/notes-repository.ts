/**
 * NotesRepository — CRUD and lifecycle operations for the note entity.
 *
 * Responsibilities:
 * - Create notes with immutable original content and mutable current revision
 * - Manage note lifecycle: soft-delete, restore, star, pin, archive
 * - List notes with filtering, pagination, and sorting
 * - Emit domain events via TypedEventBus on every mutation
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'
import { computeHash } from '../hash.js'
import type { TypedEventBus } from '../event-bus.js'
import type {
  NoteFull,
  NoteSummary,
  NoteCreateInput,
  NoteUpdateInput,
  NoteListOptions,
  PaginatedResult,
} from './types.js'

export class NotesRepository {
  constructor(
    private db: PGlite,
    private events?: TypedEventBus,
  ) {}

  /**
   * Create a new note with its original content record, current revision,
   * optional tags, and an auto-queued title_generation job when no title
   * is provided.
   *
   * All writes happen in a single transaction.
   */
  async create(input: NoteCreateInput): Promise<NoteFull> {
    const noteId = generateId()
    const originalId = generateId()
    const contentHash = computeHash(new TextEncoder().encode(input.content))

    await this.db.transaction(async (tx) => {
      // Insert note
      await tx.query(
        `INSERT INTO note (id, archive_id, title, format, source, visibility)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          noteId,
          input.archive_id ?? null,
          input.title ?? null,
          input.format ?? 'markdown',
          input.source ?? 'user',
          input.visibility ?? 'private',
        ],
      )

      // Insert note_original (immutable — never updated)
      await tx.query(
        `INSERT INTO note_original (id, note_id, content, content_hash)
         VALUES ($1, $2, $3, $4)`,
        [originalId, noteId, input.content, contentHash],
      )

      // Insert note_revised_current (mutable — tracks latest revision)
      await tx.query(
        `INSERT INTO note_revised_current (note_id, content)
         VALUES ($1, $2)`,
        [noteId, input.content],
      )

      // Insert free-form tags
      if (input.tags?.length) {
        for (const tag of input.tags) {
          await tx.query(
            `INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)`,
            [generateId(), noteId, tag],
          )
        }
      }

      // Queue title generation job when caller did not supply a title
      if (!input.title) {
        await tx.query(
          `INSERT INTO job_queue (id, note_id, job_type, status, priority)
           VALUES ($1, $2, 'title_generation', 'pending', 5)`,
          [generateId(), noteId],
        )
      }
    })

    this.events?.emit('note.created', { id: noteId })
    return this.get(noteId)
  }

  /**
   * Fetch a single note by its ID.
   * Returns NoteFull which includes original content, current revision, and tags.
   * Throws when the note does not exist.
   */
  async get(id: string): Promise<NoteFull> {
    const noteResult = await this.db.query<{
      id: string
      archive_id: string | null
      title: string | null
      format: string
      source: string
      visibility: string
      revision_mode: string
      is_starred: boolean
      is_pinned: boolean
      is_archived: boolean
      created_at: Date
      updated_at: Date
      deleted_at: Date | null
      original_id: string
      original_content: string
      content_hash: string
      original_created_at: Date
      current_content: string
      ai_metadata: unknown | null
      generation_count: number
      model: string | null
      is_user_edited: boolean
      current_updated_at: Date
    }>(
      `SELECT n.id, n.archive_id, n.title, n.format, n.source, n.visibility,
              n.revision_mode, n.is_starred, n.is_pinned, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at,
              o.id         AS original_id,
              o.content    AS original_content,
              o.content_hash,
              o.created_at AS original_created_at,
              c.content    AS current_content,
              c.ai_metadata,
              c.generation_count,
              c.model,
              c.is_user_edited,
              c.updated_at AS current_updated_at
       FROM note n
       LEFT JOIN note_original       o ON o.note_id = n.id
       LEFT JOIN note_revised_current c ON c.note_id = n.id
       WHERE n.id = $1`,
      [id],
    )

    if (noteResult.rows.length === 0) {
      throw new Error(`Note not found: ${id}`)
    }

    const row = noteResult.rows[0]

    const tagsResult = await this.db.query<{ tag: string }>(
      `SELECT tag FROM note_tag WHERE note_id = $1 ORDER BY tag`,
      [id],
    )

    return {
      id: row.id,
      archive_id: row.archive_id,
      title: row.title,
      format: row.format,
      source: row.source,
      visibility: row.visibility,
      revision_mode: row.revision_mode,
      is_starred: row.is_starred,
      is_pinned: row.is_pinned,
      is_archived: row.is_archived,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      tags: tagsResult.rows.map((r) => r.tag),
      original: {
        id: row.original_id,
        content: row.original_content,
        content_hash: row.content_hash,
        created_at: row.original_created_at,
      },
      current: {
        content: row.current_content,
        ai_metadata: row.ai_metadata,
        generation_count: row.generation_count,
        model: row.model,
        is_user_edited: row.is_user_edited,
        updated_at: row.current_updated_at,
      },
    }
  }

  /**
   * List notes with optional filtering, sorting, and pagination.
   * Excludes soft-deleted notes by default (pass include_deleted: true to override).
   */
  async list(options: NoteListOptions = {}): Promise<PaginatedResult<NoteSummary>> {
    const {
      limit = 50,
      offset = 0,
      sort = 'created_at',
      order = 'desc',
      is_starred,
      is_pinned,
      is_archived,
      include_deleted = false,
      collection_id,
      tags,
    } = options

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (!include_deleted) {
      conditions.push('n.deleted_at IS NULL')
    }
    if (is_starred !== undefined) {
      conditions.push(`n.is_starred = $${paramIndex++}`)
      params.push(is_starred)
    }
    if (is_pinned !== undefined) {
      conditions.push(`n.is_pinned = $${paramIndex++}`)
      params.push(is_pinned)
    }
    if (is_archived !== undefined) {
      conditions.push(`n.is_archived = $${paramIndex++}`)
      params.push(is_archived)
    }
    if (collection_id) {
      conditions.push(
        `EXISTS (SELECT 1 FROM collection_note cn WHERE cn.note_id = n.id AND cn.collection_id = $${paramIndex++})`,
      )
      params.push(collection_id)
    }
    if (tags?.length) {
      conditions.push(
        `EXISTS (SELECT 1 FROM note_tag nt WHERE nt.note_id = n.id AND nt.tag = ANY($${paramIndex++}))`,
      )
      params.push(tags)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Validate sort column against allowlist to prevent SQL injection
    const validSorts = ['created_at', 'updated_at', 'title'] as const
    const sortCol = (validSorts as readonly string[]).includes(sort) ? sort : 'created_at'
    const sortDir = order === 'asc' ? 'ASC' : 'DESC'

    // Count total matching rows
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM note n ${where}`,
      params,
    )
    const total = parseInt(countResult.rows[0].count, 10)

    // Fetch paginated rows
    const listParams = [...params, limit, offset]
    const rowsResult = await this.db.query<{
      id: string
      title: string | null
      format: string
      source: string
      visibility: string
      is_starred: boolean
      is_pinned: boolean
      is_archived: boolean
      created_at: Date
      updated_at: Date
      deleted_at: Date | null
    }>(
      `SELECT n.id, n.title, n.format, n.source, n.visibility,
              n.is_starred, n.is_pinned, n.is_archived,
              n.created_at, n.updated_at, n.deleted_at
       FROM note n ${where}
       ORDER BY n.${sortCol} ${sortDir}
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      listParams,
    )

    // Batch-load tags for all returned notes
    const noteIds = rowsResult.rows.map((r) => r.id)
    const tagMap = new Map<string, string[]>()

    if (noteIds.length > 0) {
      const tagsResult = await this.db.query<{ note_id: string; tag: string }>(
        `SELECT note_id, tag FROM note_tag WHERE note_id = ANY($1) ORDER BY tag`,
        [noteIds],
      )
      for (const row of tagsResult.rows) {
        const existing = tagMap.get(row.note_id) ?? []
        existing.push(row.tag)
        tagMap.set(row.note_id, existing)
      }
    }

    const items: NoteSummary[] = rowsResult.rows.map((r) => ({
      id: r.id,
      title: r.title,
      format: r.format,
      source: r.source,
      visibility: r.visibility,
      is_starred: r.is_starred,
      is_pinned: r.is_pinned,
      is_archived: r.is_archived,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at,
      tags: tagMap.get(r.id) ?? [],
    }))

    return { items, total, limit, offset }
  }

  /**
   * Update mutable note fields.
   * When content changes, the previous current content is saved as a numbered
   * revision before the new content is applied.
   */
  async update(id: string, input: NoteUpdateInput): Promise<NoteFull> {
    // Determine the next revision number before entering the transaction
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM note_revision WHERE note_id = $1`,
      [id],
    )
    const nextRevision = parseInt(countResult.rows[0].count, 10) + 1

    await this.db.transaction(async (tx) => {
      // Build dynamic SET clause for note table fields
      const setClauses: string[] = ['updated_at = now()']
      const noteParams: unknown[] = []
      let paramIdx = 1

      if (input.title !== undefined) {
        setClauses.push(`title = $${paramIdx++}`)
        noteParams.push(input.title)
      }
      if (input.format !== undefined) {
        setClauses.push(`format = $${paramIdx++}`)
        noteParams.push(input.format)
      }
      if (input.visibility !== undefined) {
        setClauses.push(`visibility = $${paramIdx++}`)
        noteParams.push(input.visibility)
      }

      noteParams.push(id)
      await tx.query(
        `UPDATE note SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        noteParams,
      )

      // When content changes, archive the current content as a revision
      if (input.content !== undefined) {
        const currentResult = await tx.query<{ content: string }>(
          `SELECT content FROM note_revised_current WHERE note_id = $1`,
          [id],
        )
        if (currentResult.rows.length > 0) {
          await tx.query(
            `INSERT INTO note_revision (id, note_id, revision_number, type, content)
             VALUES ($1, $2, $3, 'user', $4)`,
            [generateId(), id, nextRevision, currentResult.rows[0].content],
          )
        }

        await tx.query(
          `UPDATE note_revised_current
           SET content = $1, is_user_edited = true, updated_at = now()
           WHERE note_id = $2`,
          [input.content, id],
        )
      }
    })

    this.events?.emit('note.updated', { id })
    return this.get(id)
  }

  /**
   * Soft-delete a note by setting deleted_at to the current timestamp.
   */
  async delete(id: string): Promise<void> {
    await this.db.query(
      `UPDATE note SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    )
    this.events?.emit('note.deleted', { id })
  }

  /**
   * Restore a soft-deleted note by clearing deleted_at.
   */
  async restore(id: string): Promise<NoteFull> {
    await this.db.query(
      `UPDATE note SET deleted_at = NULL, updated_at = now() WHERE id = $1`,
      [id],
    )
    this.events?.emit('note.restored', { id })
    return this.get(id)
  }

  /**
   * Toggle the is_starred field on a note.
   */
  async star(id: string, starred: boolean): Promise<void> {
    await this.db.query(
      `UPDATE note SET is_starred = $1, updated_at = now() WHERE id = $2`,
      [starred, id],
    )
    this.events?.emit('note.updated', { id })
  }

  /**
   * Toggle the is_pinned field on a note.
   */
  async pin(id: string, pinned: boolean): Promise<void> {
    await this.db.query(
      `UPDATE note SET is_pinned = $1, updated_at = now() WHERE id = $2`,
      [pinned, id],
    )
    this.events?.emit('note.updated', { id })
  }

  /**
   * Toggle the is_archived field on a note.
   */
  async archive(id: string, archived: boolean): Promise<void> {
    await this.db.query(
      `UPDATE note SET is_archived = $1, updated_at = now() WHERE id = $2`,
      [archived, id],
    )
    this.events?.emit('note.updated', { id })
  }
}
