/**
 * TagsRepository — free-form tag management for notes.
 *
 * Responsibilities:
 * - Add and remove tags from notes
 * - Look up tags by note or notes by tag
 * - List all tags with usage counts
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'
export class TagsRepository {
  constructor(
    private db: PGlite,
  ) {}

  async addTag(noteId: string, tag: string): Promise<void> {
    await this.db.query(
      `INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3) ON CONFLICT (note_id, tag) DO NOTHING`,
      [generateId(), noteId, tag],
    )
  }

  async removeTag(noteId: string, tag: string): Promise<void> {
    await this.db.query(
      `DELETE FROM note_tag WHERE note_id = $1 AND tag = $2`,
      [noteId, tag],
    )
  }

  async getTagsForNote(noteId: string): Promise<string[]> {
    const result = await this.db.query<{ tag: string }>(
      `SELECT tag FROM note_tag WHERE note_id = $1 ORDER BY tag`,
      [noteId],
    )
    return result.rows.map((r) => r.tag)
  }

  async getNotesForTag(tag: string): Promise<string[]> {
    const result = await this.db.query<{ note_id: string }>(
      `SELECT note_id FROM note_tag WHERE tag = $1`,
      [tag],
    )
    return result.rows.map((r) => r.note_id)
  }

  async listAllTags(): Promise<Array<{ tag: string; count: number }>> {
    const result = await this.db.query<{ tag: string; count: string }>(
      `SELECT tag, COUNT(*) as count FROM note_tag GROUP BY tag ORDER BY count DESC, tag ASC`,
    )
    return result.rows.map((r) => ({ tag: r.tag, count: parseInt(r.count, 10) }))
  }
}
