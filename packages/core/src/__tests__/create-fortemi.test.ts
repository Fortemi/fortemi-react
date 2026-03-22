import { describe, it, expect } from 'vitest'
import { createFortemi } from '../create-fortemi.js'

describe('createFortemi', () => {
  it('creates a FortemiCore instance with in-memory config', () => {
    const core = createFortemi({ persistence: 'memory' })

    expect(core.config.persistence).toBe('memory')
    expect(core.events).toBeDefined()
    expect(typeof core.destroy).toBe('function')
  })

  it('destroy clears event listeners', () => {
    const core = createFortemi({ persistence: 'memory' })
    let called = false
    core.events.on('note.created', () => { called = true })

    core.destroy()
    core.events.emit('note.created', { id: '019-abc' })

    expect(called).toBe(false)
  })
})
