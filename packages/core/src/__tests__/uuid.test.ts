import { describe, it, expect } from 'vitest'
import { generateId } from '../uuid.js'

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateId', () => {
  it('returns a string in UUIDv7 format', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
    expect(id).toMatch(UUID_V7_REGEX)
  })

  it('has version nibble 7', () => {
    const id = generateId()
    // The version nibble is the 13th character (index 14, after 3 hyphens at positions 8, 13, 18)
    // Format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    // Position:          [13] is '7'
    expect(id[14]).toBe('7')
  })

  it('generates unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()))
    expect(ids.size).toBe(20)
  })

  it('is time-sortable (lexicographic order matches creation order)', () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      ids.push(generateId())
    }
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
  })

  it('is monotonic within the same millisecond (100 IDs in tight loop remain sorted)', () => {
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      ids.push(generateId())
    }
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
  })
})
