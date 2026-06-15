<div align="center">

# @fortemi/graph

**Framework-agnostic graph projection helpers for rendering Fortemi community graphs anywhere**

Turn a `CommunityGraph` into something you can draw — deterministic layout, filtering, community coloring, degree-based sizing, bounds/fit, neighborhood expansion, and static snapshot serialization. Zero runtime dependencies, no React, no database.

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

It is an **add-on, not a base layer**. `@fortemi/core` remains the foundation and owns graph *production* (similarity and link graphs built from the PGlite store) and community *detection*. `@fortemi/graph` sits on top and owns graph *projection*. Because it has zero dependencies and operates on portable data, the same helpers power `@fortemi/react`'s `GraphView` and a JS-only host — a static documentation site, for example — with no React and no PGlite.

## Why Fortemi Graph

Rendering a knowledge graph usually means re-implementing layout math, community coloring, degree sizing, and viewport fitting in every host. Fortemi centralizes that logic in one dependency-free package, so a React app and a static site stay visually aligned and share the exact same deterministic projection.

| Need | What Fortemi Graph provides |
|---|---|
| Deterministic layout | `layoutCommunityGraph` — closed-form `force`/`radial`/`community`/`manual` positions, no randomness |
| Visibility control | `filterCommunityGraph` — filter by community, edge kind, node allow-list, or predicate |
| Readable encoding | Degree-based node sizing and deterministic community color assignment |
| Viewport math | Bounding box plus a centered fit transform for SVG/canvas |
| Interaction | Neighborhood expansion and induced-subgraph helpers for selection |
| Portable views | Stable snapshot serialization for static, precomputed graphs |
| Zero lock-in | Pure TypeScript, no dependencies, structurally compatible with `@fortemi/core` data |

### What You Can Build

- Static documentation relationship maps rendered from a precomputed snapshot
- Custom React, Svelte, or Vue graph views that share Fortemi's projection logic
- Server- or build-time SVG generation of AIWG relationship graphs
- Selection and "expand neighborhood" interactions over a community graph
- Themed community visualizations using a custom color palette

### Architecture at a Glance

`@fortemi/core` produces a `CommunityGraph` and detects communities. `@fortemi/graph` consumes that shape and never depends on core or React. `filterCommunityGraph` narrows what is shown, `layoutCommunityGraph` assigns deterministic coordinates, and the color/degree/bounds helpers turn the positioned graph into draw calls. `serializeGraphSnapshot` freezes a graph to portable JSON for hosts that render without recomputing it.

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
| `layoutCommunityGraph(graph, opts?)` | Deterministic 2D positions (`force`/`radial`/`community`/`manual`) plus per-node degree and community |
| `filterCommunityGraph(graph, filter?)` | Filter by community, edge kind, node allow-list, or predicate; drops emptied communities |
| `computeDegrees(graph)` / `nodeRadius(degree, opts?)` | Undirected degree map and degree → render radius |
| `colorForCommunity(id, palette?)` | Deterministic community → color (themeable palette) |
| `computeGraphBounds(nodes)` / `fitGraphToViewport(bounds, viewport, opts?)` | Bounding box and a centered fit transform |
| `neighborsOf` / `expandNeighborhood` / `subgraphForNodes` / `neighborhoodSubgraph` / `buildAdjacency` | Selection and BFS neighborhood expansion |
| `serializeGraphSnapshot` / `stringifyGraphSnapshot` / `deserializeGraphSnapshot` | Stable, reproducible static snapshots for JS-only hosts |

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

## Render in a Vanilla JS Host (no React)

A static documentation site can fetch that snapshot and render its own SVG using only the projection helpers — no React, no PGlite:

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
| [API Reference](https://github.com/Fortemi/fortemi-react/blob/main/docs/api-reference.md) | Full `@fortemi/graph`, `@fortemi/core`, and `@fortemi/react` surface |
| [Package Architecture](https://github.com/Fortemi/fortemi-react/blob/main/docs/architecture/package-architecture.md) | Diagram and capability tables for each package and how they layer |

## React Bindings

Using React? [`@fortemi/react`](https://www.npmjs.com/package/@fortemi/react) ships a `GraphView` component built on these helpers, plus hooks for building and caching graphs from a live archive.

## License

AGPL-3.0-only.
