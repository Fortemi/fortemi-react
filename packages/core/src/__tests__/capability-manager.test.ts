import { describe, it, expect, vi } from 'vitest'
import { TypedEventBus } from '../event-bus.js'
import { CapabilityManager } from '../capability-manager.js'

describe('CapabilityManager', () => {
  function setup() {
    const events = new TypedEventBus()
    const manager = new CapabilityManager(events)
    return { events, manager }
  }

  it('initializes all capabilities as unloaded', () => {
    const { manager } = setup()
    const all = manager.listAll()

    expect(all).toHaveLength(5)
    for (const cap of all) {
      expect(cap.state).toBe('unloaded')
    }
  })

  it('no WASM loaded on startup (CAP-001)', () => {
    const { manager } = setup()

    expect(manager.isReady('semantic')).toBe(false)
    expect(manager.isReady('llm')).toBe(false)
    expect(manager.isReady('audio')).toBe(false)
    expect(manager.isReady('vision')).toBe(false)
    expect(manager.isReady('pdf')).toBe(false)
  })

  it('enable transitions to ready', async () => {
    const { manager } = setup()

    await manager.enable('semantic')

    expect(manager.getState('semantic')).toBe('ready')
    expect(manager.isReady('semantic')).toBe(true)
  })

  it('disable transitions to disabled', async () => {
    const { manager } = setup()

    await manager.enable('semantic')
    manager.disable('semantic')

    expect(manager.getState('semantic')).toBe('disabled')
    expect(manager.isReady('semantic')).toBe(false)
  })

  it('emits capability.ready event on enable', async () => {
    const { events, manager } = setup()
    const handler = vi.fn()

    events.on('capability.ready', handler)
    await manager.enable('llm')

    expect(handler).toHaveBeenCalledWith({ name: 'llm' })
  })

  it('emits capability.disabled event on disable', async () => {
    const { events, manager } = setup()
    const handler = vi.fn()

    events.on('capability.disabled', handler)
    await manager.enable('pdf')
    manager.disable('pdf')

    expect(handler).toHaveBeenCalledWith({ name: 'pdf' })
  })

  it('emits capability.loading event during enable', async () => {
    const { events, manager } = setup()
    const handler = vi.fn()

    events.on('capability.loading', handler)
    await manager.enable('audio')

    expect(handler).toHaveBeenCalledWith({ name: 'audio' })
  })

  it('markError sets error state', () => {
    const { manager } = setup()

    manager.markError('vision', 'WebGPU not available')

    expect(manager.getState('vision')).toBe('error')
    expect(manager.getError('vision')).toBe('WebGPU not available')
  })

  it('markReady clears error and sets ready', () => {
    const { manager } = setup()

    manager.markError('vision', 'failed')
    manager.markReady('vision')

    expect(manager.getState('vision')).toBe('ready')
    expect(manager.getError('vision')).toBeUndefined()
  })

  it('enable is idempotent when already ready', async () => {
    const { events, manager } = setup()
    const handler = vi.fn()

    await manager.enable('semantic')
    events.on('capability.ready', handler)
    await manager.enable('semantic') // should not re-emit

    expect(handler).not.toHaveBeenCalled()
  })
})
