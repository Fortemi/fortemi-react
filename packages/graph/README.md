<div align="center">

# @fortemi/graph

**Framework-agnostic graph projection helpers for rendering Fortemi community graphs anywhere**

Turn a `CommunityGraph` into something you can draw — deterministic layout, filtering, community coloring, degree-based sizing, bounds/fit, neighborhood expansion, and static snapshot serialization — plus a framework-agnostic `GraphController` for graph-source selection. Framework-agnostic (no React); depends on `@fortemi/core`. The pure projection helpers stay database-free and tree-shakeable for JS-only hosts, and run entirely client-side — no network, no database.

```bash
pnpm add @fortemi/graph
```

[![npm version](https://img.shields.io/npm/v/@fortemi/graph/latest?label=npm&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/graph)
[![npm downloads](https://img.shields.io/npm/dm/@fortemi/graph?color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/@fortemi/graph)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg?style=flat-square)](https://github.com/Fortemi/fortemi-react/blob/main/LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Built with aiwg](https://img.shields.io/npm/v/aiwg?label=built%20with%20aiwg&color=CB3837&logo=npm&style=flat-square)](https://www.npmjs.com/package/aiwg)

[**Install**](#installation) · [**Why Fortemi**](#why-fortemi-graph) · [**Quick Start**](#quick-start) · [**API**](#api) · [**Data Model**](#data-model) · [**Docs**](#documentation) · [**License**](#license)

</div>

---

## What @fortemi/graph Is

`@fortemi/graph` is the framework-agnostic projection layer for Fortemi relationship graphs. It takes a plain `CommunityGraph` — the shape produced by `@fortemi/core`'s `GraphRepository` and AIWG index export — and provides the pure, deterministic helpers needed to lay it out, filter it, color it, size it, fit it to a viewport, and render it as SVG or canvas.

It is an **add-on, not a base layer**. `@fortemi/core` remains the foundation and owns graph *production* (similarity and link graphs built from the PGlite store) and community *detection*. `@fortemi/graph` sits on top and owns graph *projection* and *source orchestration* (`GraphController`). It depends on `@fortemi/core` for the controller and shared graph types, but `@fortemi/core` never depends on it — the chain is `@electric-sql/pglite` ← `@fortemi/core` ← `@fortemi/graph` ← `@fortemi/react`. The projection helpers operate on portable data and reach no database, so they power `@fortemi/react`'s `GraphView` and a JS-only host — a static documentation site, for example — with no React. Only `GraphController` touches the PGlite-backed repositories.

## Why Fortemi Graph

Rendering a knowledge graph usually means re-implementing layout math, community coloring, degree sizing, and viewport fitting in every host. Fortemi centralizes that logic in one package, so a React app and a static site stay visually aligned and share the exact same deterministic projection.

| Need | What Fortemi Graph provides |
|---|---|
| Deterministic layout | `layoutCommunityGraph` — a seeded `force` settlement plus closed-form `radial`/`community`/`manual` positions; identical input always yields identical coordinates |
| Visibility control | `filterCommunityGraph` — filter by community, edge kind, node allow-list, or predicate |
| Readable encoding | Degree-based node sizing and deterministic community color assignment |
| Viewport math | Bounding box plus a centered fit transform for SVG/canvas |
| Interaction | Neighborhood expansion and induced-subgraph helpers for selection |
| Portable views | Stable snapshot serialization for static, precomputed graphs |
| Zero lock-in | Pure TypeScript, no React, structurally compatible with `@fortemi/core` data |

### What You Can Build

- Static documentation relationship maps rendered from a precomputed snapshot
- Custom React, Svelte, or Vue graph views that share Fortemi's projection logic
- Server- or build-time SVG generation of AIWG relationship graphs
- Selection and "expand neighborhood" interactions over a community graph
- Themed community visualizations using a custom color palette

### Architecture at a Glance

`@fortemi/core` produces a `CommunityGraph` and detects communities. `@fortemi/graph` consumes that shape; it depends on `@fortemi/core` but never on React, and `@fortemi/core` never depends on it. `filterCommunityGraph` narrows what is shown, `layoutCommunityGraph` assigns deterministic coordinates, and the color/degree/bounds helpers turn the positioned graph into draw calls. `serializeGraphSnapshot` freezes a graph to portable JSON for hosts that render without recomputing it.

## Installation

```bash
pnpm add @fortemi/graph
# or
npm install @fortemi/graph
```

No peer dependencies. Ships ESM with type declarations and works in browsers, Node, and bundlers.

## Quick Start

```ts
import {
  filterCommunityGraph,
  layoutCommunityGraph,
  colorForCommunity,
  nodeRadius,
  type CommunityGraph,
} from '@fortemi/graph'

const graph: CommunityGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  edges: [{ source: 'a', target: 'b', weight: 1, kind: 'similarity' }],
  communities: [{ id: 'c1', nodes: ['a', 'b'] }],
}

const visible = filterCommunityGraph(graph, { edgeKinds: ['similarity'] })
const { nodes, nodeIndex } = layoutCommunityGraph(visible, {
  algorithm: 'community',
  width: 800,
  height: 600,
})

for (const node of nodes) {
  // deterministic coordinates, degree-based radius, community color
  console.log(node.id, node.x, node.y, nodeRadius(node.degree), colorForCommunity(node.communityId))
}
```

## Data Model

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

These shapes are structurally identical to the ones `@fortemi/core` produces (`GraphRepository.buildLinkGraph()`, `buildSimilarityGraph()`, and `aiwgFortemiIndexToCommunityGraph()`), so a core graph drops straight into these helpers without conversion.

## API

| Helper | Purpose |
|---|---|
| `layoutCommunityGraph(graph, opts?)` | Deterministic 2D positions — a seeded `force` settlement (link attraction, charge repulsion, collision spacing, community cohesion, centering, bounds clamping) or closed-form `radial`/`community`/`manual`. Returns per-node `x, y, r`, degree, community, plus community centroids |
| `filterCommunityGraph(graph, filter?)` | Filter by community, edge kind, node allow-list, or predicate; drops emptied communities |
| `computeDegrees(graph)` / `nodeRadius(degree, opts?)` | Undirected degree map and degree → render radius |
| `colorForCommunity(id, palette?)` | Deterministic community → color (themeable palette) |
| `computeGraphBounds(nodes)` / `fitGraphToViewport(bounds, viewport, opts?)` | Bounding box and a centered fit transform |
| `neighborsOf` / `expandNeighborhood` / `subgraphForNodes` / `neighborhoodSubgraph` / `buildAdjacency` | Selection and BFS neighborhood expansion |
| `serializeGraphSnapshot` / `stringifyGraphSnapshot` / `deserializeGraphSnapshot` | Stable, reproducible static snapshots for JS-only hosts |

### Layout options (`force`)

The `force` algorithm runs a fixed-iteration, seeded settlement — fully synchronous and headless (no animation frames), so identical `(graph, options)` always yields identical coordinates. Suitable for static SVG generation, SSR, and browser rendering. The `radial`, `community`, and `manual` algorithms are closed-form and honor `width`/`height`/`boundsPadding` only.

| Option | Default | Purpose |
|---|---|---|
| `algorithm` | `'force'` | `force` (settlement) · `radial` · `community` · `manual` (closed-form) |
| `width` / `height` | `760` / `460` | Canvas size |
| `seed` | `1` | PRNG seed for initial jitter (identical seed ⇒ identical output) |
| `ticks` | `300` | Settlement iterations |
| `nodeRadius` | degree-derived | Per-node radius: a fixed `number`, `NodeRadiusOptions`, or `(degree, node) => number` |
| `linkDistance` / `linkStrength` | `60` / `0.08` | Spring target length and stiffness |
| `chargeStrength` | `-240` | Repulsion magnitude (negative pushes apart) |
| `collisionPadding` | `2` | Extra spacing beyond `r_i + r_j` |
| `communityStrength` | `0.05` | Pull toward the node's community centroid |
| `boundsPadding` | `24` | Keep every node center this many px from each edge |

Each positioned node carries a stable render radius `r` (degree-derived by default, overrideable via `nodeRadius`), and the result includes `communities` centroids over the final positions.

All helpers are pure: they never mutate their inputs and (except for an optional snapshot timestamp) produce identical output for identical input.

## What You Get

- Deterministic, dependency-free graph projection that renders identically across hosts
- One source of truth for layout, filtering, coloring, and sizing shared with `@fortemi/react`
- Portable snapshots so a static site can render an AIWG graph without React or PGlite
- Full TypeScript types, re-exported `CommunityGraph` model, ESM output

## Produce a Snapshot from @fortemi/core

The core package builds the graph; the graph package serializes it to a static file. Core does not depend on graph — you compose them at the call site:

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

## Choosing a Renderer

The same `CommunityGraph` can be drawn by more than one renderer *tier*. Every tier honors the shared **`GraphControlContract`** — `algorithm`, `filters` (community / edge-kind / node allow-list / `minDegree`), `selectedNodeId` + `onSelectNode`, `onNavigate`, `labelFor`, `colors` — so switching tiers is mechanical: pass the same options object.

| Tier | Import | Deps | Best for |
|---|---|---|---|
| **JS-only SVG** | `renderCommunityGraph` (`@fortemi/graph`) | none | Static sites, SSR/snapshot pipelines, no-framework hosts |
| **React (static)** | `GraphView` (`@fortemi/react`) | React | React apps wanting the component + hooks ecosystem |
| **Interactive 2D** | Sigma tier (planned, #263) | `sigma` + `graphology` (optional, lazy) | Live force settling, camera focus, LOD labels |
| **3D** | `Graph3D` (planned, #262) | `react-force-graph-3d` (optional, lazy) | Orbitable 3D force graph, 2D/3D toggle |

`communityLegend(graph)` returns `{ communityId, color, count }[]` — the shared data any tier can render as a legend and use to drive the `communityIds` show/hide filter. `applyControlFilters(graph, filters)` is the one filter function every tier runs, so visibility is identical across tiers.

## Render in a Vanilla JS Host (no React)

`renderCommunityGraph` is a batteries-included SVG renderer built on the engine — zoom/pan, hover-neighborhood highlighting, click + keyboard selection, navigation, a labeled popup, and `focus(id)` search — with no React and no canvas library. It stays pixel-comparable to `@fortemi/react`'s `GraphView`:

```js
import { renderCommunityGraph, deserializeGraphSnapshot } from '@fortemi/graph'

const graph = deserializeGraphSnapshot(await (await fetch('./graph-snapshot.json')).json())

const view = renderCommunityGraph(document.getElementById('graph'), graph, {
  algorithm: 'community',
  filters: { edgeKinds: ['similarity', 'link'], minDegree: 1 },
  labelFor: (id) => graph.nodes.find((n) => n.id === id)?.id ?? id,
  onSelectNode: (id) => console.log('selected', id),
  onNavigate: (id) => location.assign(`#/note/${id}`),
})

view.update({ filters: { communityIds: ['c1'] } }) // reactive filter change
view.focus('note-42')                               // search / focus a node
// view.destroy()                                   // tear down
```

The **React tier** takes the same contract fields, so a consumer can offer both and switch with no rewiring:

```tsx
import { GraphView } from '@fortemi/react'

<GraphView
  graph={graph}
  layout={{ algorithm: 'community' }}
  filters={{ edgeKinds: ['similarity', 'link'], minDegree: 1 }}
  selectedNodeId={selected}
  onSelectNode={setSelected}
  onNavigate={(id) => navigate(`/note/${id}`)}
  labelFor={(id) => titleOf(id)}
/>
```

### Roll your own projection

If you need a fully custom view, the projection helpers are exposed directly — `renderCommunityGraph` is just a consumer of them — so you can emit your own SVG/canvas with no PGlite:

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

The same helpers back `@fortemi/react`'s `GraphView`, so a React app and a static site stay visually aligned.

## Determinism

`layoutCommunityGraph`, `colorForCommunity`, `filterCommunityGraph`, and `serializeGraphSnapshot` are deterministic functions of their inputs. That makes them safe for build-time snapshot generation, content-addressable caching, and stable visual diffs. `serializeGraphSnapshot` sorts nodes, edges, and community members so equal graphs serialize byte-for-byte identically; pass `generatedAt` only when you want a timestamp in the output.

Community *detection* lives in `@fortemi/core` (the base layer); this package only projects graphs it is given.

## Documentation

| Guide | Description |
|---|---|
| [API Reference](https://github.com/Fortemi/fortemi-react/blob/main/docs/content/api-reference.md) | Full `@fortemi/graph`, `@fortemi/core`, and `@fortemi/react` surface |

## React Bindings

Using React? [`@fortemi/react`](https://www.npmjs.com/package/@fortemi/react) ships a `GraphView` component built on these helpers, plus hooks for building and caching graphs from a live archive.

## License

AGPL-3.0-only.
