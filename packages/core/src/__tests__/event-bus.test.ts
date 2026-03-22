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
})
