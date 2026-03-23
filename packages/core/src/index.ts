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
