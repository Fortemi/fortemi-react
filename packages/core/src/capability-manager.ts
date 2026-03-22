/**
 * Capability module system (ADR-002).
 * Tracks opt-in WASM module states. No WASM loaded by default (CAP-001).
 */

import type { TypedEventBus } from './event-bus.js'

export type CapabilityState = 'unloaded' | 'loading' | 'ready' | 'error' | 'disabled'

export type CapabilityName = 'semantic' | 'llm' | 'audio' | 'vision' | 'pdf'

interface CapabilityEntry {
  name: CapabilityName
  state: CapabilityState
  error?: string
}

export class CapabilityManager {
  private capabilities = new Map<CapabilityName, CapabilityEntry>()

  constructor(private events: TypedEventBus) {
    const names: CapabilityName[] = ['semantic', 'llm', 'audio', 'vision', 'pdf']
    for (const name of names) {
      this.capabilities.set(name, { name, state: 'unloaded' })
    }
  }

  getState(name: CapabilityName): CapabilityState {
    return this.capabilities.get(name)?.state ?? 'unloaded'
  }

  isReady(name: CapabilityName): boolean {
    return this.getState(name) === 'ready'
  }

  async enable(name: CapabilityName): Promise<void> {
    const entry = this.capabilities.get(name)
    if (!entry) return
    if (entry.state === 'ready' || entry.state === 'loading') return

    entry.state = 'loading'
    entry.error = undefined
    this.events.emit('capability.loading', { name })

    // Actual WASM loading would happen here via a loader registry.
    // For now, transition directly to ready (loaders registered separately).
    entry.state = 'ready'
    this.events.emit('capability.ready', { name })
  }

  disable(name: CapabilityName): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    entry.state = 'disabled'
    this.events.emit('capability.disabled', { name })
  }

  markError(name: CapabilityName, error: string): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    entry.state = 'error'
    entry.error = error
  }

  markReady(name: CapabilityName): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    entry.state = 'ready'
    entry.error = undefined
    this.events.emit('capability.ready', { name })
  }

  getError(name: CapabilityName): string | undefined {
    return this.capabilities.get(name)?.error
  }

  listAll(): Array<{ name: CapabilityName; state: CapabilityState }> {
    return Array.from(this.capabilities.values()).map(({ name, state }) => ({
      name,
      state,
    }))
  }
}
