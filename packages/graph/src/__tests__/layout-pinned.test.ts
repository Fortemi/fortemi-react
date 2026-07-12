import { describe, expect, it } from 'vitest'
import { layoutCommunityGraph } from '../layout.js'
import type { CommunityGraph } from '../types.js'

const GRAPH: CommunityGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  edges: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 1 },
    { source: 'c', target: 'd', weight: 1 },
  ],
  communities: [{ id: 'c1', nodes: ['a', 'b', 'c', 'd'] }],
}

const OPTS = { width: 400, height: 300 } as const

describe('layoutCommunityGraph pinned positions (#245)', () => {
  it('holds a pinned node exactly at its coordinate', () => {
    const pin = { x: 123, y: 87 }
    const out = layoutCommunityGraph(GRAPH, { ...OPTS, pinned: { b: pin } })
    const b = out.nodeIndex.get('b')!
    expect(b.x).toBeCloseTo(pin.x, 6)
    expect(b.y).toBeCloseTo(pin.y, 6)
  })

  it('lets the rest of the graph re-settle around the pin (others move)', () => {
    const free = layoutCommunityGraph(GRAPH, OPTS)
    const pinned = layoutCommunityGraph(GRAPH, { ...OPTS, pinned: { b: { x: 50, y: 50 } } })
    // b is fixed; at least one other node ends up in a different place.
    const moved = ['a', 'c', 'd'].some((id) => {
      const f = free.nodeIndex.get(id)!
      const p = pinned.nodeIndex.get(id)!
      return Math.hypot(f.x - p.x, f.y - p.y) > 1
    })
    expect(moved).toBe(true)
  })

  it('accepts a Map as well as a record', () => {
    const out = layoutCommunityGraph(GRAPH, { ...OPTS, pinned: new Map([['a', { x: 10, y: 20 }]]) })
    const a = out.nodeIndex.get('a')!
    expect(a.x).toBeCloseTo(10, 6)
    expect(a.y).toBeCloseTo(20, 6)
  })

  it('is unchanged (bit-identical) when no nodes are pinned', () => {
    const base = layoutCommunityGraph(GRAPH, OPTS)
    const withEmptyPins = layoutCommunityGraph(GRAPH, { ...OPTS, pinned: {} })
    for (const node of base.nodes) {
      const other = withEmptyPins.nodeIndex.get(node.id)!
      expect(other.x).toBe(node.x)
      expect(other.y).toBe(node.y)
    }
  })

  it('warm-starts from initialPositions (seed carries into the result)', () => {
    // With zero ticks the seed positions pass straight through (only clamped).
    const seed = { a: { x: 60, y: 60 }, b: { x: 120, y: 90 } }
    const out = layoutCommunityGraph(GRAPH, { ...OPTS, initialPositions: seed, ticks: 0 })
    expect(out.nodeIndex.get('a')!.x).toBeCloseTo(60, 6)
    expect(out.nodeIndex.get('b')!.y).toBeCloseTo(90, 6)
  })

  it('pinned overrides initialPositions for the same node', () => {
    const out = layoutCommunityGraph(GRAPH, {
      ...OPTS,
      initialPositions: { a: { x: 10, y: 10 } },
      pinned: { a: { x: 200, y: 150 } },
    })
    const a = out.nodeIndex.get('a')!
    expect(a.x).toBeCloseTo(200, 6)
    expect(a.y).toBeCloseTo(150, 6)
  })
})
