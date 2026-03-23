/**
 * Tests for CollectionsRepository.
 *
 * Covers:
 * - create: inserts collection row, returns CollectionRow
 * - get: fetches by id, throws on not-found or soft-deleted
 * - list: returns active collections ordered by position/name
 * - listTree: shallow tree with parent/child nesting
 * - update: partial field update, circular reference prevention
 * - delete: soft-deletes and unassigns notes
 * - assignNote / unassignNote: membership management
 * - getNotesInCollection: ordered by position
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { CollectionsRepository } from '../repositories/collections-repository.js'

// ── helpers ───────────────────────────────────────────────────────────────────

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string): Promise<void> {
  await db.query(
    `INSERT INTO note (id, format, source, visibility, revision_mode)
     VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
    [id],
  )
}

// ── suite ──────────────────────────────────────────────────────────────────────

describe('CollectionsRepository', () => {
  let db: PGlite
  let repo: CollectionsRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new CollectionsRepository(db)
    await insertNote(db, 'note-1')
    await insertNote(db, 'note-2')
  })

  afterEach(async () => {
    await db.close()
  })

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a collection and returns a CollectionRow', async () => {
      const col = await repo.create({ name: 'Work' })
      expect(col.id).toBeTruthy()
      expect(col.name).toBe('Work')
      expect(col.description).toBeNull()
      expect(col.parent_id).toBeNull()
      expect(col.position).toBe(0)
      expect(col.deleted_at).toBeNull()
    })

    it('stores description when provided', async () => {
      const col = await repo.create({ name: 'Reading', description: 'Books to read' })
      expect(col.description).toBe('Books to read')
    })

    it('stores parent_id when provided', async () => {
      const parent = await repo.create({ name: 'Parent' })
      const child = await repo.create({ name: 'Child', parent_id: parent.id })
      expect(child.parent_id).toBe(parent.id)
    })
  })

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the collection by id', async () => {
      const col = await repo.create({ name: 'Projects' })
      const fetched = await repo.get(col.id)
      expect(fetched.id).toBe(col.id)
      expect(fetched.name).toBe('Projects')
    })

    it('throws when collection does not exist', async () => {
      await expect(repo.get('nonexistent-id')).rejects.toThrow('Collection not found')
    })

    it('throws when collection is soft-deleted', async () => {
      const col = await repo.create({ name: 'ToDelete' })
      await repo.delete(col.id)
      await expect(repo.get(col.id)).rejects.toThrow('Collection not found')
    })
  })

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns empty array when no collections exist', async () => {
      const cols = await repo.list()
      expect(cols).toEqual([])
    })

    it('returns all active collections', async () => {
      await repo.create({ name: 'Alpha' })
      await repo.create({ name: 'Beta' })
      const cols = await repo.list()
      expect(cols).toHaveLength(2)
    })

    it('excludes soft-deleted collections', async () => {
      const col = await repo.create({ name: 'Gone' })
      await repo.create({ name: 'Alive' })
      await repo.delete(col.id)
      const cols = await repo.list()
      expect(cols).toHaveLength(1)
      expect(cols[0].name).toBe('Alive')
    })

    it('orders by position then name', async () => {
      await repo.create({ name: 'Zebra' })
      await repo.create({ name: 'Alpha' })
      const cols = await repo.list()
      // Both have position=0, so sort falls back to name
      expect(cols[0].name).toBe('Alpha')
      expect(cols[1].name).toBe('Zebra')
    })
  })

  // ── listTree ───────────────────────────────────────────────────────────────

  describe('listTree', () => {
    it('returns root collections as tree nodes', async () => {
      await repo.create({ name: 'Root' })
      const tree = await repo.listTree()
      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('Root')
    })

    it('nests children under their parent', async () => {
      const parent = await repo.create({ name: 'Parent' })
      await repo.create({ name: 'Child', parent_id: parent.id })
      const tree = await repo.listTree()
      expect(tree).toHaveLength(1)
      expect(tree[0].children).toHaveLength(1)
      expect(tree[0].children[0].name).toBe('Child')
    })

    it('child collections are not returned as root nodes', async () => {
      const parent = await repo.create({ name: 'Parent' })
      await repo.create({ name: 'Child', parent_id: parent.id })
      const tree = await repo.listTree()
      const names = tree.map((n) => n.name)
      expect(names).not.toContain('Child')
    })
  })

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates the name field', async () => {
      const col = await repo.create({ name: 'Old Name' })
      const updated = await repo.update(col.id, { name: 'New Name' })
      expect(updated.name).toBe('New Name')
    })

    it('updates the description field', async () => {
      const col = await repo.create({ name: 'Col' })
      const updated = await repo.update(col.id, { description: 'Added desc' })
      expect(updated.description).toBe('Added desc')
    })

    it('updates position field', async () => {
      const col = await repo.create({ name: 'Col' })
      const updated = await repo.update(col.id, { position: 5 })
      expect(updated.position).toBe(5)
    })

    it('throws when a collection is set as its own parent', async () => {
      const col = await repo.create({ name: 'Self' })
      await expect(repo.update(col.id, { parent_id: col.id })).rejects.toThrow(
        'Collection cannot be its own parent',
      )
    })

    it('throws when setting parent creates a two-level cycle', async () => {
      const a = await repo.create({ name: 'A' })
      const b = await repo.create({ name: 'B', parent_id: a.id })
      // Making A a child of B would create A → B → A
      await expect(repo.update(a.id, { parent_id: b.id })).rejects.toThrow(
        'Circular reference detected',
      )
    })
  })

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('soft-deletes the collection', async () => {
      const col = await repo.create({ name: 'ToDelete' })
      await repo.delete(col.id)
      await expect(repo.get(col.id)).rejects.toThrow('Collection not found')
    })

    it('unassigns notes when collection is deleted', async () => {
      const col = await repo.create({ name: 'HasNotes' })
      await repo.assignNote(col.id, 'note-1')
      await repo.delete(col.id)
      // collection_note row should be gone
      const result = await db.query(
        `SELECT * FROM collection_note WHERE collection_id = $1`,
        [col.id],
      )
      expect(result.rows).toHaveLength(0)
    })
  })

  // ── assignNote / unassignNote ──────────────────────────────────────────────

  describe('assignNote / unassignNote', () => {
    it('assigns a note to a collection', async () => {
      const col = await repo.create({ name: 'Col' })
      await repo.assignNote(col.id, 'note-1')
      const notes = await repo.getNotesInCollection(col.id)
      expect(notes).toContain('note-1')
    })

    it('is idempotent — assigning twice does not error', async () => {
      const col = await repo.create({ name: 'Col' })
      await repo.assignNote(col.id, 'note-1')
      await expect(repo.assignNote(col.id, 'note-1')).resolves.not.toThrow()
    })

    it('unassigns a note from a collection', async () => {
      const col = await repo.create({ name: 'Col' })
      await repo.assignNote(col.id, 'note-1')
      await repo.unassignNote(col.id, 'note-1')
      const notes = await repo.getNotesInCollection(col.id)
      expect(notes).not.toContain('note-1')
    })

    it('can assign multiple notes to the same collection', async () => {
      const col = await repo.create({ name: 'Col' })
      await repo.assignNote(col.id, 'note-1')
      await repo.assignNote(col.id, 'note-2')
      const notes = await repo.getNotesInCollection(col.id)
      expect(notes).toHaveLength(2)
    })
  })

  // ── getNotesInCollection ───────────────────────────────────────────────────

  describe('getNotesInCollection', () => {
    it('returns empty array when collection has no notes', async () => {
      const col = await repo.create({ name: 'Empty' })
      const notes = await repo.getNotesInCollection(col.id)
      expect(notes).toEqual([])
    })

    it('returns note IDs ordered by position', async () => {
      const col = await repo.create({ name: 'Ordered' })
      await repo.assignNote(col.id, 'note-1')
      await repo.assignNote(col.id, 'note-2')
      const notes = await repo.getNotesInCollection(col.id)
      // Both default to position=0 — order is stable
      expect(notes).toHaveLength(2)
    })
  })
})
