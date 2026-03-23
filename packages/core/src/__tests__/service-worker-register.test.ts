import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the navigator.serviceWorker API
function makeSwMock(
  opts: {
    installing?: boolean
    activatedImmediately?: boolean
    rejectWith?: Error
  } = {},
) {
  const { installing = false, activatedImmediately = true, rejectWith } = opts

  if (rejectWith) {
    return {
      register: vi.fn().mockRejectedValue(rejectWith),
    }
  }

  let installingWorker: {
    state: ServiceWorkerState
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  } | null = null

  if (installing) {
    installingWorker = {
      state: 'installing' as ServiceWorkerState,
      addEventListener: vi.fn(
        (_event: string, handler: EventListenerOrEventListenerObject) => {
          // Simulate statechange to 'activated' on next microtask
          if (activatedImmediately) {
            Promise.resolve().then(() => {
              installingWorker!.state = 'activated' as ServiceWorkerState
              if (typeof handler === 'function') {
                handler.call(installingWorker, new Event('statechange'))
              }
            })
          }
        },
      ),
      removeEventListener: vi.fn(),
    }
  }

  const registration: Partial<ServiceWorkerRegistration> = {
    installing: installingWorker as ServiceWorker | null,
  }

  return {
    register: vi.fn().mockResolvedValue(registration as ServiceWorkerRegistration),
  }
}

describe('registerServiceWorker', () => {
  let originalNavigator: Navigator

  beforeEach(() => {
    originalNavigator = globalThis.navigator
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
    vi.resetModules()
  })

  function setNavigatorSwSupport(mock: ReturnType<typeof makeSwMock> | null) {
    const descriptor: PropertyDescriptor = {
      writable: true,
      configurable: true,
      value: mock === null ? {} : { serviceWorker: mock },
    }
    Object.defineProperty(globalThis, 'navigator', descriptor)
  }

  it('returns registered:false when serviceWorker not in navigator', async () => {
    setNavigatorSwSupport(null)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    const result = await registerServiceWorker()

    expect(result.registered).toBe(false)
    expect(result.error).toBe('Service Workers not supported')
    expect(result.registration).toBeUndefined()
  })

  it('calls navigator.serviceWorker.register with correct URL and options', async () => {
    const mock = makeSwMock()
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    await registerServiceWorker('/sw.js')

    expect(mock.register).toHaveBeenCalledOnce()
    expect(mock.register).toHaveBeenCalledWith('/sw.js', {
      type: 'module',
      scope: '/',
    })
  })

  it('uses /sw.js as default URL when none provided', async () => {
    const mock = makeSwMock()
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    await registerServiceWorker()

    expect(mock.register).toHaveBeenCalledWith('/sw.js', expect.any(Object))
  })

  it('returns registered:true and registration on success (already active)', async () => {
    const mock = makeSwMock({ installing: false })
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    const result = await registerServiceWorker('/sw.js')

    expect(result.registered).toBe(true)
    expect(result.registration).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('waits for installing SW to activate before resolving', async () => {
    const mock = makeSwMock({ installing: true, activatedImmediately: true })
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    const result = await registerServiceWorker('/sw.js')

    expect(result.registered).toBe(true)
    expect(result.registration).toBeDefined()
  })

  it('returns registered:false with error message on registration failure', async () => {
    const mock = makeSwMock({ rejectWith: new Error('HTTPS required') })
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    const result = await registerServiceWorker('/sw.js')

    expect(result.registered).toBe(false)
    expect(result.error).toBe('HTTPS required')
    expect(result.registration).toBeUndefined()
  })

  it('handles non-Error rejection values', async () => {
    const mock = {
      register: vi.fn().mockRejectedValue('string error'),
    }
    setNavigatorSwSupport(mock)

    const { registerServiceWorker } = await import('../service-worker/register.js')
    const result = await registerServiceWorker('/sw.js')

    expect(result.registered).toBe(false)
    expect(result.error).toBe('string error')
  })
})
