import { describe, expect, it } from 'vitest'
import { applyControlFilters, communityLegend } from '../contract.js'
import { colorForCommunity } from '../color.js'
import type { CommunityGraph } from '../types.js'

const GRAPH: CommunityGraph = {
  // degrees: a=1, b=2, c=2, d=1
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  edges: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 1 },
    { source: 'c', target: 'd', weight: 1 },
  ],
  communities: [
    { id: 'c1', nodes: ['a', 'b', 'c'] },
    { id: 'c2', nodes: ['d'] },
  ],
}

describe('applyControlFilters (#260 shared filter semantics)', () => {
  it('passes through when no filter given', () => {
    expect(applyControlFilters(GRAPH).nodes).toHaveLength(4)
  })

  it('composes engine filters (communityIds) then minDegree', () => {
    const out = applyControlFilters(GRAPH, { minDegree: 2 })
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['b', 'c'])
    expect(out.edges).toHaveLength(1) // only b–c survives
  })

  it('minDegree of 0 or missing is a no-op', () => {
    expect(applyControlFilters(GRAPH, { minDegree: 0 }).nodes).toHaveLength(4)
  })

  it('community filter and node allow-list still apply alongside minDegree', () => {
    const out = applyControlFilters(GRAPH, { communityIds: ['c1'], minDegree: 2 })
    // c1 = {a,b,c}; degrees within that set: a=1,b=2,c=1 → keep b
    expect(out.nodes.map((n) => n.id)).toEqual(['b'])
  })

  it('handles null graph', () => {
    expect(applyControlFilters(null).nodes).toHaveLength(0)
  })
})

describe('communityLegend (#260 shared legend data)', () => {
  it('returns one entry per community, colored and sized, largest first', () => {
    const legend = communityLegend(GRAPH)
    expect(legend).toEqual([
      { communityId: 'c1', color: colorForCommunity('c1'), count: 3 },
      { communityId: 'c2', color: colorForCommunity('c2'), count: 1 },
    ])
  })

  it('honors a palette override and handles null', () => {
    const palette = ['#abcabc']
    expect(communityLegend(GRAPH, palette)[0].color).toBe(colorForCommunity('c1', palette))
    expect(communityLegend(null)).toEqual([])
  })
})
