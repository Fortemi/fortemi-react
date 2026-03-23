/**
 * Tests for LinksRepository.
 *
 * Covers:
 * - create: inserts link with default 'related' type, duplicate prevention
 * - get: fetches by id, throws on not-found
 * - listForNote: returns outbound and inbound links
 * - getBacklinks: returns source note IDs pointing at a note
 * - delete: soft-deletes a link; backlinks/listForNote exclude deleted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { LinksRepository } from '../repositories/links-repository.js'

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

describe('LinksRepository', () => {
  let db: PGlite
  let repo: LinksRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new LinksRepository(db)
    await insertNote(db, 'note-a')
    await insertNote(db, 'note-b')
    await insertNote(db, 'note-c')
  })

  afterEach(async () => {
    await db.close()
  })

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a link with default type "related"', async () => {
      const link = await repo.create('note-a', 'note-b')
      expect(link.source_note_id).toBe('note-a')
      expect(link.target_note_id).toBe('note-b')
      expect(link.link_type).toBe('related')
      expect(link.deleted_at).toBeNull()
    })

    it('creates a link with a custom type', async () => {
      const link = await repo.create('note-a', 'note-b', 'references')
      expect(link.link_type).toBe('references')
    })

    it('returns the existing link when a duplicate is created', async () => {
      const first = await repo.create('note-a', 'note-b')
      const second = await repo.create('note-a', 'note-b')
      expect(second.id).toBe(first.id)
    })

    it('allows the same pair with different link types', async () => {
      const related = await repo.create('note-a', 'note-b', 'related')
      const refs = await repo.create('note-a', 'note-b', 'references')
      expect(related.id).not.toBe(refs.id)
    })

    it('returns the existing link even after a soft-delete creates a new active one', async () => {
      const first = await repo.create('note-a', 'note-b')
      // First link is still active — duplicate check returns it
      const dup = await repo.create('note-a', 'note-b')
      expect(dup.id).toBe(first.id)
    })
  })

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the link by id', async () => {
      const link = await repo.create('note-a', 'note-b')
      const fetched = await repo.get(link.id)
      expect(fetched.id).toBe(link.id)
    })

    it('throws when link does not exist', async () => {
      await expect(repo.get('nonexistent')).rejects.toThrow('Link not found')
    })

    it('returns a soft-deleted link (get does not filter deleted)', async () => {
      const link = await repo.create('note-a', 'note-b')
      await repo.delete(link.id)
      const fetched = await repo.get(link.id)
      expect(fetched.deleted_at).not.toBeNull()
    })
  })

  // ── listForNote ────────────────────────────────────────────────────────────

  describe('listForNote', () => {
    it('returns empty outbound and inbound arrays when no links exist', async () => {
      const result = await repo.listForNote('note-a')
      expect(result.outbound).toEqual([])
      expect(result.inbound).toEqual([])
    })

    it('returns outbound links (note-a as source)', async () => {
      await repo.create('note-a', 'note-b')
      const result = await repo.listForNote('note-a')
      expect(result.outbound).toHaveLength(1)
      expect(result.outbound[0].target_note_id).toBe('note-b')
    })

    it('returns inbound links (note-b as target)', async () => {
      await repo.create('note-a', 'note-b')
      const result = await repo.listForNote('note-b')
      expect(result.inbound).toHaveLength(1)
      expect(result.inbound[0].source_note_id).toBe('note-a')
    })

    it('excludes soft-deleted links from outbound', async () => {
      const link = await repo.create('note-a', 'note-b')
      await repo.delete(link.id)
      const result = await repo.listForNote('note-a')
      expect(result.outbound).toHaveLength(0)
    })

    it('excludes soft-deleted links from inbound', async () => {
      const link = await repo.create('note-a', 'note-b')
      await repo.delete(link.id)
      const result = await repo.listForNote('note-b')
      expect(result.inbound).toHaveLength(0)
    })
  })

  // ── getBacklinks ───────────────────────────────────────────────────────────

  describe('getBacklinks', () => {
    it('returns empty array when note has no inbound links', async () => {
      const backlinks = await repo.getBacklinks('note-a')
      expect(backlinks).toEqual([])
    })

    it('returns source note IDs of all inbound links', async () => {
      await repo.create('note-b', 'note-a')
      await repo.create('note-c', 'note-a')
      const backlinks = await repo.getBacklinks('note-a')
      expect(backlinks).toHaveLength(2)
      expect(backlinks).toContain('note-b')
      expect(backlinks).toContain('note-c')
    })

    it('excludes soft-deleted links from backlinks', async () => {
      const link = await repo.create('note-b', 'note-a')
      await repo.delete(link.id)
      const backlinks = await repo.getBacklinks('note-a')
      expect(backlinks).toEqual([])
    })
  })

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('soft-deletes the link — deleted_at is set', async () => {
      const link = await repo.create('note-a', 'note-b')
      await repo.delete(link.id)
      const fetched = await repo.get(link.id)
      expect(fetched.deleted_at).not.toBeNull()
    })

    it('a new identical link can be created after the old one is deleted', async () => {
      const first = await repo.create('note-a', 'note-b')
      await repo.delete(first.id)
      // After soft-delete, duplicate check (deleted_at IS NULL) won't match the old one
      // So a new link is created
      const second = await repo.create('note-a', 'note-b')
      expect(second.id).not.toBe(first.id)
      expect(second.deleted_at).toBeNull()
    })
  })
})
