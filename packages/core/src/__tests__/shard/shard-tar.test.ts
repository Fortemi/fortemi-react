import { describe, it, expect } from 'vitest'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'

describe('shard-tar', () => {
  it('round-trips a single file', () => {
    const files = new Map<string, Uint8Array>()
    const content = new TextEncoder().encode('hello world')
    files.set('test.txt', content)

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect(unpacked.size).toBe(1)
    expect(unpacked.has('test.txt')).toBe(true)
    expect(new TextDecoder().decode(unpacked.get('test.txt')!)).toBe('hello world')
  })

  it('round-trips multiple files', () => {
    const files = new Map<string, Uint8Array>()
    const encoder = new TextEncoder()
    files.set('manifest.json', encoder.encode('{"version":"1.0.0"}'))
    files.set('notes.jsonl', encoder.encode('{"id":"1"}\n{"id":"2"}'))
    files.set('collections.json', encoder.encode('[{"id":"c1"}]'))

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect(unpacked.size).toBe(3)
    expect(new TextDecoder().decode(unpacked.get('manifest.json')!)).toBe(
      '{"version":"1.0.0"}',
    )
    expect(new TextDecoder().decode(unpacked.get('notes.jsonl')!)).toBe(
      '{"id":"1"}\n{"id":"2"}',
    )
    expect(new TextDecoder().decode(unpacked.get('collections.json')!)).toBe(
      '[{"id":"c1"}]',
    )
  })

  it('handles empty files', () => {
    const files = new Map<string, Uint8Array>()
    files.set('empty.txt', new Uint8Array(0))

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect(unpacked.size).toBe(1)
    expect(unpacked.get('empty.txt')!.byteLength).toBe(0)
  })

  it('preserves binary data exactly', () => {
    const binary = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127])
    const files = new Map<string, Uint8Array>()
    files.set('binary.bin', binary)

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect(unpacked.get('binary.bin')).toEqual(binary)
  })

  it('handles large-ish files (>512 bytes)', () => {
    const data = new Uint8Array(2000)
    for (let i = 0; i < data.length; i++) data[i] = i % 256
    const files = new Map<string, Uint8Array>()
    files.set('large.dat', data)

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect(unpacked.get('large.dat')).toEqual(data)
  })

  it('produces compressed output smaller than raw tar for compressible data', () => {
    const files = new Map<string, Uint8Array>()
    // Highly compressible: 10KB of repeated text
    const repeated = new TextEncoder().encode('hello '.repeat(2000))
    files.set('compressible.txt', repeated)

    const packed = packTarGz(files)
    // gzip should compress repeated text significantly
    expect(packed.byteLength).toBeLessThan(repeated.byteLength)
  })

  it('round-trips an empty archive', () => {
    const files = new Map<string, Uint8Array>()
    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)
    expect(unpacked.size).toBe(0)
  })

  it('preserves filenames exactly', () => {
    const files = new Map<string, Uint8Array>()
    const encoder = new TextEncoder()
    files.set('embedding_set_members.jsonl', encoder.encode('data'))
    files.set('embedding_configs.json', encoder.encode('data2'))

    const packed = packTarGz(files)
    const unpacked = unpackTarGz(packed)

    expect([...unpacked.keys()].sort()).toEqual([
      'embedding_configs.json',
      'embedding_set_members.jsonl',
    ])
  })
})
