/**
 * Extended tool functions — integration tests.
 *
 * Tests all 7 new tool functions:
 *   getNote, listNotes, manageTags, manageCollections,
 *   manageLinks, manageArchive, manageCapabilities
 *
 * Each test spins up a fresh in-memory PGlite instance with all migrations
 * applied. Tool functions are tested end-to-end: Zod validation →
 * repository delegation → typed output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { ArchiveManager } from '../archive-manager.js'
import { CapabilityManager } from '../capability-manager.js'
import { allMigrations } from '../migrations/index.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import { getNote } from '../tools/get-note.js'
import { listNotes } from '../tools/list-notes.js'
import { manageTags } from '../tools/manage-tags.js'
import { manageCollections } from '../tools/manage-collections.js'
import { manageLinks } from '../tools/manage-links.js'
import { manageArchive } from '../tools/manage-archive.js'
import { manageCapabilities } from '../tools/manage-capabilities.js'

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

async function createTestNote(db: PGlite, content = 'Test content', title?: string) {
  const events = new TypedEventBus()
  const repo = new NotesRepository(db, events)
  return repo.create({ content, title, tags: ['initial-tag'] })
}

// ---------------------------------------------------------------------------
// getNote
// ---------------------------------------------------------------------------

describe('getNote', () => {
  let db: PGlite
  let events: TypedEventBus

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
  })

  afterEach(async () => {
    await db.close()
  })

  it('returns a NoteFull for a valid note ID', async () => {
    const created = await createTestNote(db, 'Hello world', 'My Title')

    const result = await getNote(db, { note_id: created.id }, events)

    expect(result.id).toBe(created.id)
    expect(result.title).toBe('My Title')
    expect(result.original.content).toBe('Hello world')
    expect(result.current.content).toBe('Hello world')
    expect(result.tags).toContain('initial-tag')
  })

  it('throws for a non-existent note ID', async () => {
    await expect(
      getNote(db, { note_id: 'nonexistent-id' }, events),
    ).rejects.toThrow('Note not found: nonexistent-id')
  })

  it('rejects invalid input (missing note_id)', async () => {
    await expect(
      getNote(db, {}, events),
    ).rejects.toThrow()
  })

  it('rejects invalid input (note_id not a string)', async () => {
    await expect(
      getNote(db, { note_id: 42 }, events),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------

describe('listNotes', () => {
  let db: PGlite
  let events: TypedEventBus

  beforeEach(async () => {
    db = await createTestDb()
    events = new TypedEventBus()
  })

  afterEach(async () => {
    await db.close()
  })

  it('returns a paginated result with default options', async () => {
    await createTestNote(db, 'Note A', 'A')
    await createTestNote(db, 'Note B', 'B')

    const result = await listNotes(db, {}, events)

    expect(result.items.length).toBeGreaterThanOrEqual(2)
    expect(result.total).toBeGreaterThanOrEqual(2)
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)
  })

  it('respects limit and offset for pagination', async () => {
    for (let i = 1; i <= 5; i++) {
      await createTestNote(db, `Note ${i}`, `Title ${i}`)
    }

    const page1 = await listNotes(db, { limit: 2, offset: 0 }, events)
    const page2 = await listNotes(db, { limit: 2, offset: 2 }, events)

    expect(page1.items).toHaveLength(2)
    expect(page2.items).toHaveLength(2)
    const page1Ids = new Set(page1.items.map((n) => n.id))
    expect(page2.items.every((n) => !page1Ids.has(n.id))).toBe(true)
  })

  it('filters by is_starred', async () => {
    const repo = new NotesRepository(db, events)
    const note = await createTestNote(db, 'Star me')
    await repo.star(note.id, true)

    const result = await listNotes(db, { is_starred: true }, events)

    expect(result.items.some((n) => n.id === note.id)).toBe(true)
    expect(result.items.every((n) => n.is_starred)).toBe(true)
  })

  it('filters by is_archived', async () => {
    const repo = new NotesRepository(db, events)
    const note = await createTestNote(db, 'Archive me')
    await repo.archive(note.id, true)

    const result = await listNotes(db, { is_archived: true }, events)

    expect(result.items.some((n) => n.id === note.id)).toBe(true)
  })

  it('filters by tags', async () => {
    const repo = new NotesRepository(db, events)
    await repo.create({ content: 'Tagged note', tags: ['unique-tag-xyz'] })
    await createTestNote(db, 'Untagged note', 'No tags')

    const result = await listNotes(db, { tags: ['unique-tag-xyz'] }, events)

    expect(result.items.length).toBeGreaterThanOrEqual(1)
    expect(result.items.every((n) => n.tags.includes('unique-tag-xyz'))).toBe(true)
  })

  it('excludes soft-deleted notes by default', async () => {
    const repo = new NotesRepository(db, events)
    const note = await createTestNote(db, 'Delete me')
    await repo.delete(note.id)

    const result = await listNotes(db, {}, events)

    expect(result.items.every((n) => n.id !== note.id)).toBe(true)
  })

  it('includes deleted notes when include_deleted is true', async () => {
    const repo = new NotesRepository(db, events)
    const note = await createTestNote(db, 'Find me deleted')
    await repo.delete(note.id)

    const result = await listNotes(db, { include_deleted: true }, events)

    expect(result.items.some((n) => n.id === note.id)).toBe(true)
  })

  it('rejects limit above maximum (100)', async () => {
    await expect(
      listNotes(db, { limit: 101 }, events),
    ).rejects.toThrow()
  })

  it('rejects limit below minimum (1)', async () => {
    await expect(
      listNotes(db, { limit: 0 }, events),
    ).rejects.toThrow()
  })

  it('rejects negative offset', async () => {
    await expect(
      listNotes(db, { offset: -1 }, events),
    ).rejects.toThrow()
  })

  it('rejects invalid sort enum value', async () => {
    await expect(
      listNotes(db, { sort: 'invalid_column' as 'created_at' }, events),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// manageTags
// ---------------------------------------------------------------------------

describe('manageTags', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('adds a tag to a note and returns updated tag list', async () => {
    const note = await createTestNote(db, 'Tag test note')

    const result = await manageTags(db, {
      action: 'add',
      note_id: note.id,
      tag: 'new-tag',
    })

    expect(result.action).toBe('add')
    expect(result.tags).toContain('new-tag')
    expect(result.tags).toContain('initial-tag')
  })

  it('removes a tag from a note', async () => {
    const note = await createTestNote(db, 'Tag remove test')

    await manageTags(db, { action: 'add', note_id: note.id, tag: 'to-remove' })
    const result = await manageTags(db, {
      action: 'remove',
      note_id: note.id,
      tag: 'to-remove',
    })

    expect(result.action).toBe('remove')
    expect(result.tags).not.toContain('to-remove')
  })

  it('lists tags for a specific note', async () => {
    const note = await createTestNote(db, 'List tags note')
    await manageTags(db, { action: 'add', note_id: note.id, tag: 'alpha' })
    await manageTags(db, { action: 'add', note_id: note.id, tag: 'beta' })

    const result = await manageTags(db, {
      action: 'list_for_note',
      note_id: note.id,
    })

    expect(result.action).toBe('list_for_note')
    expect(result.tags).toContain('alpha')
    expect(result.tags).toContain('beta')
  })

  it('lists all tags with counts', async () => {
    const note = await createTestNote(db, 'Global tag note')
    await manageTags(db, { action: 'add', note_id: note.id, tag: 'global-tag' })

    const result = await manageTags(db, { action: 'list_all' })

    expect(result.action).toBe('list_all')
    expect(result.all_tags).toBeDefined()
    expect(result.all_tags!.some((t) => t.tag === 'global-tag')).toBe(true)
    expect(result.all_tags!.every((t) => typeof t.count === 'number')).toBe(true)
  })

  it('throws for add action without note_id', async () => {
    await expect(
      manageTags(db, { action: 'add', tag: 'orphan' }),
    ).rejects.toThrow('note_id and tag required for add')
  })

  it('throws for add action without tag', async () => {
    const note = await createTestNote(db)
    await expect(
      manageTags(db, { action: 'add', note_id: note.id }),
    ).rejects.toThrow('note_id and tag required for add')
  })

  it('throws for remove action without note_id', async () => {
    await expect(
      manageTags(db, { action: 'remove', tag: 'some-tag' }),
    ).rejects.toThrow('note_id and tag required for remove')
  })

  it('throws for list_for_note action without note_id', async () => {
    await expect(
      manageTags(db, { action: 'list_for_note' }),
    ).rejects.toThrow('note_id required for list_for_note')
  })

  it('rejects invalid action', async () => {
    await expect(
      manageTags(db, { action: 'invalid' }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// manageCollections
// ---------------------------------------------------------------------------

describe('manageCollections', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates a collection with a name', async () => {
    const result = await manageCollections(db, {
      action: 'create',
      name: 'My Collection',
      description: 'A test collection',
    })

    expect(result.action).toBe('create')
    expect(result.collection).toBeDefined()
    expect(result.collection!.name).toBe('My Collection')
    expect(result.collection!.description).toBe('A test collection')
  })

  it('lists all collections', async () => {
    await manageCollections(db, { action: 'create', name: 'Collection A' })
    await manageCollections(db, { action: 'create', name: 'Collection B' })

    const result = await manageCollections(db, { action: 'list' })

    expect(result.action).toBe('list')
    expect(result.collections).toBeDefined()
    expect(result.collections!.length).toBeGreaterThanOrEqual(2)
  })

  it('assigns a note to a collection', async () => {
    const note = await createTestNote(db, 'Note to assign')
    const collResult = await manageCollections(db, {
      action: 'create',
      name: 'Target Collection',
    })
    const collection = collResult.collection!

    const result = await manageCollections(db, {
      action: 'assign',
      collection_id: collection.id,
      note_id: note.id,
    })

    expect(result.action).toBe('assign')
  })

  it('unassigns a note from a collection', async () => {
    const note = await createTestNote(db, 'Note to unassign')
    const collResult = await manageCollections(db, {
      action: 'create',
      name: 'Unassign Collection',
    })
    const collection = collResult.collection!

    await manageCollections(db, {
      action: 'assign',
      collection_id: collection.id,
      note_id: note.id,
    })
    const result = await manageCollections(db, {
      action: 'unassign',
      collection_id: collection.id,
      note_id: note.id,
    })

    expect(result.action).toBe('unassign')
  })

  it('soft-deletes a collection', async () => {
    const collResult = await manageCollections(db, {
      action: 'create',
      name: 'To Delete',
    })
    const collection = collResult.collection!

    const result = await manageCollections(db, {
      action: 'delete',
      collection_id: collection.id,
    })

    expect(result.action).toBe('delete')

    // Verify it no longer appears in list
    const listResult = await manageCollections(db, { action: 'list' })
    expect(listResult.collections!.every((c) => c.id !== collection.id)).toBe(true)
  })

  it('throws for create action without name', async () => {
    await expect(
      manageCollections(db, { action: 'create' }),
    ).rejects.toThrow('name required for create')
  })

  it('throws for assign action without collection_id', async () => {
    const note = await createTestNote(db)
    await expect(
      manageCollections(db, { action: 'assign', note_id: note.id }),
    ).rejects.toThrow('collection_id and note_id required')
  })

  it('throws for delete action without collection_id', async () => {
    await expect(
      manageCollections(db, { action: 'delete' }),
    ).rejects.toThrow('collection_id required')
  })

  it('rejects invalid action', async () => {
    await expect(
      manageCollections(db, { action: 'rename' }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// manageLinks
// ---------------------------------------------------------------------------

describe('manageLinks', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates a link between two notes', async () => {
    const noteA = await createTestNote(db, 'Source note', 'A')
    const noteB = await createTestNote(db, 'Target note', 'B')

    const result = await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
      link_type: 'related',
    })

    expect(result.action).toBe('create')
    expect(result.link).toBeDefined()
    expect(result.link!.source_note_id).toBe(noteA.id)
    expect(result.link!.target_note_id).toBe(noteB.id)
    expect(result.link!.link_type).toBe('related')
  })

  it('returns existing link on duplicate create (idempotent)', async () => {
    const noteA = await createTestNote(db, 'Source note')
    const noteB = await createTestNote(db, 'Target note')

    const first = await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
    })
    const second = await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
    })

    expect(first.link!.id).toBe(second.link!.id)
  })

  it('lists outbound and inbound links for a note', async () => {
    const noteA = await createTestNote(db, 'A')
    const noteB = await createTestNote(db, 'B')
    const noteC = await createTestNote(db, 'C')

    await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
    })
    await manageLinks(db, {
      action: 'create',
      source_note_id: noteC.id,
      target_note_id: noteA.id,
    })

    const result = await manageLinks(db, {
      action: 'list',
      note_id: noteA.id,
    })

    expect(result.action).toBe('list')
    expect(result.outbound).toBeDefined()
    expect(result.inbound).toBeDefined()
    expect(result.outbound!.some((l) => l.target_note_id === noteB.id)).toBe(true)
    expect(result.inbound!.some((l) => l.source_note_id === noteC.id)).toBe(true)
  })

  it('soft-deletes a link', async () => {
    const noteA = await createTestNote(db, 'A')
    const noteB = await createTestNote(db, 'B')

    const created = await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
    })
    const linkId = created.link!.id

    const result = await manageLinks(db, {
      action: 'delete',
      link_id: linkId,
    })

    expect(result.action).toBe('delete')

    // Link no longer appears in list after soft-delete
    const listResult = await manageLinks(db, {
      action: 'list',
      note_id: noteA.id,
    })
    expect(listResult.outbound!.every((l) => l.id !== linkId)).toBe(true)
  })

  it('returns backlinks for a note', async () => {
    const noteA = await createTestNote(db, 'A')
    const noteB = await createTestNote(db, 'B')

    await manageLinks(db, {
      action: 'create',
      source_note_id: noteA.id,
      target_note_id: noteB.id,
    })

    const result = await manageLinks(db, {
      action: 'backlinks',
      note_id: noteB.id,
    })

    expect(result.action).toBe('backlinks')
    expect(result.backlinks).toContain(noteA.id)
  })

  it('throws for create action without source_note_id', async () => {
    const noteB = await createTestNote(db)
    await expect(
      manageLinks(db, { action: 'create', target_note_id: noteB.id }),
    ).rejects.toThrow('source_note_id and target_note_id required')
  })

  it('throws for list action without note_id', async () => {
    await expect(
      manageLinks(db, { action: 'list' }),
    ).rejects.toThrow('note_id required for list')
  })

  it('throws for delete action without link_id', async () => {
    await expect(
      manageLinks(db, { action: 'delete' }),
    ).rejects.toThrow('link_id required for delete')
  })

  it('throws for backlinks action without note_id', async () => {
    await expect(
      manageLinks(db, { action: 'backlinks' }),
    ).rejects.toThrow('note_id required for backlinks')
  })

  it('rejects invalid action', async () => {
    await expect(
      manageLinks(db, { action: 'update' }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// manageArchive
// ---------------------------------------------------------------------------

describe('manageArchive', () => {
  let manager: ArchiveManager
  let events: TypedEventBus

  beforeEach(() => {
    events = new TypedEventBus()
    manager = new ArchiveManager('memory', events)
  })

  it('lists archives including the default', async () => {
    const result = await manageArchive(manager, { action: 'list' })

    expect(result.action).toBe('list')
    expect(result.archives).toBeDefined()
    expect(result.archives!.some((a) => a.name === 'default')).toBe(true)
    expect(result.current).toBe('default')
  })

  it('creates a new archive', async () => {
    const result = await manageArchive(manager, {
      action: 'create',
      name: 'my-archive',
    })

    expect(result.action).toBe('create')
    expect(result.current).toBe('my-archive')

    // Created archive should now appear in the list
    const listResult = await manageArchive(manager, { action: 'list' })
    expect(listResult.archives!.some((a) => a.name === 'my-archive')).toBe(true)
  })

  it('switches to an existing archive', async () => {
    await manageArchive(manager, { action: 'create', name: 'archive-b' })

    const result = await manageArchive(manager, {
      action: 'switch',
      name: 'archive-b',
    })

    expect(result.action).toBe('switch')
    expect(result.current).toBe('archive-b')
  })

  it('deletes a non-default archive', async () => {
    await manageArchive(manager, { action: 'create', name: 'to-delete' })

    const result = await manageArchive(manager, {
      action: 'delete',
      name: 'to-delete',
    })

    expect(result.action).toBe('delete')

    // Should no longer appear in list
    const listResult = await manageArchive(manager, { action: 'list' })
    expect(listResult.archives!.every((a) => a.name !== 'to-delete')).toBe(true)
  })

  it('throws for create action without name', async () => {
    await expect(
      manageArchive(manager, { action: 'create' }),
    ).rejects.toThrow('name required for create')
  })

  it('throws for switch action without name', async () => {
    await expect(
      manageArchive(manager, { action: 'switch' }),
    ).rejects.toThrow('name required for switch')
  })

  it('throws for delete action without name', async () => {
    await expect(
      manageArchive(manager, { action: 'delete' }),
    ).rejects.toThrow('name required for delete')
  })

  it('rejects invalid action', async () => {
    await expect(
      manageArchive(manager, { action: 'rename' }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// manageCapabilities
// ---------------------------------------------------------------------------

describe('manageCapabilities', () => {
  let manager: CapabilityManager
  let events: TypedEventBus

  beforeEach(() => {
    events = new TypedEventBus()
    manager = new CapabilityManager(events)
  })

  it('lists all capabilities with their states', async () => {
    const result = await manageCapabilities(manager, { action: 'list' })

    expect(result.action).toBe('list')
    expect(result.capabilities).toBeDefined()
    expect(result.capabilities!.length).toBeGreaterThan(0)
    expect(result.capabilities!.every((c) => typeof c.name === 'string')).toBe(true)
    expect(result.capabilities!.every((c) => typeof c.state === 'string')).toBe(true)
  })

  it('enables a capability (no loader → transitions to ready)', async () => {
    const result = await manageCapabilities(manager, {
      action: 'enable',
      capability: 'semantic',
    })

    expect(result.action).toBe('enable')
    expect(result.capability).toBeDefined()
    expect(result.capability!.name).toBe('semantic')
    expect(result.capability!.state).toBe('ready')
  })

  it('disables a ready capability', async () => {
    // Enable first so it is in 'ready' state
    await manageCapabilities(manager, { action: 'enable', capability: 'llm' })

    const result = await manageCapabilities(manager, {
      action: 'disable',
      capability: 'llm',
    })

    expect(result.action).toBe('disable')
    expect(result.capability!.state).toBe('disabled')
  })

  it('returns status for a specific capability', async () => {
    const result = await manageCapabilities(manager, {
      action: 'status',
      capability: 'audio',
    })

    expect(result.action).toBe('status')
    expect(result.capability!.name).toBe('audio')
    expect(result.capability!.state).toBe('unloaded')
  })

  it('reflects error in status when capability failed to load', async () => {
    manager.registerLoader('vision', async () => {
      throw new Error('WASM load failed')
    })

    await manageCapabilities(manager, { action: 'enable', capability: 'vision' })

    const result = await manageCapabilities(manager, {
      action: 'status',
      capability: 'vision',
    })

    expect(result.capability!.state).toBe('error')
    expect(result.capability!.error).toBe('WASM load failed')
  })

  it('throws for enable action without capability', async () => {
    await expect(
      manageCapabilities(manager, { action: 'enable' }),
    ).rejects.toThrow('capability required for enable')
  })

  it('throws for disable action without capability', async () => {
    await expect(
      manageCapabilities(manager, { action: 'disable' }),
    ).rejects.toThrow('capability required for disable')
  })

  it('throws for status action without capability', async () => {
    await expect(
      manageCapabilities(manager, { action: 'status' }),
    ).rejects.toThrow('capability required for status')
  })

  it('rejects invalid action', async () => {
    await expect(
      manageCapabilities(manager, { action: 'toggle' }),
    ).rejects.toThrow()
  })
})
