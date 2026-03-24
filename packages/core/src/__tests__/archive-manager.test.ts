import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ArchiveManager } from '../archive-manager.js'
import { TypedEventBus } from '../event-bus.js'

describe('ArchiveManager', { timeout: 30_000 }, () => {
  let manager: ArchiveManager
  let events: TypedEventBus

  beforeEach(() => {
    events = new TypedEventBus()
    manager = new ArchiveManager('memory', events)
  })

  afterEach(async () => {
    await manager.close()
  })

  it('starts with no open DB and default archive in list', () => {
    expect(manager.getDb()).toBeNull()
    expect(manager.getCurrentArchiveName()).toBe('default')
    const archives = manager.listArchives()
    expect(archives).toHaveLength(1)
    expect(archives[0].name).toBe('default')
  })

  it('opens default archive and returns a PGlite instance', async () => {
    const db = await manager.open()
    expect(db).not.toBeNull()
    expect(manager.getDb()).toBe(db)
    expect(manager.getCurrentArchiveName()).toBe('default')
  })

  it('runs migrations on open — schema_version table exists', async () => {
    const db = await manager.open()
    const result = await db.query(
      "SELECT tablename FROM pg_tables WHERE tablename = 'schema_version'",
    )
    expect(result.rows).toHaveLength(1)
  })

  it('runs migrations on open — version is 5 after open', async () => {
    const db = await manager.open()
    const result = await db.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_version',
    )
    expect(result.rows[0].version).toBe(5)
  })

  it('opens a named archive', async () => {
    const db = await manager.open('work')
    expect(db).not.toBeNull()
    expect(manager.getCurrentArchiveName()).toBe('work')
  })

  it('switches between archives — each gets its own DB instance', async () => {
    const db1 = await manager.open('alpha')
    const db2 = await manager.open('beta')

    expect(db1).not.toBe(db2)
    expect(manager.getCurrentArchiveName()).toBe('beta')
    expect(manager.getDb()).toBe(db2)
  })

  it('closing previous DB when switching does not throw', async () => {
    await manager.open('first')
    await expect(manager.open('second')).resolves.not.toThrow()
  })

  it('lists all known archives after opening several', async () => {
    await manager.open()
    await manager.open('personal')
    await manager.open('work')

    const archives = manager.listArchives()
    const names = archives.map((a) => a.name)
    expect(names).toContain('default')
    expect(names).toContain('personal')
    expect(names).toContain('work')
    expect(archives).toHaveLength(3)
  })

  it('listArchives returns ArchiveInfo with name and createdAt', async () => {
    await manager.open()
    const archives = manager.listArchives()
    const defaultArchive = archives.find((a) => a.name === 'default')
    expect(defaultArchive).toBeDefined()
    expect(defaultArchive!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('create() adds archive to list and opens it', async () => {
    const db = await manager.create('newarchive')
    expect(db).not.toBeNull()
    const names = manager.listArchives().map((a) => a.name)
    expect(names).toContain('newarchive')
  })

  it('create() throws if archive already exists', async () => {
    await manager.create('duplicate')
    await expect(manager.create('duplicate')).rejects.toThrow("Archive 'duplicate' already exists")
  })

  it('create() throws if trying to create default archive twice', async () => {
    // default is pre-registered in constructor
    await expect(manager.create('default')).rejects.toThrow("Archive 'default' already exists")
  })

  it('switchTo() opens the named archive', async () => {
    await manager.open()
    await manager.create('other')
    await manager.switchTo('default')

    expect(manager.getCurrentArchiveName()).toBe('default')
  })

  it('cannot delete the default archive', async () => {
    await expect(manager.delete('default')).rejects.toThrow('Cannot delete the default archive')
  })

  it('delete() removes archive from list', async () => {
    await manager.create('temp')
    await manager.delete('temp')

    const names = manager.listArchives().map((a) => a.name)
    expect(names).not.toContain('temp')
  })

  it('delete() closes DB when deleting the current archive', async () => {
    await manager.open('active')
    expect(manager.getDb()).not.toBeNull()

    await manager.delete('active')
    expect(manager.getDb()).toBeNull()
  })

  it('delete() on non-current archive does not close DB', async () => {
    await manager.open('main')
    await manager.create('side')
    await manager.switchTo('main')

    const db = manager.getDb()
    await manager.delete('side')
    expect(manager.getDb()).toBe(db)
  })

  it('emits archive.switched event on open', async () => {
    const handler = vi.fn()
    events.on('archive.switched', handler)

    await manager.open('journal')

    expect(handler).toHaveBeenCalledWith({ name: 'journal' })
  })

  it('emits archive.switched event on switchTo', async () => {
    await manager.create('alpha')
    await manager.create('beta')

    const handler = vi.fn()
    events.on('archive.switched', handler)

    await manager.switchTo('alpha')

    expect(handler).toHaveBeenCalledWith({ name: 'alpha' })
  })

  it('does not emit archive.switched when no events bus provided', async () => {
    const managerNoEvents = new ArchiveManager('memory')
    try {
      await expect(managerNoEvents.open('standalone')).resolves.not.toThrow()
    } finally {
      await managerNoEvents.close()
    }
  })

  it('close() sets db to null', async () => {
    await manager.open()
    expect(manager.getDb()).not.toBeNull()

    await manager.close()
    expect(manager.getDb()).toBeNull()
  })

  it('close() is safe to call when no DB is open', async () => {
    await expect(manager.close()).resolves.not.toThrow()
    expect(manager.getDb()).toBeNull()
  })
})
