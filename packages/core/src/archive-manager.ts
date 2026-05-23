/**
 * Multi-archive manager for Fortemi.
 * Each archive is a separate PGlite instance with its own persistence path.
 * Migrations are applied automatically on open.
 */

import type { PersistenceMode } from './db.js'
import { MigrationRunner } from './migration-runner.js'
import { allMigrations } from './migrations/index.js'
import type { TypedEventBus } from './event-bus.js'
import { defaultStorageBackendFactory, type StorageBackend, type StorageBackendFactory } from './storage-backend.js'

export interface ArchiveInfo {
  name: string
  createdAt: string // ISO 8601
}

export class ArchiveManager {
  private currentArchive: string = 'default'
  private db: StorageBackend | null = null
  private archives = new Map<string, ArchiveInfo>()
  private persistence: PersistenceMode
  private backendFactory: StorageBackendFactory

  constructor(
    persistenceOrFactory: PersistenceMode | StorageBackendFactory,
    private events?: TypedEventBus,
  ) {
    if (typeof persistenceOrFactory === 'string') {
      this.persistence = persistenceOrFactory
      this.backendFactory = defaultStorageBackendFactory
    } else {
      this.persistence = 'memory'
      this.backendFactory = persistenceOrFactory
    }

    // Default archive always exists
    this.archives.set('default', {
      name: 'default',
      createdAt: new Date().toISOString(),
    })
  }

  getCurrentArchiveName(): string {
    return this.currentArchive
  }

  getDb(): StorageBackend | null {
    return this.db
  }

  async open(archiveName: string = 'default'): Promise<StorageBackend> {
    if (this.db) {
      await this.db.close()
    }

    this.db = await this.backendFactory.open({
      archiveName,
      persistence: this.persistence,
    })

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

  async create(archiveName: string): Promise<StorageBackend> {
    if (this.archives.has(archiveName)) {
      throw new Error(`Archive '${archiveName}' already exists`)
    }
    return this.open(archiveName)
  }

  async switchTo(archiveName: string): Promise<StorageBackend> {
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
