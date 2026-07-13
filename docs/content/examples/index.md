# Examples

A curated set of runnable example apps for the `@fortemi/*` packages. Each lives
under [`examples/`](https://github.com/Fortemi/fortemi-react/tree/main/examples)
in the repository as a standalone Vite app with its own README. None are
published to npm — copy one out, `npm i` the packages it names, and it runs.

```bash
pnpm install                 # once, from the repo root
cd examples/graph-svg-vanilla
pnpm dev
```

## The graph stack, standalone

The first tranche showcases `@fortemi/graph` and the three React view tiers as a
**standalone product** — they work over any `CommunityGraph`/`RenderGraph` with
no database, no Fortémi server, and no model downloads. Each ships a small Vite
plugin that stubs `@fortemi/core`, keeping the ~9 MB PGlite engine out of the
bundle (EX-01 builds to 14 KB).

| ID | Example | What it teaches |
|----|---------|-----------------|
| EX-01 | `graph-svg-vanilla` | Hand-author a `CommunityGraph`, render it to interactive SVG with `renderCommunityGraph` — zero framework, no database. |
| EX-02 | `graph-view-static` | The PGlite-free React `GraphView`: selection, hover labels, and the shared `GraphControlFilters` contract. |
| EX-03 | `graph-2d-live` | `SigmaGraphView` — ForceAtlas2 settle, hover dimming, click-focus, ⌘-click re-anchor, community vs greyscale palettes. |
| EX-04 | `graph-3d-orbit` | `ForceGraph3DView` — 3D orbit/zoom over the same graph, with three.js lazy-loaded on mount. |
| EX-05 | `snapshot-baking` | `bakeRenderGraph` at build time → `loadRenderSnapshot` warm start: instant render with no runtime layout. |
| EX-09 | `graph-controls-playground` | One control panel driving the shared filter contract across `GraphView`, Sigma, and 3D — switch renderers without rewiring. |

## Shared dataset

Graph examples use `@fortemi/examples-shared` (in `examples/_shared/`) —
deterministic synthetic `CommunityGraph` datasets (`smallGraph`, `mediumGraph`,
`largeGraph`) so demos run instantly with no database. It is example
infrastructure, not a published package; replace it with your own graph data
when you copy an example out.

## Roadmap

The remaining tiers — core-data starters (notes CRUD, search, shard reader),
intermediate demos (notes-graph explorer, local-AI setup, shard exchange, remote
backend), and composed applications (knowledge garden, docs atlas, research
workbench) — are tracked on
[epic #315](https://git.integrolabs.net/Fortemi/fortemi-react/issues/315).
