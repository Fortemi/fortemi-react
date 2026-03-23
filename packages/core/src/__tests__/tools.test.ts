/**
 * Tool functions — integration tests.
 *
 * Each test spins up a fresh in-memory PGlite instance with all migrations
 * applied. Tool functions are tested end-to-end: Zod validation → repository
 * delegation → typed output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { allMigrations } from '../migrations/index.js'
import { captureKnowledge } from '../tools/capture-knowledge.js'
import { manageNote } from '../tools/manage-note.js'
import { searchTool } from '../tools/search.js'

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

// ---------------------------------------------------------------------------
// captureKnowledge
// ---------------------------------------------------------------------------

describe('captureKnowledge', () => {
  let db: PGlite
  let events: TypedEventBus

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('create action', () => {
    it('creates a note and returns it in the result', async () => {
      const result = await captureKnowledge(db, {
        action: 'create',
        content: 'Test note content',
        title: 'Test Title',
        format: 'markdown',
        tags: ['tag1', 'tag2'],
      }, events)

      expect(result.action).toBe('create')
      expect(result.notes).toHaveLength(1)
      const note = result.notes[0]
      expect(note.title).toBe('Test Title')
      expect(note.format).toBe('markdown')
      expect(note.original.content).toBe('Test note content')
      expect(note.current.content).toBe('Test note content')
      expect(note.tags).toEqual(['tag1', 'tag2'])
    })

    it('uses default values when optional fields are omitted', async () => {
      const result = await captureKnowledge(db, {
        action: 'create',
        content: 'Minimal note',
      }, events)

      expect(result.notes[0].format).toBe('markdown')
      expect(result.notes[0].source).toBe('user')
      expect(result.notes[0].visibility).toBe('private')
    })

    it('throws when content is missing for create action', async () => {
      await expect(
        captureKnowledge(db, { action: 'create' }, events),
      ).rejects.toThrow('content is required for create action')
    })
  })

  describe('bulk_create action', () => {
    it('creates multiple notes and returns all of them', async () => {
      const result = await captureKnowledge(db, {
        action: 'bulk_create',
        notes: [
          { content: 'Note one', title: 'One' },
          { content: 'Note two', title: 'Two' },
          { content: 'Note three' },
        ],
      }, events)

      expect(result.action).toBe('bulk_create')
      expect(result.notes).toHaveLength(3)
      expect(result.notes[0].title).toBe('One')
      expect(result.notes[1].title).toBe('Two')
      expect(result.notes[2].title).toBeNull()
    })

    it('throws when notes array is missing for bulk_create', async () => {
      await expect(
        captureKnowledge(db, { action: 'bulk_create' }, events),
      ).rejects.toThrow('notes array is required for bulk_create action')
    })

    it('throws when notes array is empty for bulk_create', async () => {
      await expect(
        captureKnowledge(db, { action: 'bulk_create', notes: [] }, events),
      ).rejects.toThrow('notes array is required for bulk_create action')
    })
  })

  describe('from_template action', () => {
    it('substitutes variables in the template', async () => {
      const result = await captureKnowledge(db, {
        action: 'from_template',
        template: 'Hello, {{name}}! Today is {{date}}.',
        variables: { name: 'Alice', date: '2026-03-22' },
        title: 'Greeting',
      }, events)

      expect(result.action).toBe('from_template')
      expect(result.notes).toHaveLength(1)
      expect(result.notes[0].original.content).toBe('Hello, Alice! Today is 2026-03-22.')
      expect(result.notes[0].title).toBe('Greeting')
    })

    it('creates note from template with no variables', async () => {
      const result = await captureKnowledge(db, {
        action: 'from_template',
        template: 'Static template content',
      }, events)

      expect(result.notes[0].original.content).toBe('Static template content')
    })

    it('throws when template is missing for from_template', async () => {
      await expect(
        captureKnowledge(db, { action: 'from_template' }, events),
      ).rejects.toThrow('template is required for from_template action')
    })
  })

  describe('Zod validation', () => {
    it('rejects invalid action value', async () => {
      await expect(
        captureKnowledge(db, { action: 'invalid_action', content: 'Test' }, events),
      ).rejects.toThrow()
    })

    it('rejects input with missing action field', async () => {
      await expect(
        captureKnowledge(db, { content: 'Test' }, events),
      ).rejects.toThrow()
    })

    it('rejects invalid format value', async () => {
      await expect(
        captureKnowledge(db, {
          action: 'create',
          content: 'Test',
          format: 'pdf',
        }, events),
      ).rejects.toThrow()
    })

    it('rejects invalid visibility value', async () => {
      await expect(
        captureKnowledge(db, {
          action: 'create',
          content: 'Test',
          visibility: 'hidden',
        }, events),
      ).rejects.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// manageNote
// ---------------------------------------------------------------------------

describe('manageNote', () => {
  let db: PGlite
  let events: TypedEventBus

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
  })

  afterEach(async () => {
    await db.close()
  })

  async function createNote(content: string, title?: string) {
    const result = await captureKnowledge(db, {
      action: 'create',
      content,
      title,
    }, events)
    return result.notes[0]
  }

  describe('update action', () => {
    it('updates title and content of a note', async () => {
      const note = await createNote('Original content', 'Original title')

      const result = await manageNote(db, {
        action: 'update',
        note_id: note.id,
        title: 'Updated title',
        content: 'Updated content',
      }, events)

      expect(result.action).toBe('update')
      expect(result.note_id).toBe(note.id)
      expect(result.note?.title).toBe('Updated title')
      expect(result.note?.current.content).toBe('Updated content')
    })

    it('updates only the title when content is omitted', async () => {
      const note = await createNote('Content stays', 'Old title')

      const result = await manageNote(db, {
        action: 'update',
        note_id: note.id,
        title: 'New title',
      }, events)

      expect(result.note?.title).toBe('New title')
      expect(result.note?.current.content).toBe('Content stays')
    })
  })

  describe('delete action', () => {
    it('soft-deletes a note', async () => {
      const note = await createNote('To be deleted')

      const result = await manageNote(db, {
        action: 'delete',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('delete')
      expect(result.note_id).toBe(note.id)
      expect(result.note).toBeUndefined()
    })
  })

  describe('restore action', () => {
    it('restores a soft-deleted note', async () => {
      const note = await createNote('To be restored')

      await manageNote(db, { action: 'delete', note_id: note.id }, events)

      const result = await manageNote(db, {
        action: 'restore',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('restore')
      expect(result.note?.deleted_at).toBeNull()
    })
  })

  describe('star / unstar actions', () => {
    it('stars a note', async () => {
      const note = await createNote('Star me')

      const result = await manageNote(db, {
        action: 'star',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('star')
      expect(result.note?.is_starred).toBe(true)
    })

    it('unstars a note', async () => {
      const note = await createNote('Unstar me')

      await manageNote(db, { action: 'star', note_id: note.id }, events)
      const result = await manageNote(db, {
        action: 'unstar',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('unstar')
      expect(result.note?.is_starred).toBe(false)
    })
  })

  describe('archive / unarchive actions', () => {
    it('archives a note', async () => {
      const note = await createNote('Archive me')

      const result = await manageNote(db, {
        action: 'archive',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('archive')
      expect(result.note?.is_archived).toBe(true)
    })

    it('unarchives a note', async () => {
      const note = await createNote('Unarchive me')

      await manageNote(db, { action: 'archive', note_id: note.id }, events)
      const result = await manageNote(db, {
        action: 'unarchive',
        note_id: note.id,
      }, events)

      expect(result.action).toBe('unarchive')
      expect(result.note?.is_archived).toBe(false)
    })
  })

  describe('Zod validation', () => {
    it('rejects invalid action', async () => {
      await expect(
        manageNote(db, { action: 'invalid', note_id: 'some-id' }, events),
      ).rejects.toThrow()
    })

    it('rejects missing note_id', async () => {
      await expect(
        manageNote(db, { action: 'delete' }, events),
      ).rejects.toThrow()
    })

    it('rejects missing action field', async () => {
      await expect(
        manageNote(db, { note_id: 'some-id' }, events),
      ).rejects.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// searchTool
// ---------------------------------------------------------------------------

describe('searchTool', () => {
  let db: PGlite
  let events: TypedEventBus

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
  })

  afterEach(async () => {
    await db.close()
  })

  async function createNote(content: string, title?: string, tags?: string[]) {
    return captureKnowledge(db, { action: 'create', content, title, tags }, events)
  }

  describe('text mode search', () => {
    it('returns results matching the query', async () => {
      await createNote('The quick brown fox jumps over the lazy dog', 'Fox note')
      await createNote('Completely unrelated content about cooking')

      const result = await searchTool(db, {
        query: 'fox',
        mode: 'text',
      })

      expect(result.mode).toBe('text')
      expect(result.query).toBe('fox')
      expect(result.results.length).toBeGreaterThanOrEqual(1)
      const ids = result.results.map((r) => r.id)
      expect(ids.some(Boolean)).toBe(true)
    })

    it('returns recent notes for an empty query', async () => {
      await createNote('Note A')
      await createNote('Note B')

      const result = await searchTool(db, {
        query: '',
        mode: 'text',
      })

      expect(result.results.length).toBeGreaterThanOrEqual(2)
      expect(result.total).toBeGreaterThanOrEqual(2)
    })

    it('respects limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await createNote(`Note number ${i}`)
      }

      const page1 = await searchTool(db, { query: '', mode: 'text', limit: 2, offset: 0 })
      const page2 = await searchTool(db, { query: '', mode: 'text', limit: 2, offset: 2 })

      expect(page1.results).toHaveLength(2)
      expect(page2.results).toHaveLength(2)
      // Pages should return different notes
      const page1Ids = new Set(page1.results.map((r) => r.id))
      const page2Ids = page2.results.map((r) => r.id)
      expect(page2Ids.every((id) => !page1Ids.has(id))).toBe(true)
    })

    it('returns semantic_available: false', async () => {
      const result = await searchTool(db, { query: 'test', mode: 'text' })
      expect(result.semantic_available).toBe(false)
    })
  })

  describe('unsupported modes', () => {
    it('throws for semantic mode', async () => {
      await expect(
        searchTool(db, { query: 'test', mode: 'semantic' }),
      ).rejects.toThrow("Search mode 'semantic' is not available")
    })

    it('throws for hybrid mode', async () => {
      await expect(
        searchTool(db, { query: 'test', mode: 'hybrid' }),
      ).rejects.toThrow("Search mode 'hybrid' is not available")
    })
  })

  describe('Zod validation', () => {
    it('rejects limit below minimum (1)', async () => {
      await expect(
        searchTool(db, { query: 'test', limit: 0 }),
      ).rejects.toThrow()
    })

    it('rejects limit above maximum (100)', async () => {
      await expect(
        searchTool(db, { query: 'test', limit: 101 }),
      ).rejects.toThrow()
    })

    it('rejects invalid mode enum value', async () => {
      await expect(
        searchTool(db, { query: 'test', mode: 'fuzzy' }),
      ).rejects.toThrow()
    })

    it('rejects missing query field', async () => {
      await expect(
        searchTool(db, { mode: 'text' }),
      ).rejects.toThrow()
    })

    it('rejects negative offset', async () => {
      await expect(
        searchTool(db, { query: 'test', offset: -1 }),
      ).rejects.toThrow()
    })
  })
})
