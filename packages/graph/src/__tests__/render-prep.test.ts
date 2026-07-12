import { describe, expect, it } from 'vitest'
import {
  GREYSCALE_COMMUNITY_RAMP,
  communityRanks,
  mapCommunityGraph,
  bakeRenderGraph,
  stringifyRenderGraph,
  isRenderGraph,
  hasBakedPositions,
  loadRenderSnapshot,
  type RenderGraph,
} from '../render-prep.js'
import { colorForCommunity } from '../color.js'
import type { CommunityGraph } from '../types.js'

// degrees: a=1, b=3, c=2, d=1, e=1 (isolated → 0). c1 has 3 nodes, c2 has 2.
const GRAPH: CommunityGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
  edges: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 2, kind: 'cites' },
    { source: 'b', target: 'd', weight: 1 },
  ],
  communities: [
    { id: 'small', nodes: ['d', 'e'] },
    { id: 'big', nodes: ['a', 'b', 'c'] },
  ],
}

describe('communityRanks (#264)', () => {
  it('ranks communities by member count, largest = 0', () => {
    const ranks = communityRanks(GRAPH)
    expect(ranks.get('big')).toBe(0)
    expect(ranks.get('small')).toBe(1)
  })

  it('breaks ties on community id for determinism', () => {
    const tied: CommunityGraph = {
      nodes: [{ id: 'x' }, { id: 'y' }],
      edges: [],
      communities: [
        { id: 'zeta', nodes: ['y'] },
        { id: 'alpha', nodes: ['x'] },
      ],
    }
    const ranks = communityRanks(tied)
    expect(ranks.get('alpha')).toBe(0)
    expect(ranks.get('zeta')).toBe(1)
  })
})

describe('mapCommunityGraph (#264)', () => {
  it('produces render-ready nodes: label, degree-size, tone, community rank', () => {
    const rg = mapCommunityGraph(GRAPH)
    expect(rg.clusters).toBe(2)
    expect(rg.nodes).toHaveLength(5)
    expect(rg.links).toHaveLength(3)

    const b = rg.nodes.find((n) => n.id === 'b')!
    // degree 3 → nodeRadius(3) = clamp(5 + 3*1.5, 5, 16) = 9.5
    expect(b.size).toBe(9.5)
    expect(b.communityRank).toBe(0) // 'big' is the largest community
    expect(b.label).toBe('b') // default label is the id
  })

  it('defaults to the community palette (matches colorForCommunity)', () => {
    const rg = mapCommunityGraph(GRAPH)
    const b = rg.nodes.find((n) => n.id === 'b')!
    expect(b.color).toBe(colorForCommunity('big'))
  })

  it('greyscale palette tones by rank (largest = darkest)', () => {
    const rg = mapCommunityGraph(GRAPH, { palette: 'greyscale' })
    const b = rg.nodes.find((n) => n.id === 'b')! // rank 0
    const d = rg.nodes.find((n) => n.id === 'd')! // rank 1 (small)
    expect(b.color).toBe(GREYSCALE_COMMUNITY_RAMP[0]) // darkest
    expect(d.color).toBe(GREYSCALE_COMMUNITY_RAMP[1])
  })

  it('marks unassigned nodes with rank -1', () => {
    const withOrphan: CommunityGraph = {
      nodes: [{ id: 'a' }, { id: 'lonely' }],
      edges: [],
      communities: [{ id: 'c1', nodes: ['a'] }],
    }
    const rg = mapCommunityGraph(withOrphan, { palette: 'greyscale' })
    const lonely = rg.nodes.find((n) => n.id === 'lonely')!
    expect(lonely.communityRank).toBe(-1)
    // unassigned → lightest ramp entry
    expect(lonely.color).toBe(GREYSCALE_COMMUNITY_RAMP[GREYSCALE_COMMUNITY_RAMP.length - 1])
  })

  it('applies a custom label resolver', () => {
    const titles = new Map([['a', 'Alpha']])
    const rg = mapCommunityGraph(GRAPH, { labelFor: (id) => titles.get(id) ?? id })
    expect(rg.nodes.find((n) => n.id === 'a')!.label).toBe('Alpha')
    expect(rg.nodes.find((n) => n.id === 'b')!.label).toBe('b')
  })

  it('bakes positions from a Map or Record when supplied', () => {
    const fromMap = mapCommunityGraph(GRAPH, { positions: new Map([['a', { x: 1, y: 2 }]]) })
    expect(fromMap.nodes.find((n) => n.id === 'a')).toMatchObject({ x: 1, y: 2 })
    expect(fromMap.nodes.find((n) => n.id === 'b')!.x).toBeUndefined()

    const fromRecord = mapCommunityGraph(GRAPH, { positions: { a: { x: 3, y: 4 } } })
    expect(fromRecord.nodes.find((n) => n.id === 'a')).toMatchObject({ x: 3, y: 4 })
  })

  it('preserves edge weight and kind on links', () => {
    const rg = mapCommunityGraph(GRAPH)
    const bc = rg.links.find((l) => l.source === 'b' && l.target === 'c')!
    expect(bc.weight).toBe(2)
    expect(bc.kind).toBe('cites')
  })

  it('honors a custom sizer', () => {
    const rg = mapCommunityGraph(GRAPH, { sizeFor: (deg) => deg })
    expect(rg.nodes.find((n) => n.id === 'b')!.size).toBe(3)
  })
})

describe('bakeRenderGraph (#264 build-time writer)', () => {
  it('runs layout once and bakes x/y onto every node', () => {
    const baked = bakeRenderGraph(GRAPH, { layout: { width: 100, height: 100 } })
    expect(hasBakedPositions(baked)).toBe(true)
    for (const n of baked.nodes) {
      expect(typeof n.x).toBe('number')
      expect(typeof n.y).toBe('number')
    }
  })

  it('is deterministic (seeded layout → identical snapshots)', () => {
    const a = stringifyRenderGraph(bakeRenderGraph(GRAPH, { layout: { width: 200, height: 200 } }))
    const b = stringifyRenderGraph(bakeRenderGraph(GRAPH, { layout: { width: 200, height: 200 } }))
    expect(a).toBe(b)
  })
})

describe('snapshot-first loader (#264)', () => {
  const baked = bakeRenderGraph(GRAPH, { layout: { width: 100, height: 100 } })

  it('isRenderGraph accepts a valid graph and rejects junk', () => {
    expect(isRenderGraph(baked)).toBe(true)
    expect(isRenderGraph(null)).toBe(false)
    expect(isRenderGraph({ nodes: [], links: [] })).toBe(false)
    expect(isRenderGraph({ nodes: [{ id: 'x' }], links: [] })).toBe(false) // missing size/color
  })

  it('returns a passed-in baked graph directly', async () => {
    const out = await loadRenderSnapshot(baked)
    expect(out).not.toBeNull()
    expect(out!.nodes).toHaveLength(5)
  })

  it('returns null for a position-less snapshot when positions are required', async () => {
    const noPos = mapCommunityGraph(GRAPH) // no baked x/y
    expect(await loadRenderSnapshot(noPos)).toBeNull()
    expect(await loadRenderSnapshot(noPos, { requirePositions: false })).not.toBeNull()
  })

  it('fetches from a URL and returns null on !ok or throw (fall back to live build)', async () => {
    const okFetch = (async () =>
      ({ ok: true, json: async () => baked }) as unknown as Response) as typeof fetch
    const okOut = await loadRenderSnapshot('/graph.snapshot.json', { fetchImpl: okFetch })
    expect(okOut).not.toBeNull()

    const notFound = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as typeof fetch
    expect(await loadRenderSnapshot('/missing.json', { fetchImpl: notFound })).toBeNull()

    const throwing = (async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    expect(await loadRenderSnapshot('/boom.json', { fetchImpl: throwing })).toBeNull()
  })

  it('supports a thunk source', async () => {
    const out = await loadRenderSnapshot(() => baked)
    expect(out).not.toBeNull()
    const nullThunk: () => RenderGraph | null = () => null
    expect(await loadRenderSnapshot(nullThunk)).toBeNull()
  })
})
