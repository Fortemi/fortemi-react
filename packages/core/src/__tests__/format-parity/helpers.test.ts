import { describe, it, expect } from 'vitest'
import { getRowShape, matchServerShape } from './helpers.js'

describe('Format parity helpers', () => {
  it('getRowShape extracts types', () => {
    const shape = getRowShape({ id: 'abc', count: 42, active: true, meta: null })
    expect(shape).toEqual({ id: 'string', count: 'number', active: 'boolean', meta: 'null' })
  })

  it('matchServerShape detects missing fields', () => {
    const result = matchServerShape(
      { id: 'abc' },
      { id: 'abc', name: 'test' },
    )
    expect(result.pass).toBe(false)
    expect(result.missing).toEqual(['name'])
  })

  it('matchServerShape detects extra fields', () => {
    const result = matchServerShape(
      { id: 'abc', extra: 'field' },
      { id: 'abc' },
    )
    expect(result.pass).toBe(false)
    expect(result.extra).toEqual(['extra'])
  })

  it('matchServerShape detects type mismatches', () => {
    const result = matchServerShape(
      { id: 'abc', count: 'not-a-number' },
      { id: 'abc', count: 42 },
    )
    expect(result.pass).toBe(false)
    expect(result.typeMismatch).toEqual([{ field: 'count', expected: 'number', actual: 'string' }])
  })

  it('matchServerShape passes on matching shapes', () => {
    const result = matchServerShape(
      { id: 'abc', name: 'test' },
      { id: 'def', name: 'other' },
    )
    expect(result.pass).toBe(true)
  })

  it('matchServerShape allows null in either direction', () => {
    const result = matchServerShape(
      { id: 'abc', deleted_at: null },
      { id: 'def', deleted_at: '2026-01-01' },
    )
    expect(result.pass).toBe(true)
  })

  it('getRowShape treats Date objects as string (PGlite TIMESTAMPTZ compat)', () => {
    const shape = getRowShape({ created_at: new Date('2026-03-22T10:00:00.000Z') })
    expect(shape).toEqual({ created_at: 'string' })
  })

  it('matchServerShape accepts Date from PGlite where server returns ISO string', () => {
    const result = matchServerShape(
      { id: 'abc', created_at: new Date('2026-03-22T10:00:00.000Z') },
      { id: 'abc', created_at: '2026-03-22T10:00:00.000Z' },
    )
    expect(result.pass).toBe(true)
    expect(result.typeMismatch).toEqual([])
  })
})
