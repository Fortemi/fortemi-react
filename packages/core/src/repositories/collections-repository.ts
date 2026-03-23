/**
 * CollectionsRepository — folder/category management for notes.
 *
 * Responsibilities:
 * - Create, read, update, and soft-delete collections
 * - Prevent circular parent references
 * - Assign and unassign notes from collections
 * - Return flat list and shallow tree views
 */

import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '../uuid.js'

export interface CollectionRow {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  position: number
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface CollectionCreateInput {
  name: string
  description?: string
  parent_id?: string
}

export class CollectionsRepository {
  constructor(private db: PGlite) {}

  async create(input: CollectionCreateInput): Promise<CollectionRow> {
    const id = generateId()
    await this.db.query(
      `INSERT INTO collection (id, name, description, parent_id)
       VALUES ($1, $2, $3, $4)`,
      [id, input.name, input.description ?? null, input.parent_id ?? null],
    )
    return this.get(id)
  }

  async get(id: string): Promise<CollectionRow> {
    const result = await this.db.query<CollectionRow>(
      `SELECT * FROM collection WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    )
    if (result.rows.length === 0) throw new Error(`Collection not found: ${id}`)
    return result.rows[0]
  }

  async list(): Promise<CollectionRow[]> {
    const result = await this.db.query<CollectionRow>(
      `SELECT * FROM collection WHERE deleted_at IS NULL ORDER BY position, name`,
    )
    return result.rows
  }

  async listTree(): Promise<Array<CollectionRow & { children: CollectionRow[] }>> {
    const all = await this.list()
    const roots = all.filter((c) => c.parent_id === null)
    return roots.map((root) => ({
      ...root,
      children: all.filter((c) => c.parent_id === root.id),
    }))
  }

  async update(
    id: string,
    fields: Partial<Pick<CollectionRow, 'name' | 'description' | 'parent_id' | 'position'>>,
  ): Promise<CollectionRow> {
    // Circular reference check
    if (fields.parent_id !== undefined) {
      if (fields.parent_id === id) throw new Error('Collection cannot be its own parent')
      // Check for deeper cycles by walking parent chain
      if (fields.parent_id) {
        let current = fields.parent_id
        const visited = new Set<string>([id])
        while (current) {
          if (visited.has(current)) throw new Error('Circular reference detected')
          visited.add(current)
          const parent = await this.db.query<{ parent_id: string | null }>(
            `SELECT parent_id FROM collection WHERE id = $1`,
            [current],
          )
          current = parent.rows[0]?.parent_id ?? ''
          if (!current) break
        }
      }
    }

    const setClauses: string[] = ['updated_at = now()']
    const params: unknown[] = []
    let idx = 1
    if (fields.name !== undefined) {
      setClauses.push(`name = $${idx++}`)
      params.push(fields.name)
    }
    if (fields.description !== undefined) {
      setClauses.push(`description = $${idx++}`)
      params.push(fields.description)
    }
    if (fields.parent_id !== undefined) {
      setClauses.push(`parent_id = $${idx++}`)
      params.push(fields.parent_id)
    }
    if (fields.position !== undefined) {
      setClauses.push(`position = $${idx++}`)
      params.push(fields.position)
    }

    params.push(id)
    await this.db.query(
      `UPDATE collection SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    )
    return this.get(id)
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`UPDATE collection SET deleted_at = now() WHERE id = $1`, [id])
    // Unassign notes from the deleted collection
    await this.db.query(`DELETE FROM collection_note WHERE collection_id = $1`, [id])
  }

  async assignNote(collectionId: string, noteId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO collection_note (collection_id, note_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [collectionId, noteId],
    )
  }

  async unassignNote(collectionId: string, noteId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM collection_note WHERE collection_id = $1 AND note_id = $2`,
      [collectionId, noteId],
    )
  }

  async getNotesInCollection(collectionId: string): Promise<string[]> {
    const result = await this.db.query<{ note_id: string }>(
      `SELECT note_id FROM collection_note WHERE collection_id = $1 ORDER BY position`,
      [collectionId],
    )
    return result.rows.map((r) => r.note_id)
  }
}
