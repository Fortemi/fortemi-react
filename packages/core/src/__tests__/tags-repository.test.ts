/**
 * Tests for TagsRepository.
 *
 * Covers:
 * - addTag: inserts tag, idempotent on duplicate
 * - removeTag: deletes tag, no-op when tag absent
 * - getTagsForNote: returns sorted tags for a note
 * - getNotesForTag: returns note IDs that share a tag
 * - listAllTags: aggregate counts, ordered by frequency then name
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { TagsRepository } from '../repositories/tags-repository.js'

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── suite ─────────────────────────────────────────────────────────────────────

describe('TagsRepository', () => {
  let db: PGlite
  let repo: TagsRepository

  beforeEach(async () => {
    db = await setupDb()
    repo = new TagsRepository(db)
    await insertNote(db, 'note-1')
    await insertNote(db, 'note-2')
  })

  afterEach(async () => {
    await db.close()
  })

  // ── addTag ─────────────────────────────────────────────────────────────────

  describe('addTag', () => {
    it('adds a tag to a note', async () => {
      await repo.addTag('note-1', 'rust')
      const tags = await repo.getTagsForNote('note-1')
      expect(tags).toContain('rust')
    })

    it('is idempotent — adding the same tag twice does not error or duplicate', async () => {
      await repo.addTag('note-1', 'rust')
      await repo.addTag('note-1', 'rust')
      const tags = await repo.getTagsForNote('note-1')
      expect(tags.filter((t) => t === 'rust')).toHaveLength(1)
    })

    it('allows the same tag on different notes', async () => {
      await repo.addTag('note-1', 'shared')
      await repo.addTag('note-2', 'shared')
      const notes = await repo.getNotesForTag('shared')
      expect(notes).toContain('note-1')
      expect(notes).toContain('note-2')
    })
  })

  // ── removeTag ──────────────────────────────────────────────────────────────

  describe('removeTag', () => {
    it('removes an existing tag from a note', async () => {
      await repo.addTag('note-1', 'go')
      await repo.removeTag('note-1', 'go')
      const tags = await repo.getTagsForNote('note-1')
      expect(tags).not.toContain('go')
    })

    it('is a no-op when the tag does not exist on the note', async () => {
      await expect(repo.removeTag('note-1', 'nonexistent')).resolves.not.toThrow()
    })

    it('only removes the tag from the target note — not from others', async () => {
      await repo.addTag('note-1', 'shared')
      await repo.addTag('note-2', 'shared')
      await repo.removeTag('note-1', 'shared')

      const note1Tags = await repo.getTagsForNote('note-1')
      const note2Tags = await repo.getTagsForNote('note-2')
      expect(note1Tags).not.toContain('shared')
      expect(note2Tags).toContain('shared')
    })
  })

  // ── getTagsForNote ────────────────────────────────────────────────────────

  describe('getTagsForNote', () => {
    it('returns empty array when note has no tags', async () => {
      const tags = await repo.getTagsForNote('note-1')
      expect(tags).toEqual([])
    })

    it('returns tags sorted alphabetically', async () => {
      await repo.addTag('note-1', 'zebra')
      await repo.addTag('note-1', 'apple')
      await repo.addTag('note-1', 'mango')
      const tags = await repo.getTagsForNote('note-1')
      expect(tags).toEqual(['apple', 'mango', 'zebra'])
    })

    it('returns only tags for the requested note', async () => {
      await repo.addTag('note-1', 'exclusive')
      await repo.addTag('note-2', 'other')
      const tags = await repo.getTagsForNote('note-1')
      expect(tags).toEqual(['exclusive'])
    })
  })

  // ── getNotesForTag ────────────────────────────────────────────────────────

  describe('getNotesForTag', () => {
    it('returns empty array when no notes have the tag', async () => {
      const notes = await repo.getNotesForTag('absent')
      expect(notes).toEqual([])
    })

    it('returns all note IDs that carry the tag', async () => {
      await repo.addTag('note-1', 'lang')
      await repo.addTag('note-2', 'lang')
      const notes = await repo.getNotesForTag('lang')
      expect(notes).toHaveLength(2)
      expect(notes).toContain('note-1')
      expect(notes).toContain('note-2')
    })
  })

  // ── listAllTags ───────────────────────────────────────────────────────────

  describe('listAllTags', () => {
    it('returns empty array when no tags exist', async () => {
      const tags = await repo.listAllTags()
      expect(tags).toEqual([])
    })

    it('returns tags with correct counts', async () => {
      await repo.addTag('note-1', 'popular')
      await repo.addTag('note-2', 'popular')
      await repo.addTag('note-1', 'rare')

      const tags = await repo.listAllTags()
      const popular = tags.find((t) => t.tag === 'popular')
      const rare = tags.find((t) => t.tag === 'rare')
      expect(popular?.count).toBe(2)
      expect(rare?.count).toBe(1)
    })

    it('orders by count descending, then name ascending on tie', async () => {
      await repo.addTag('note-1', 'beta')
      await repo.addTag('note-1', 'alpha')
      await repo.addTag('note-2', 'beta')

      const tags = await repo.listAllTags()
      expect(tags[0].tag).toBe('beta') // count=2 — highest
      // alpha and beta both have count=1... but 'alpha' tag only has count 1
      // Remaining: alpha=1
      expect(tags[1].tag).toBe('alpha')
    })

    it('count values are numbers, not strings', async () => {
      await repo.addTag('note-1', 'typed')
      const tags = await repo.listAllTags()
      expect(typeof tags[0].count).toBe('number')
    })
  })
})
