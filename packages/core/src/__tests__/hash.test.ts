import { describe, it, expect } from 'vitest'
import { computeHash } from '../hash.js'

describe('computeHash', () => {
  it('returns a string prefixed with "sha256:"', () => {
    const result = computeHash(new Uint8Array([1, 2, 3]))
    expect(result).toMatch(/^sha256:/)
  })

  it('hex portion is exactly 64 characters (256 bits)', () => {
    const result = computeHash(new Uint8Array([1, 2, 3]))
    const hex = result.slice('sha256:'.length)
    expect(hex).toHaveLength(64)
  })

  it('is deterministic — same input produces same output', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50])
    expect(computeHash(data)).toBe(computeHash(data))
  })

  it('different inputs produce different hashes', () => {
    const a = computeHash(new Uint8Array([0]))
    const b = computeHash(new Uint8Array([1]))
    expect(a).not.toBe(b)
  })

  it('handles empty Uint8Array without throwing', () => {
    expect(() => computeHash(new Uint8Array())).not.toThrow()
  })

  it('empty Uint8Array returns expected SHA-256 value', () => {
    // SHA-256 of empty string is a well-known constant
    const emptyHash =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(computeHash(new Uint8Array())).toBe(`sha256:${emptyHash}`)
  })

  it('hex string contains only lowercase hex characters', () => {
    const result = computeHash(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    const hex = result.slice('sha256:'.length)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })
})
