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

## The data layer, in the browser

The core-data tier runs the full Fortémi database — **PGlite (Postgres compiled
to WASM)** — inside the tab, no server. These examples legitimately ship the
~9 MB engine (it is the point); they mount `FortemiProvider` with
`persistence="memory"` for an instant, disposable demo and share the PGlite/Vite
wiring via `@fortemi/examples-shared/vite-db`.

| ID | Example | What it teaches |
|----|---------|-----------------|
| EX-06 | `notes-crud-minimal` | The complete note lifecycle over PGlite — `useNotes` / `useCreateNote` / `useUpdateNote` / `useDeleteNote`, soft-delete included. |
| EX-07 | `search-basic` | Postgres full-text search with `useSearch` (`mode: 'text'`), prefix suggestions, `ts_headline` snippets, and tag facets — lexical only, no model download. |
| EX-08 | `shard-reader` | The Knowledge Shard portability loop: `exportShard(db)` bakes a `.shard`, then `useShard` browses it read-only with **no PGlite** on the reader side. |

## Intermediate

Where the tiers compose. These build on the starters — deriving graph structure
from real database content, and proving the data-prep layer feeds surfaces
beyond the built-in views.

| ID | Example | What it teaches |
|----|---------|-----------------|
| EX-10 | `notes-graph-explorer` | Derive a `CommunityGraph` from note **tags** in PGlite, explore it with `GraphView`, and `useNote` the full record on click — no embeddings. |
| EX-11 | `aiwg-index-map` | Project an AIWG artifact index (agents, commands, rules) into a `CommunityGraph` with `useAiwgIndex` → `toCommunityGraph`; communities are the artifact **types**, `search` spotlights hits. Static index, nothing boots. |
| EX-12 | `local-ai-setup` | Progressive AI enhancement: `useGpuCapabilities` / `useInferenceCapabilities` detect the tier, `useLocalDiscovery` finds Ollama/LM Studio, and an **opt-in** `enable('semantic')` downloads an embedding model — then `useJobQueue` shows the pipeline. The one example that downloads, and only on click. |
| EX-15 | `custom-canvas-renderer` | Render a `RenderGraph` to a hand-written `<canvas>` via `bakeRenderGraph` — the graph views are just one consumer of the data-prep layer. No database. |
| EX-13 | `shard-exchange` | Two independent in-memory instances exchanging a `.shard`: `exportShard` on one, `useImportShard` on the other with a conflict strategy — the poor-man's-sync transport. |

## Composed applications

Real surfaces: the focused hooks composed into whole apps.

| ID | Example | What it teaches |
|----|---------|-----------------|
| EX-16 | `knowledge-garden` | Notes CRUD + full-text search + a tag-derived graph + detail, all sharing one selection over a single PGlite database. |
| EX-17 | `docs-atlas` | Build-time: a markdown corpus → tag-similarity graph → **baked snapshot**. Runtime: PGlite-free graph + reader that renders baked coordinates with no layout pass — deployable to any static host. |
| EX-19 | `dual-instance-sync` | Two divergent instances converge by exchanging shards both ways — an idempotent, server-less sync loop. |

## Shared dataset

Graph examples use `@fortemi/examples-shared` (in `examples/_shared/`) —
deterministic synthetic `CommunityGraph` datasets (`smallGraph`, `mediumGraph`,
`largeGraph`) so demos run instantly with no database. It is example
infrastructure, not a published package; replace it with your own graph data
when you copy an example out.

## Roadmap

The remaining examples — a remote-backend intermediate demo and one more
composed application (research workbench) — are tracked on
[epic #315](https://git.integrolabs.net/Fortemi/fortemi-react/issues/315).
