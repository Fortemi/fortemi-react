export const VERSION = '2026.3.0'

export { generateId } from './uuid.js'

export { TypedEventBus } from './event-bus.js'
export type { EventMap, IDisposable } from './event-bus.js'

export { createPGliteInstance } from './db.js'
export type { PersistenceMode } from './db.js'

export { CapabilityManager } from './capability-manager.js'
export type { CapabilityName, CapabilityState } from './capability-manager.js'

export { MigrationRunner } from './migration-runner.js'
export type { Migration } from './migration-runner.js'
export { allMigrations } from './migrations/index.js'

export { ArchiveManager } from './archive-manager.js'
export type { ArchiveInfo } from './archive-manager.js'

export { createFortemi } from './create-fortemi.js'
export type { FortemiCore, FortemiConfig } from './create-fortemi.js'

export { computeHash } from './hash.js'

export { registerServiceWorker } from './service-worker/register.js'
export type { SWRegistrationResult } from './service-worker/register.js'

export { createBlobStore, MemoryBlobStore } from './blob-store.js'
export type { BlobStore } from './blob-store.js'

export type { WorkerRequest, WorkerResponse } from './worker/protocol.js'
export { PGliteWorkerClient, TransactionProxy } from './worker/worker-client.js'

export { NotesRepository } from './repositories/notes-repository.js'
export { SearchRepository } from './repositories/search-repository.js'
export type {
  NoteSummary,
  NoteFull,
  NoteCreateInput,
  NoteUpdateInput,
  NoteListOptions,
  PaginatedResult,
  SearchResult,
  SearchResponse,
  SearchOptions,
} from './repositories/types.js'

export { JobQueueWorker, titleGenerationHandler } from './job-queue-worker.js'
export type { JobQueueOptions } from './job-queue-worker.js'

export { TagsRepository } from './repositories/tags-repository.js'
export { CollectionsRepository } from './repositories/collections-repository.js'
export type { CollectionRow, CollectionCreateInput } from './repositories/collections-repository.js'
export { LinksRepository } from './repositories/links-repository.js'
export type { LinkRow } from './repositories/links-repository.js'
export { SkosRepository } from './repositories/skos-repository.js'
export type { SkosScheme, SkosConcept, SkosRelation } from './repositories/skos-repository.js'
