/**
 * LinksRepository — bidirectional note link management.
 *
 * Responsibilities:
 * - Create typed links between notes with duplicate prevention
 * - Soft-delete links
 * - Query outbound, inbound, and backlinks for a note
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'

export interface LinkRow {
  id: string
  source_note_id: string
  target_note_id: string
  link_type: string
  created_at: Date
  deleted_at: Date | null
}

export class LinksRepository {
  constructor(private db: PGlite) {}

  async create(
    sourceNoteId: string,
    targetNoteId: string,
    linkType: string = 'related',
  ): Promise<LinkRow> {
    // Duplicate prevention — return existing active link if it already exists
    const existing = await this.db.query<LinkRow>(
      `SELECT * FROM link WHERE source_note_id = $1 AND target_note_id = $2 AND link_type = $3 AND deleted_at IS NULL`,
      [sourceNoteId, targetNoteId, linkType],
    )
    if (existing.rows.length > 0) return existing.rows[0]

    const id = generateId()
    await this.db.query(
      `INSERT INTO link (id, source_note_id, target_note_id, link_type) VALUES ($1, $2, $3, $4)`,
      [id, sourceNoteId, targetNoteId, linkType],
    )
    return this.get(id)
  }

  async get(id: string): Promise<LinkRow> {
    const result = await this.db.query<LinkRow>(
      `SELECT * FROM link WHERE id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new Error(`Link not found: ${id}`)
    return result.rows[0]
  }

  async listForNote(noteId: string): Promise<{ outbound: LinkRow[]; inbound: LinkRow[] }> {
    const outbound = await this.db.query<LinkRow>(
      `SELECT * FROM link WHERE source_note_id = $1 AND deleted_at IS NULL`,
      [noteId],
    )
    const inbound = await this.db.query<LinkRow>(
      `SELECT * FROM link WHERE target_note_id = $1 AND deleted_at IS NULL`,
      [noteId],
    )
    return { outbound: outbound.rows, inbound: inbound.rows }
  }

  async getBacklinks(noteId: string): Promise<string[]> {
    const result = await this.db.query<{ source_note_id: string }>(
      `SELECT source_note_id FROM link WHERE target_note_id = $1 AND deleted_at IS NULL`,
      [noteId],
    )
    return result.rows.map((r) => r.source_note_id)
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`UPDATE link SET deleted_at = now() WHERE id = $1`, [id])
  }
}
