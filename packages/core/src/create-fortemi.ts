/**
 * Factory function for creating a FortemiCore instance.
 * All deployment modes use this entry point.
 */

import { TypedEventBus } from './event-bus.js'

export interface FortemiConfig {
  persistence: 'opfs' | 'idb' | 'memory'
  archiveName?: string
}

export interface FortemiCore {
  events: TypedEventBus
  config: FortemiConfig
  destroy(): void
}

export function createFortemi(config: FortemiConfig): FortemiCore {
  const events = new TypedEventBus()

  return {
    events,
    config,
    destroy() {
      events.removeAllListeners()
    },
  }
}
