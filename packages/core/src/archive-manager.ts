/**
 * Multi-archive manager for Fortemi.
 * Each archive is a separate PGlite instance with its own persistence path.
 * Migrations are applied automatically on open.
 */

import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance, type PersistenceMode } from './db.js'
import { MigrationRunner } from './migration-runner.js'
import { allMigrations } from './migrations/index.js'
import type { TypedEventBus } from './event-bus.js'

export interface ArchiveInfo {
  name: string
  createdAt: string // ISO 8601
}

export class ArchiveManager {
  private currentArchive: string = 'default'
  private db: PGlite | null = null
  private archives = new Map<string, ArchiveInfo>()

  constructor(
    private persistence: PersistenceMode,
    private events?: TypedEventBus,
  ) {
    // Default archive always exists
    this.archives.set('default', {
      name: 'default',
      createdAt: new Date().toISOString(),
    })
  }

  getCurrentArchiveName(): string {
    return this.currentArchive
  }

  getDb(): PGlite | null {
    return this.db
  }

  async open(archiveName: string = 'default'): Promise<PGlite> {
    if (this.db) {
      await this.db.close()
    }

    this.db = await createPGliteInstance(this.persistence, archiveName)

    // Run migrations
    const runner = new MigrationRunner(this.db, this.events)
    await runner.apply(allMigrations)

    this.currentArchive = archiveName

    if (!this.archives.has(archiveName)) {
      this.archives.set(archiveName, {
        name: archiveName,
        createdAt: new Date().toISOString(),
      })
    }

    this.events?.emit('archive.switched', { name: archiveName })

    return this.db
  }

  async create(archiveName: string): Promise<PGlite> {
    if (this.archives.has(archiveName)) {
      throw new Error(`Archive '${archiveName}' already exists`)
    }
    return this.open(archiveName)
  }

  async switchTo(archiveName: string): Promise<PGlite> {
    return this.open(archiveName)
  }

  async delete(archiveName: string): Promise<void> {
    if (archiveName === 'default') {
      throw new Error('Cannot delete the default archive')
    }
    if (this.currentArchive === archiveName && this.db) {
      await this.db.close()
      this.db = null
    }
    this.archives.delete(archiveName)
    // Note: actual OPFS/IDB data cleanup would require browser APIs
    // For now, we just remove from our registry
  }

  listArchives(): ArchiveInfo[] {
    return Array.from(this.archives.values())
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
    }
  }
}
