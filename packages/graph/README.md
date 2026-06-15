# @fortemi/graph

Framework-agnostic graph tooling for fortemi. Pure TypeScript helpers that turn
a `CommunityGraph` into something you can render — layout, filtering, coloring,
degree-based sizing, bounds/fit, neighborhood expansion, and static snapshot
serialization. No React, no database, no runtime dependencies.

```bash
pnpm add @fortemi/graph
```

This package is an **add-on**, not a base layer. `@fortemi/core` remains the
foundation and owns graph *production* (building similarity/link graphs from the
PGlite store, detecting communities). `@fortemi/graph` sits on top and handles
graph *projection* — the layout and rendering logic that used to live inside the
React `GraphView`. Because it has zero dependencies and operates on plain
`CommunityGraph` data, it can be mixed into:

- `@fortemi/react` — `GraphView` uses these helpers internally.
- a JS-only host (e.g. a static documentation site) that wants to render an AIWG
  relationship map without pulling in React or the PGlite core.

## Data model

```ts
interface GraphNode { id: string }
interface GraphEdge { source: string; target: string; weight: number; kind?: string }
interface GraphCommunity { id: string; nodes: string[] }
interface CommunityGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  communities: GraphCommunity[]
}
```

These shapes are structurally identical to the ones `@fortemi/core` produces
(`GraphRepository.buildLinkGraph()`, `buildSimilarityGraph()`, and
`aiwgFortemiIndexToCommunityGraph()`), so a core graph drops straight into these
helpers without conversion.

## API

| Helper | Purpose |
|---|---|
| `layoutCommunityGraph(graph, opts?)` | Deterministic 2D positions (`force`/`radial`/`community`/`manual`) + per-node degree and community |
| `filterCommunityGraph(graph, filter?)` | Filter by community, edge kind, node allow-list, or predicate; drops emptied communities |
| `computeDegrees(graph)` / `nodeRadius(degree, opts?)` | Undirected degree map and degree → render radius |
| `colorForCommunity(id, palette?)` | Deterministic community → color (themeable palette) |
| `computeGraphBounds(nodes)` / `fitGraphToViewport(bounds, viewport, opts?)` | Bounding box and a centered fit transform |
| `neighborsOf` / `expandNeighborhood` / `subgraphForNodes` / `neighborhoodSubgraph` | Selection and BFS neighborhood expansion |
| `serializeGraphSnapshot` / `stringifyGraphSnapshot` / `deserializeGraphSnapshot` | Stable, reproducible static snapshots for JS-only hosts |

All helpers are pure: they never mutate their inputs and (except for an optional
snapshot timestamp) produce identical output for identical input.

## Produce a snapshot from `@fortemi/core` (build/server side)

The core package builds the graph; the graph package serializes it to a static
file. Core does not depend on graph — you compose them at the call site:

```ts
import { GraphRepository } from '@fortemi/core'
import { stringifyGraphSnapshot } from '@fortemi/graph'
import { writeFileSync } from 'node:fs'

const graph = await new GraphRepository(db).buildLinkGraph()
writeFileSync(
  'public/graph-snapshot.json',
  stringifyGraphSnapshot(graph, { layout: { algorithm: 'community', width: 800, height: 600 } }),
)
```

## Render in a vanilla JS host (no React)

A static documentation site can fetch that snapshot and render its own SVG using
only the projection helpers — no React, no PGlite:

```js
import {
  deserializeGraphSnapshot,
  filterCommunityGraph,
  layoutCommunityGraph,
  computeGraphBounds,
  fitGraphToViewport,
  colorForCommunity,
  nodeRadius,
} from '@fortemi/graph'

const width = 800
const height = 600

const snapshot = await (await fetch('./graph-snapshot.json')).json()
const graph = deserializeGraphSnapshot(snapshot)

// 1. filter (e.g. hide a private community, or keep only certain edge kinds)
const visible = filterCommunityGraph(graph, { edgeKinds: ['similarity', 'link'] })

// 2. lay out — deterministic, so the same data always renders identically
const { nodes, edges, nodeIndex } = layoutCommunityGraph(visible, {
  algorithm: 'community',
  width,
  height,
})

// 3. fit the laid-out graph into the viewport
const view = fitGraphToViewport(computeGraphBounds(nodes), { width, height }, { padding: 24 })

// 4. project to SVG
const line = (e) => {
  const a = nodeIndex.get(e.source)
  const b = nodeIndex.get(e.target)
  if (!a || !b) return ''
  const w = Math.max(1, Math.min(5, e.weight))
  return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#9aa0a6" stroke-width="${w}" opacity="0.55" />`
}
const circle = (n) =>
  `<circle cx="${n.x}" cy="${n.y}" r="${nodeRadius(n.degree)}" ` +
  `fill="${colorForCommunity(n.communityId)}" stroke="#fff" stroke-width="1.5">` +
  `<title>${n.id}</title></circle>`

document.getElementById('graph').innerHTML = `
  <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" width="100%">
    <g transform="translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})">
      ${edges.map(line).join('')}
      ${nodes.map(circle).join('')}
    </g>
  </svg>`
```

The same helpers back `@fortemi/react`'s `GraphView`, so a React app and a
static site stay visually aligned.

## Determinism

`layoutCommunityGraph`, `colorForCommunity`, `filterCommunityGraph`, and
`serializeGraphSnapshot` are deterministic functions of their inputs. That makes
them safe for build-time snapshot generation, content-addressable caching, and
stable visual diffs. `serializeGraphSnapshot` sorts nodes, edges, and community
members so equal graphs serialize byte-for-byte identically; pass `generatedAt`
only when you want a timestamp in the output.

## License

AGPL-3.0-only.
