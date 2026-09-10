import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { currentGeometryEwkb, decodeWgs84Ewkb, encodeWgs84Geometry, type Wgs84Geometry } from '../../shard/native-geometry.js'

const little = '0101000020e6100000000000000000f03f0000000000000040'
const big = '0020000001000010e63ff00000000000004000000000000000'
const point = { type: 'Point' as const, coordinates: [1, 2] }
const polygon = { type: 'Polygon' as const, coordinates: [
  [[0, 0], [5, 0], [5, 5], [0, 0]],
  [[1, 1], [2, 1], [2, 2], [1, 1]],
] }

describe('native WGS84 geometry codec', () => {
  it('loads the unbundled Buffer shim with native Node ESM resolution', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const result = await build({ absWorkingDir: root, entryPoints: ['src/shard/geometry-buffer.ts'],
      bundle: false, write: false, platform: 'node', format: 'esm', target: 'es2022',
    })
    expect(execFileSync(process.execPath, ['--input-type=module'], {
      cwd: root,
      input: `${result.outputFiles[0].text}\nif (Buffer !== globalThis.Buffer) throw Error('Native Buffer replaced');\nprocess.stdout.write(Buffer.from([1, 2]).toString('hex'));`,
      encoding: 'utf8',
    })).toBe('0102')
  })

  it('reads both byte orders and preserves an unchanged source encoding', () => {
    expect(decodeWgs84Ewkb(little, 'Point')).toEqual(point)
    expect(decodeWgs84Ewkb(big, 'Point')).toEqual(point)
    expect(currentGeometryEwkb(big, point)).toBe(big)
    expect(currentGeometryEwkb(big, { type: 'Point', coordinates: [3, 4] })).not.toBe(big)
    expect(currentGeometryEwkb(big, null)).toBeNull()
    expect(currentGeometryEwkb(null, point)).toBe(little)
  })

  it.each<Wgs84Geometry>([point, polygon, { type: 'Point', coordinates: [] }, { type: 'Polygon', coordinates: [] }])(
    'round trips actual GeoJSON geometry %j', (geometry) => {
      expect(decodeWgs84Ewkb(encodeWgs84Geometry(geometry), geometry.type)).toEqual(geometry)
    },
  )

  it('accepts a 2D WKB record without an explicit SRID as WGS84', () => {
    const wkb = '0101000000000000000000f03f0000000000000040'
    expect(decodeWgs84Ewkb(wkb, 'Point')).toEqual(point)
    expect(currentGeometryEwkb(wkb, point)).toBe(wkb)
  })

  it.each(['', '0', 'zz', little.toUpperCase(), `02${little.slice(2)}`, `${little}00`, little.slice(0, -2),
    little.replace('e6100000', '110f0000'), '0101000080000000000000f03f00000000000000400000000000000840',
    '0101000040000000000000f03f00000000000000400000000000000840',
  ])('rejects invalid, truncated, extended or non-WGS84 EWKB %s', (hex) => {
    expect(() => decodeWgs84Ewkb(hex, 'Point')).toThrow()
  })

  it('rejects wrong geometry families and invalid coordinates', () => {
    expect(() => decodeWgs84Ewkb(little, 'Polygon')).toThrow('Expected WGS84 Polygon')
    expect(() => decodeWgs84Ewkb(encodeWgs84Geometry(polygon), 'Point')).toThrow('Expected WGS84 Point')
    for (const coordinates of [[181, 0], [0, 91], [1, NaN], [Infinity, 2], [1, 2, 3]]) {
      expect(() => encodeWgs84Geometry({ type: 'Point', coordinates })).toThrow()
    }
    expect(() => encodeWgs84Geometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2]]] })).toThrow()
    expect(() => encodeWgs84Geometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] } as unknown as Wgs84Geometry)).toThrow()
  })

  it('runs the bundled codec without Node Buffer, require or util globals', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const result = await build({ absWorkingDir: root, entryPoints: ['src/shard/native-geometry.ts'],
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'GeometryCodec', target: 'es2022',
      inject: ['src/shard/geometry-buffer.ts'], alias: { util: './src/shard/geometry-util.js' },
    })
    const context = { input: big, point, polygon }
    runInNewContext(`${result.outputFiles[0].text}
      if (typeof Buffer !== 'undefined' || typeof require !== 'undefined') throw Error('Node global leaked');
      globalThis.output = GeometryCodec.decodeWgs84Ewkb(input, 'Point');
      globalThis.preserved = GeometryCodec.currentGeometryEwkb(input, point);
      globalThis.boundary = GeometryCodec.decodeWgs84Ewkb(GeometryCodec.encodeWgs84Geometry(polygon), 'Polygon');`, context)
    expect(context).toMatchObject({ output: point, preserved: big, boundary: polygon })
  })
})
