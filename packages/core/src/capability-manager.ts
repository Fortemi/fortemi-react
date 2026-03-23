/**
 * Capability module system (ADR-002).
 * Tracks opt-in WASM module states. No WASM loaded by default (CAP-001).
 *
 * State machine (valid transitions):
 *   unloaded  -> loading  (via enable)
 *   loading   -> ready    (via markReady or successful loader)
 *   loading   -> error    (via markError or failed loader)
 *   ready     -> disabled (via disable)
 *   disabled  -> loading  (via enable, re-enable)
 *   error     -> loading  (via enable, retry)
 */

import type { TypedEventBus } from './event-bus.js'

export type CapabilityState = 'unloaded' | 'loading' | 'ready' | 'error' | 'disabled'

export type CapabilityName = 'semantic' | 'llm' | 'audio' | 'vision' | 'pdf'

interface CapabilityEntry {
  name: CapabilityName
  state: CapabilityState
  error?: string
}

/** Valid source states that allow the given transition. */
const VALID_TRANSITIONS: Record<string, CapabilityState[]> = {
  enable: ['unloaded', 'disabled', 'error'],
  disable: ['ready'],
  markReady: ['loading'],
  markError: ['loading'],
}

function assertTransition(
  method: string,
  name: CapabilityName,
  current: CapabilityState,
): void {
  const allowed = VALID_TRANSITIONS[method]
  if (!allowed.includes(current)) {
    throw new Error(
      `CapabilityManager.${method}('${name}'): invalid transition from state '${current}'. ` +
        `Allowed source states: ${allowed.join(', ')}.`,
    )
  }
}

export class CapabilityManager {
  private capabilities = new Map<CapabilityName, CapabilityEntry>()
  private loaders = new Map<CapabilityName, () => Promise<void>>()

  constructor(private events: TypedEventBus) {
    const names: CapabilityName[] = ['semantic', 'llm', 'audio', 'vision', 'pdf']
    for (const name of names) {
      this.capabilities.set(name, { name, state: 'unloaded' })
    }
  }

  /**
   * Register an async loader for a capability.
   * Called by enable(); if no loader is registered the capability transitions
   * directly to ready (useful for capabilities that require no async init).
   */
  registerLoader(name: CapabilityName, loader: () => Promise<void>): void {
    this.loaders.set(name, loader)
  }

  getState(name: CapabilityName): CapabilityState {
    return this.capabilities.get(name)?.state ?? 'unloaded'
  }

  isReady(name: CapabilityName): boolean {
    return this.getState(name) === 'ready'
  }

  /**
   * Enable a capability.
   * Valid from: unloaded, disabled, error (retry).
   * Runs the registered loader if present; transitions to ready on success,
   * error on failure.
   */
  async enable(name: CapabilityName): Promise<void> {
    const entry = this.capabilities.get(name)
    if (!entry) return

    // Idempotent: already loading or ready -- do nothing.
    if (entry.state === 'ready' || entry.state === 'loading') return

    assertTransition('enable', name, entry.state)

    entry.state = 'loading'
    entry.error = undefined
    this.events.emit('capability.loading', { name })

    const loader = this.loaders.get(name)
    if (!loader) {
      // No loader registered -- transition directly to ready.
      entry.state = 'ready'
      this.events.emit('capability.ready', { name })
      return
    }

    try {
      await loader()
      // Only transition if still in loading -- external markReady/markError
      // (e.g. bridge protocol) may have already advanced state.
      if (entry.state === 'loading') {
        entry.state = 'ready'
        this.events.emit('capability.ready', { name })
      }
    } catch (err) {
      if (entry.state === 'loading') {
        const message = err instanceof Error ? err.message : String(err)
        entry.state = 'error'
        entry.error = message
      }
    }
  }

  /**
   * Disable a ready capability.
   * Valid from: ready only.
   */
  disable(name: CapabilityName): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    assertTransition('disable', name, entry.state)

    entry.state = 'disabled'
    this.events.emit('capability.disabled', { name })
  }

  /**
   * Mark a loading capability as ready (external use, e.g. bridge protocol).
   * Valid from: loading only.
   */
  markReady(name: CapabilityName): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    assertTransition('markReady', name, entry.state)

    entry.state = 'ready'
    entry.error = undefined
    this.events.emit('capability.ready', { name })
  }

  /**
   * Mark a loading capability as errored (external use, e.g. bridge protocol).
   * Valid from: loading only.
   */
  markError(name: CapabilityName, error: string): void {
    const entry = this.capabilities.get(name)
    if (!entry) return

    assertTransition('markError', name, entry.state)

    entry.state = 'error'
    entry.error = error
  }

  /**
   * Report loading progress (0-100).
   * Emits capability.loading with progress if the capability is currently loading.
   * No-op if the capability is not in loading state.
   */
  reportProgress(name: CapabilityName, progress: number): void {
    const entry = this.capabilities.get(name)
    if (!entry || entry.state !== 'loading') return

    this.events.emit('capability.loading', { name, progress })
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
