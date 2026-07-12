import { describe, expect, it } from 'vitest'
import { clientToGraphPoint } from '../components/graph-view-geometry.js'

const RECT = { left: 100, top: 50, width: 380, height: 230 } // 760x460 viewBox at 0.5 device scale

describe('clientToGraphPoint (#245 drag coordinate inversion)', () => {
  const transform = { width: 760, height: 460, scale: 1, offset: { x: 0, y: 0 } }

  it('maps the rect origin to graph (0,0) and center to the viewBox center', () => {
    expect(clientToGraphPoint(RECT, transform, 100, 50)).toEqual({ x: 0, y: 0 })
    const center = clientToGraphPoint(RECT, transform, 100 + 190, 50 + 115)
    expect(center.x).toBeCloseTo(380, 6)
    expect(center.y).toBeCloseTo(230, 6)
  })

  it('undoes pan offset', () => {
    const t = { ...transform, offset: { x: 40, y: 20 } }
    // client origin → viewBox (0,0) → graph (0-40)/1, (0-20)/1
    expect(clientToGraphPoint(RECT, t, 100, 50)).toEqual({ x: -40, y: -20 })
  })

  it('undoes zoom scale', () => {
    const t = { ...transform, scale: 2 }
    const p = clientToGraphPoint(RECT, t, 100 + 190, 50 + 115) // viewBox center 380,230
    expect(p.x).toBeCloseTo(190, 6)
    expect(p.y).toBeCloseTo(115, 6)
  })

  it('undoes pan and zoom together', () => {
    const t = { width: 760, height: 460, scale: 2, offset: { x: 60, y: 10 } }
    const p = clientToGraphPoint(RECT, t, 100 + 190, 50 + 115) // viewBox 380,230
    expect(p.x).toBeCloseTo((380 - 60) / 2, 6)
    expect(p.y).toBeCloseTo((230 - 10) / 2, 6)
  })

  it('returns origin for a zero-sized rect (not yet laid out)', () => {
    expect(clientToGraphPoint({ left: 0, top: 0, width: 0, height: 0 }, transform, 10, 10)).toEqual({ x: 0, y: 0 })
  })
})
