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

  it('markError sets error state', async () => {
    const { manager } = setup()
    // Must be in loading state first (state machine requires loading -> error).
    // Register a loader that stays pending so we can call markError externally.
    let resolveLoader!: () => void
    const pending = new Promise<void>((res) => { resolveLoader = res })
    manager.registerLoader('vision', () => pending)
    const enablePromise = manager.enable('vision')

    manager.markError('vision', 'WebGPU not available')
    resolveLoader()
    await enablePromise

    expect(manager.getState('vision')).toBe('error')
    expect(manager.getError('vision')).toBe('WebGPU not available')
  })

  it('markReady clears error and sets ready', async () => {
    const { manager } = setup()
    // Must be in loading state first (state machine requires loading -> ready).
    let resolveLoader!: () => void
    const pending = new Promise<void>((res) => { resolveLoader = res })
    manager.registerLoader('vision', () => pending)
    const enablePromise = manager.enable('vision')

    manager.markReady('vision')
    resolveLoader()
    await enablePromise

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

  // --- State machine enforcement ---

  describe('state machine enforcement', () => {
    it('rejects disable from unloaded state', () => {
      const { manager } = setup()

      expect(() => manager.disable('semantic')).toThrow()
    })

    it('rejects disable from loading state', async () => {
      const { manager } = setup()
      // Register a loader that stays pending so we can observe loading state
      let resolve!: () => void
      const pending = new Promise<void>((res) => { resolve = res })
      manager.registerLoader('llm', () => pending)

      const enablePromise = manager.enable('llm')
      // State is now 'loading'
      expect(manager.getState('llm')).toBe('loading')
      expect(() => manager.disable('llm')).toThrow()

      resolve()
      await enablePromise
    })

    it('rejects markReady from unloaded state', () => {
      const { manager } = setup()

      expect(() => manager.markReady('semantic')).toThrow()
    })

    it('rejects markReady from disabled state', async () => {
      const { manager } = setup()
      await manager.enable('semantic')
      manager.disable('semantic')

      expect(() => manager.markReady('semantic')).toThrow()
    })

    it('rejects markError from unloaded state', () => {
      const { manager } = setup()

      expect(() => manager.markError('semantic', 'boom')).toThrow()
    })

    it('rejects markError from disabled state', async () => {
      const { manager } = setup()
      await manager.enable('semantic')
      manager.disable('semantic')

      expect(() => manager.markError('semantic', 'boom')).toThrow()
    })

    it('allows enable from disabled state (re-enable)', async () => {
      const { manager } = setup()

      await manager.enable('semantic')
      manager.disable('semantic')
      await manager.enable('semantic')

      expect(manager.getState('semantic')).toBe('ready')
    })
  })

  // --- Loader registry ---

  describe('loader registry', () => {
    it('runs registered loader on enable', async () => {
      const { manager } = setup()
      const loader = vi.fn().mockResolvedValue(undefined)

      manager.registerLoader('semantic', loader)
      await manager.enable('semantic')

      expect(loader).toHaveBeenCalledOnce()
      expect(manager.getState('semantic')).toBe('ready')
    })

    it('transitions to ready after successful loader', async () => {
      const { events, manager } = setup()
      const readyHandler = vi.fn()
      events.on('capability.ready', readyHandler)

      manager.registerLoader('llm', async () => {
        // simulate async work
        await Promise.resolve()
      })
      await manager.enable('llm')

      expect(manager.isReady('llm')).toBe(true)
      expect(readyHandler).toHaveBeenCalledWith({ name: 'llm' })
    })

    it('transitions to error when loader throws', async () => {
      const { manager } = setup()
      manager.registerLoader('pdf', async () => {
        throw new Error('PDF WASM unavailable')
      })

      await manager.enable('pdf')

      expect(manager.getState('pdf')).toBe('error')
      expect(manager.getError('pdf')).toBe('PDF WASM unavailable')
    })

    it('transitions to error when loader rejects with non-Error', async () => {
      const { manager } = setup()
      manager.registerLoader('audio', async () => {
        throw 'string error' // intentional non-Error throw for coverage
      })

      await manager.enable('audio')

      expect(manager.getState('audio')).toBe('error')
      expect(manager.getError('audio')).toBe('string error')
    })

    it('does not run loader on second enable when already ready', async () => {
      const { manager } = setup()
      const loader = vi.fn().mockResolvedValue(undefined)

      manager.registerLoader('semantic', loader)
      await manager.enable('semantic')
      await manager.enable('semantic') // idempotent

      expect(loader).toHaveBeenCalledOnce()
    })
  })

  // --- Error recovery / retry ---

  describe('error recovery', () => {
    it('retries from error state via enable', async () => {
      const { manager } = setup()
      let attempts = 0
      manager.registerLoader('vision', async () => {
        attempts++
        if (attempts === 1) throw new Error('first attempt failed')
        // second attempt succeeds
      })

      await manager.enable('vision') // first attempt -> error
      expect(manager.getState('vision')).toBe('error')

      await manager.enable('vision') // retry -> ready
      expect(manager.getState('vision')).toBe('ready')
      expect(attempts).toBe(2)
    })

    it('emits capability.loading on retry', async () => {
      const { events, manager } = setup()
      const loadingHandler = vi.fn()
      manager.registerLoader('semantic', async () => {
        throw new Error('fail')
      })

      await manager.enable('semantic') // -> error
      events.on('capability.loading', loadingHandler)
      manager.registerLoader('semantic', async () => { /* success */ })
      await manager.enable('semantic') // retry

      expect(loadingHandler).toHaveBeenCalledWith({ name: 'semantic' })
    })
  })

  // --- Progress reporting ---

  describe('progress reporting', () => {
    it('reportProgress emits capability.loading with progress', async () => {
      const { events, manager } = setup()
      const loadingHandler = vi.fn()
      events.on('capability.loading', loadingHandler)

      let resolveLoader!: () => void
      const pending = new Promise<void>((res) => { resolveLoader = res })
      manager.registerLoader('llm', async () => {
        manager.reportProgress('llm', 50)
        await pending
      })

      const enablePromise = manager.enable('llm')
      resolveLoader()
      await enablePromise

      expect(loadingHandler).toHaveBeenCalledWith({ name: 'llm', progress: 50 })
    })

    it('reportProgress does nothing when capability is not loading', () => {
      const { events, manager } = setup()
      const loadingHandler = vi.fn()
      events.on('capability.loading', loadingHandler)

      // No enable called -- state is unloaded
      manager.reportProgress('semantic', 50)

      // Loading event should NOT have been emitted from reportProgress
      expect(loadingHandler).not.toHaveBeenCalled()
    })

    it('reportProgress emits multiple progress updates', async () => {
      const { events, manager } = setup()
      const progressValues: number[] = []
      events.on('capability.loading', (payload) => {
        if (payload.progress !== undefined) {
          progressValues.push(payload.progress)
        }
      })

      let resolveLoader!: () => void
      const pending = new Promise<void>((res) => { resolveLoader = res })
      manager.registerLoader('pdf', async () => {
        manager.reportProgress('pdf', 25)
        manager.reportProgress('pdf', 75)
        manager.reportProgress('pdf', 100)
        await pending
      })

      const enablePromise = manager.enable('pdf')
      resolveLoader()
      await enablePromise

      expect(progressValues).toEqual([25, 75, 100])
    })
  })
})
