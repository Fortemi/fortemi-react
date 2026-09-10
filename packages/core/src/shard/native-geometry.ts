import { Geometry, Point, Polygon } from 'wkx'
import { Buffer } from './geometry-buffer.js'

export type Wgs84Point = { type: 'Point'; coordinates: number[] }
export type Wgs84Polygon = { type: 'Polygon'; coordinates: number[][][] }
export type Wgs84Geometry = Wgs84Point | Wgs84Polygon

function checkGeometry(geometry: Geometry, type: Wgs84Geometry['type']): Wgs84Geometry {
  if ((type === 'Point' && !(geometry instanceof Point)) || (type === 'Polygon' && !(geometry instanceof Polygon))) {
    throw new Error(`Expected WGS84 ${type}`)
  }
  if ((geometry.srid !== undefined && geometry.srid !== 4326) || geometry.hasZ || geometry.hasM) {
    throw new Error('Expected two-dimensional WGS84 geometry')
  }
  if (geometry instanceof Point && Number.isNaN(geometry.x) && Number.isNaN(geometry.y)) {
    return { type: 'Point', coordinates: [] }
  }
  const json = geometry.toGeoJSON() as Wgs84Geometry
  const positions = json.type === 'Point' ? json.coordinates.length ? [json.coordinates] : [] : json.coordinates.flat()
  for (const position of positions) {
    if (position.length !== 2 || !position.every(Number.isFinite)
      || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) throw new Error('Invalid WGS84 coordinates')
  }
  if (json.type === 'Polygon') for (const ring of json.coordinates) {
    if (ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) {
      throw new Error('Polygon rings must be closed and contain at least four positions')
    }
  }
  return json
}

export function decodeWgs84Ewkb(hex: string, type: 'Point'): Wgs84Point
export function decodeWgs84Ewkb(hex: string, type: 'Polygon'): Wgs84Polygon
export function decodeWgs84Ewkb(hex: string, type: Wgs84Geometry['type']): Wgs84Geometry
export function decodeWgs84Ewkb(hex: string, type: Wgs84Geometry['type']): Wgs84Geometry {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error('Invalid EWKB hexadecimal encoding')
  const bytes = Buffer.from(hex, 'hex')
  if (bytes[0] !== 0 && bytes[0] !== 1) throw new Error('Invalid EWKB byte order')
  const geometry = Geometry.parse(bytes as Parameters<typeof Geometry.parse>[0])
  // WKX permits trailing bytes; a complete record must contain exactly one geometry.
  const encoded = geometry.toEwkb()
  const sourceHasSrid = bytes.length >= 5 && ((bytes[0] === 0 ? bytes.readUInt32BE(1) : bytes.readUInt32LE(1)) & 0x20000000) !== 0
  if (bytes.length !== encoded.length - (sourceHasSrid ? 0 : 4)) throw new Error('Unexpected trailing EWKB bytes')
  return checkGeometry(geometry, type)
}

export function encodeWgs84Geometry(value: Wgs84Geometry): string {
  if (value.type !== 'Point' && value.type !== 'Polygon') throw new Error('Expected WGS84 Point or Polygon')
  const geometry = Geometry.parseGeoJSON(value)
  checkGeometry(geometry, value.type)
  geometry.srid = 4326
  return geometry.toEwkb().toString('hex')
}

export function currentGeometryEwkb(source: string | null, current: Wgs84Geometry | null): string | null {
  if (current === null) return null
  const encoded = encodeWgs84Geometry(current)
  if (source !== null && encodeWgs84Geometry(decodeWgs84Ewkb(source, current.type)) === encoded) return source
  return encoded
}
