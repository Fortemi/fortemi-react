export const VERSION = '2026.3.0'

export { TypedEventBus } from './event-bus.js'
export type { EventMap, IDisposable } from './event-bus.js'

export { createPGliteInstance } from './db.js'
export type { PersistenceMode } from './db.js'

export { CapabilityManager } from './capability-manager.js'
export type { CapabilityName, CapabilityState } from './capability-manager.js'

export { MigrationRunner } from './migration-runner.js'
export type { Migration } from './migration-runner.js'
export { allMigrations } from './migrations/index.js'

export { createFortemi } from './create-fortemi.js'
export type { FortemiCore, FortemiConfig } from './create-fortemi.js'
