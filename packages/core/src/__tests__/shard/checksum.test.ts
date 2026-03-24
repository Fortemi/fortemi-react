import { describe, it, expect } from 'vitest'
import { sha256Hex, validateChecksums } from '../../shard/checksum.js'

describe('sha256Hex', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hash = await sha256Hex(new Uint8Array([1, 2, 3]))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches known SHA-256 of empty input', async () => {
    const hash = await sha256Hex(new Uint8Array(0))
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches known SHA-256 of "hello"', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha256Hex(data)
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('is deterministic', async () => {
    const data = new Uint8Array([10, 20, 30])
    const h1 = await sha256Hex(data)
    const h2 = await sha256Hex(data)
    expect(h1).toBe(h2)
  })

  it('different inputs produce different hashes', async () => {
    const a = await sha256Hex(new Uint8Array([0]))
    const b = await sha256Hex(new Uint8Array([1]))
    expect(a).not.toBe(b)
  })
})

describe('validateChecksums', () => {
  it('passes when all checksums match', async () => {
    const data = new TextEncoder().encode('hello')
    const hash = await sha256Hex(data)
    const files = new Map([['test.txt', data]])
    const checksums = { 'test.txt': hash }

    const result = await validateChecksums(checksums, files)
    expect(result.valid).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails when a checksum does not match', async () => {
    const data = new TextEncoder().encode('hello')
    const files = new Map([['test.txt', data]])
    const checksums = { 'test.txt': 'deadbeef'.repeat(8) }

    const result = await validateChecksums(checksums, files)
    expect(result.valid).toBe(false)
    expect(result.failures).toContain('test.txt')
  })

  it('fails when a file is missing', async () => {
    const files = new Map<string, Uint8Array>()
    const checksums = { 'missing.txt': 'abc123'.padEnd(64, '0') }

    const result = await validateChecksums(checksums, files)
    expect(result.valid).toBe(false)
    expect(result.failures).toContain('missing.txt')
  })

  it('validates multiple files independently', async () => {
    const encoder = new TextEncoder()
    const good = encoder.encode('good')
    const bad = encoder.encode('bad')
    const goodHash = await sha256Hex(good)

    const files = new Map([
      ['good.txt', good],
      ['bad.txt', bad],
    ])
    const checksums = {
      'good.txt': goodHash,
      'bad.txt': 'wrong'.padEnd(64, '0'),
    }

    const result = await validateChecksums(checksums, files)
    expect(result.valid).toBe(false)
    expect(result.failures).toEqual(['bad.txt'])
  })

  it('passes with empty checksums map', async () => {
    const result = await validateChecksums({}, new Map())
    expect(result.valid).toBe(true)
    expect(result.failures).toEqual([])
  })
})
