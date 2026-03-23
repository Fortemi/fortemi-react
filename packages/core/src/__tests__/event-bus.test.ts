import { describe, it, expect, vi } from 'vitest'
import { TypedEventBus } from '../event-bus.js'

describe('TypedEventBus', () => {
  it('emits events to subscribers', () => {
    const bus = new TypedEventBus()
    const handler = vi.fn()

    bus.on('note.created', handler)
    bus.emit('note.created', { id: '019-abc' })

    expect(handler).toHaveBeenCalledWith({ id: '019-abc' })
  })

  it('supports multiple subscribers for same event', () => {
    const bus = new TypedEventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    bus.on('note.created', h1)
    bus.on('note.created', h2)
    bus.emit('note.created', { id: '019-abc' })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('disposes subscriptions via IDisposable', () => {
    const bus = new TypedEventBus()
    const handler = vi.fn()

    const sub = bus.on('note.created', handler)
    sub.dispose()
    bus.emit('note.created', { id: '019-abc' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not affect other subscribers when one disposes', () => {
    const bus = new TypedEventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()

    const sub1 = bus.on('note.created', h1)
    bus.on('note.created', h2)

    sub1.dispose()
    bus.emit('note.created', { id: '019-abc' })

    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('handles emit with no subscribers gracefully', () => {
    const bus = new TypedEventBus()
    expect(() => bus.emit('note.created', { id: '019-abc' })).not.toThrow()
  })

  it('supports different event types independently', () => {
    const bus = new TypedEventBus()
    const noteHandler = vi.fn()
    const capHandler = vi.fn()

    bus.on('note.created', noteHandler)
    bus.on('capability.ready', capHandler)

    bus.emit('note.created', { id: '019-abc' })

    expect(noteHandler).toHaveBeenCalledOnce()
    expect(capHandler).not.toHaveBeenCalled()
  })

  it('removeAllListeners clears everything', () => {
    const bus = new TypedEventBus()
    const handler = vi.fn()

    bus.on('note.created', handler)
    bus.on('note.updated', handler)
    bus.removeAllListeners()

    bus.emit('note.created', { id: '019-abc' })
    bus.emit('note.updated', { id: '019-abc' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('dispose is safe to call multiple times', () => {
    const bus = new TypedEventBus()
    const handler = vi.fn()

    const sub = bus.on('note.created', handler)
    sub.dispose()
    sub.dispose() // second dispose should not throw

    bus.emit('note.created', { id: '019-abc' })
    expect(handler).not.toHaveBeenCalled()
  })

  describe('wildcard subscriptions', () => {
    it('fires wildcard handler for matching events', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      bus.on('note.*', handler)
      bus.emit('note.created', { id: '123' })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ id: '123' })
    })

    it('fires both exact and wildcard handlers for the same event', () => {
      const bus = new TypedEventBus()
      const exactHandler = vi.fn()
      const wildcardHandler = vi.fn()

      bus.on('note.created', exactHandler)
      bus.on('note.*', wildcardHandler)
      bus.emit('note.created', { id: '123' })

      expect(exactHandler).toHaveBeenCalledOnce()
      expect(wildcardHandler).toHaveBeenCalledOnce()
    })

    it('does not fire wildcard handler for non-matching events', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      bus.on('note.*', handler)
      bus.emit('capability.ready', { name: 'search' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('fires wildcard for multiple matching events', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      bus.on('note.*', handler)
      bus.emit('note.created', { id: '1' })
      bus.emit('note.updated', { id: '2' })
      bus.emit('note.deleted', { id: '3' })

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('wildcard subscription is disposable', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      const sub = bus.on('note.*', handler)
      sub.dispose()
      bus.emit('note.created', { id: '123' })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('once()', () => {
    it('fires exactly once and auto-disposes', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      bus.once('note.created', handler)
      bus.emit('note.created', { id: '1' })
      bus.emit('note.created', { id: '2' })

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith({ id: '1' })
    })

    it('returns an IDisposable that can cancel before first emit', () => {
      const bus = new TypedEventBus()
      const handler = vi.fn()

      const sub = bus.once('note.created', handler)
      sub.dispose()
      bus.emit('note.created', { id: '1' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('once does not affect other subscribers', () => {
      const bus = new TypedEventBus()
      const onceHandler = vi.fn()
      const permanentHandler = vi.fn()

      bus.once('note.created', onceHandler)
      bus.on('note.created', permanentHandler)
      bus.emit('note.created', { id: '1' })
      bus.emit('note.created', { id: '2' })

      expect(onceHandler).toHaveBeenCalledOnce()
      expect(permanentHandler).toHaveBeenCalledTimes(2)
    })
  })

  describe('bridge()', () => {
    it('returns an IDisposable', () => {
      const bus = new TypedEventBus()
      const port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      const disposable = bus.bridge(port as unknown as MessagePort)

      expect(disposable).toBeDefined()
      expect(typeof disposable.dispose).toBe('function')
    })

    it('forwards locally emitted events to the port', () => {
      const bus = new TypedEventBus()
      const port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      bus.bridge(port as unknown as MessagePort)
      bus.emit('note.created', { id: '42' })

      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'event',
        event: 'note.created',
        payload: { id: '42' },
      })
    })

    it('re-emits incoming port messages locally', () => {
      const bus = new TypedEventBus()
      const localHandler = vi.fn()
      let messageListener: ((e: MessageEvent) => void) | undefined
      const port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn((type: string, listener: (e: MessageEvent) => void) => {
          if (type === 'message') messageListener = listener
        }),
        removeEventListener: vi.fn(),
      }

      bus.on('note.created', localHandler)
      bus.bridge(port as unknown as MessagePort)

      // simulate incoming message from port
      messageListener!({ data: { type: 'event', event: 'note.created', payload: { id: '99' } } } as MessageEvent)

      expect(localHandler).toHaveBeenCalledWith({ id: '99' })
    })

    it('stops forwarding after dispose', () => {
      const bus = new TypedEventBus()
      const port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      const sub = bus.bridge(port as unknown as MessagePort)
      sub.dispose()
      bus.emit('note.created', { id: '1' })

      expect(port.postMessage).not.toHaveBeenCalled()
    })

    it('calls removeEventListener on dispose', () => {
      const bus = new TypedEventBus()
      const port = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }

      const sub = bus.bridge(port as unknown as MessagePort)
      sub.dispose()

      expect(port.removeEventListener).toHaveBeenCalled()
    })
  })
})
