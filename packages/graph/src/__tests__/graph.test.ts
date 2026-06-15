import { describe, it, expect } from 'vitest'
import {
  COMMUNITY_COLORS,
  UNASSIGNED_COMMUNITY_COLOR,
  buildAdjacency,
  colorForCommunity,
  computeDegrees,
  computeGraphBounds,
  deserializeGraphSnapshot,
  expandNeighborhood,
  filterCommunityGraph,
  fitGraphToViewport,
  layoutCommunityGraph,
  neighborhoodSubgraph,
  neighborsOf,
  nodeRadius,
  serializeGraphSnapshot,
  stringifyGraphSnapshot,
  subgraphForNodes,
  GRAPH_SNAPSHOT_VERSION,
  type CommunityGraph,
} from '../index.js'

function sampleGraph(): CommunityGraph {
  return {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'iso' }],
    edges: [
      { source: 'a', target: 'b', weight: 1, kind: 'similarity' },
      { source: 'b', target: 'c', weight: 1, kind: 'similarity' },
      { source: 'a', target: 'c', weight: 1, kind: 'similarity' },
      { source: 'd', target: 'e', weight: 1, kind: 'link' },
    ],
    communities: [
      { id: 'c1', nodes: ['a', 'b', 'c'] },
      { id: 'c2', nodes: ['d', 'e'] },
    ],
  }
}

const EMPTY: CommunityGraph = { nodes: [], edges: [], communities: [] }

describe('computeDegrees', () => {
  it('counts undirected degree including isolated nodes', () => {
    const degrees = computeDegrees(sampleGraph())
    expect(degrees.get('a')).toBe(2)
    expect(degrees.get('b')).toBe(2)
    expect(degrees.get('c')).toBe(2)
    expect(degrees.get('d')).toBe(1)
    expect(degrees.get('e')).toBe(1)
    expect(degrees.get('iso')).toBe(0)
  })
})

describe('nodeRadius', () => {
  it('matches the historical clamp(5 + degree*1.5, 5, 16)', () => {
    expect(nodeRadius(0)).toBe(5)
    expect(nodeRadius(2)).toBe(8)
    expect(nodeRadius(100)).toBe(16) // clamped
  })
  it('honors custom sizing options', () => {
    expect(nodeRadius(4, { base: 2, perDegree: 1, min: 0, max: 10 })).toBe(6)
  })
})

describe('colorForCommunity', () => {
  it('is deterministic for a given id', () => {
    expect(colorForCommunity('c1')).toBe(colorForCommunity('c1'))
  })
  it('returns the unassigned color for undefined', () => {
    expect(colorForCommunity(undefined)).toBe(UNASSIGNED_COMMUNITY_COLOR)
  })
  it('maps into the provided palette', () => {
    expect(COMMUNITY_COLORS).toContain(colorForCommunity('anything'))
    expect(colorForCommunity('x', ['#000', '#fff'])).toMatch(/^#(000|fff)$/)
  })
  it('falls back to unassigned color for an empty palette', () => {
    expect(colorForCommunity('x', [])).toBe(UNASSIGNED_COMMUNITY_COLOR)
  })
})

describe('filterCommunityGraph', () => {
  it('returns an empty graph for null/undefined input', () => {
    expect(filterCommunityGraph(null)).toEqual(EMPTY)
    expect(filterCommunityGraph(undefined)).toEqual(EMPTY)
  })

  it('is a no-op shape when no filter is given', () => {
    const result = filterCommunityGraph(sampleGraph())
    expect(result.nodes).toHaveLength(6)
    expect(result.edges).toHaveLength(4)
    expect(result.communities).toHaveLength(2)
  })

  it('restricts to selected communities and drops emptied ones', () => {
    const result = filterCommunityGraph(sampleGraph(), { communityIds: ['c1'] })
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(result.edges).toHaveLength(3)
    expect(result.communities).toHaveLength(1)
    expect(result.communities[0].id).toBe('c1')
  })

  it('filters edges by kind', () => {
    const result = filterCommunityGraph(sampleGraph(), { edgeKinds: ['link'] })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].kind).toBe('link')
  })

  it('restricts to an explicit node allow-list (privacy/visibility)', () => {
    const result = filterCommunityGraph(sampleGraph(), { nodeIds: ['a', 'b'] })
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(result.edges).toHaveLength(1) // only a-b survives
  })

  it('applies an arbitrary node predicate', () => {
    const result = filterCommunityGraph(sampleGraph(), { nodePredicate: (node) => node.id !== 'c' })
    expect(result.nodes.map((n) => n.id)).not.toContain('c')
    // edges touching c are removed: b-c and a-c
    expect(result.edges.map((e) => `${e.source}-${e.target}`).sort()).toEqual(['a-b', 'd-e'])
  })

  it('does not mutate the input graph', () => {
    const graph = sampleGraph()
    const snapshot = JSON.stringify(graph)
    filterCommunityGraph(graph, { communityIds: ['c1'] })
    expect(JSON.stringify(graph)).toBe(snapshot)
  })
})

describe('layoutCommunityGraph', () => {
  it('is deterministic — repeated runs produce identical coordinates', () => {
    const graph = sampleGraph()
    const a = layoutCommunityGraph(graph, { algorithm: 'force', width: 800, height: 600 })
    const b = layoutCommunityGraph(graph, { algorithm: 'force', width: 800, height: 600 })
    expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]))
  })

  it('positions every node, annotates degree + community, and builds an index', () => {
    const positioned = layoutCommunityGraph(sampleGraph())
    expect(positioned.nodes).toHaveLength(6)
    for (const node of positioned.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
      expect(positioned.nodeIndex.get(node.id)).toBe(node)
    }
    expect(positioned.nodeIndex.get('a')?.degree).toBe(2)
    expect(positioned.nodeIndex.get('a')?.communityId).toBe('c1')
    expect(positioned.nodeIndex.get('iso')?.communityId).toBeUndefined()
  })

  it('produces different layouts per algorithm', () => {
    const graph = sampleGraph()
    const force = layoutCommunityGraph(graph, { algorithm: 'force' })
    const community = layoutCommunityGraph(graph, { algorithm: 'community' })
    const forceA = force.nodeIndex.get('a')!
    const communityA = community.nodeIndex.get('a')!
    expect([forceA.x, forceA.y]).not.toEqual([communityA.x, communityA.y])
  })

  it('handles the empty graph', () => {
    const positioned = layoutCommunityGraph(EMPTY)
    expect(positioned.nodes).toEqual([])
    expect(positioned.edges).toEqual([])
    expect(positioned.nodeIndex.size).toBe(0)
  })
})

describe('computeGraphBounds / fitGraphToViewport', () => {
  it('returns a zero box for no nodes', () => {
    expect(computeGraphBounds([])).toMatchObject({ width: 0, height: 0, centerX: 0, centerY: 0 })
  })

  it('computes a tight bounding box and center', () => {
    const bounds = computeGraphBounds([
      { x: -10, y: 0 },
      { x: 10, y: 20 },
    ])
    expect(bounds).toMatchObject({ minX: -10, minY: 0, maxX: 10, maxY: 20, width: 20, height: 20, centerX: 0, centerY: 10 })
  })

  it('fits and centers bounds within a viewport', () => {
    const bounds = computeGraphBounds([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ])
    const transform = fitGraphToViewport(bounds, { width: 200, height: 200 }, { padding: 0 })
    expect(transform.scale).toBe(2)
    // center of bounds (50,50) maps to viewport center (100,100)
    expect(50 * transform.scale + transform.offsetX).toBeCloseTo(100)
    expect(50 * transform.scale + transform.offsetY).toBeCloseTo(100)
  })

  it('clamps scale within bounds', () => {
    const bounds = computeGraphBounds([{ x: 0, y: 0 }, { x: 1000, y: 1000 }])
    const transform = fitGraphToViewport(bounds, { width: 100, height: 100 }, { minScale: 0.5 })
    expect(transform.scale).toBeGreaterThanOrEqual(0.05)
  })
})

describe('neighborhood helpers', () => {
  it('lists direct neighbors', () => {
    expect([...neighborsOf(sampleGraph(), 'a')].sort()).toEqual(['b', 'c'])
    expect([...neighborsOf(sampleGraph(), 'iso')]).toEqual([])
  })

  it('expands to a given depth via BFS', () => {
    const graph: CommunityGraph = {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      edges: [
        { source: 'a', target: 'b', weight: 1 },
        { source: 'b', target: 'c', weight: 1 },
        { source: 'c', target: 'd', weight: 1 },
      ],
      communities: [],
    }
    expect([...expandNeighborhood(graph, ['a'], { depth: 1 })].sort()).toEqual(['a', 'b'])
    expect([...expandNeighborhood(graph, ['a'], { depth: 2 })].sort()).toEqual(['a', 'b', 'c'])
    expect([...expandNeighborhood(graph, ['a'], { depth: 2, includeSeeds: false })].sort()).toEqual(['b', 'c'])
  })

  it('extracts induced subgraphs', () => {
    const sub = subgraphForNodes(sampleGraph(), ['a', 'b'])
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(sub.edges).toHaveLength(1)
  })

  it('builds a neighborhood subgraph around a seed', () => {
    const sub = neighborhoodSubgraph(sampleGraph(), ['a'], { depth: 1 })
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('builds an undirected adjacency map covering isolated nodes', () => {
    const adjacency = buildAdjacency(sampleGraph())
    expect(adjacency.get('iso')?.size).toBe(0)
    expect([...(adjacency.get('b') ?? [])].sort()).toEqual(['a', 'c'])
  })
})

describe('snapshot serialization', () => {
  it('serializes deterministically with sorted members', () => {
    const unsorted: CommunityGraph = {
      nodes: [{ id: 'b' }, { id: 'a' }],
      edges: [{ source: 'b', target: 'a', weight: 1, kind: 'x' }],
      communities: [{ id: 'c2', nodes: ['b', 'a'] }, { id: 'c1', nodes: ['a'] }],
    }
    const snap = serializeGraphSnapshot(unsorted)
    expect(snap.version).toBe(GRAPH_SNAPSHOT_VERSION)
    expect(snap.graph.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(snap.graph.communities.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(snap.graph.communities[1].nodes).toEqual(['a', 'b'])
  })

  it('round-trips through string form', () => {
    const graph = sampleGraph()
    const json = stringifyGraphSnapshot(graph, { layout: { algorithm: 'force', width: 800, height: 600 } })
    const restored = deserializeGraphSnapshot(json)
    expect(restored.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'iso'])
    expect(restored.edges).toHaveLength(4)
  })

  it('omits timestamp for reproducible output unless provided', () => {
    expect(serializeGraphSnapshot(EMPTY).generatedAt).toBeUndefined()
    expect(serializeGraphSnapshot(EMPTY, { generatedAt: '2026-06-14T00:00:00Z' }).generatedAt).toBe('2026-06-14T00:00:00Z')
  })

  it('rejects malformed or wrong-version snapshots', () => {
    expect(() => deserializeGraphSnapshot('not json{')).toThrow()
    expect(() => deserializeGraphSnapshot({ version: 999 } as never)).toThrow(/version/)
    expect(() => deserializeGraphSnapshot({ version: GRAPH_SNAPSHOT_VERSION } as never)).toThrow(/nodes/)
  })
})
