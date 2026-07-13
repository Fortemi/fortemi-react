# fortemi examples

Runnable, copy-pasteable examples for the `@fortemi/*` packages — from single-
concept starters to composed applications. Each example is a standalone Vite app
with its own `package.json` and README; none are published to npm.

The examples import from `@fortemi/*` package names (via `workspace:*` here), but
the code reads as if installed from npm — no deep relative imports into
`packages/`. Copy any directory out, `npm i` the `@fortemi/*` packages it names,
and it runs.

## Quickstart

```bash
pnpm install                 # once, from the repo root
cd examples/graph-svg-vanilla
pnpm dev                     # open the printed URL
```

Every example supports `pnpm dev`, `pnpm build`, and `pnpm typecheck`.

## Delivered

The no-DB graph tier + the controls playground — **highest reuse value, zero
capability downloads, no database.** These prove the graph stack is a standalone
product that works over any `CommunityGraph`/`RenderGraph`.

| ID | Example | Category | Teaches |
|----|---------|----------|---------|
| EX-01 | [`graph-svg-vanilla`](./graph-svg-vanilla) | Graph · no React · no DB | Hand-authored `CommunityGraph` → `renderCommunityGraph` SVG. Zero framework. |
| EX-02 | [`graph-view-static`](./graph-view-static) | Graph · React · no DB | The PGlite-free `GraphView` with selection + the shared filter contract. |
| EX-03 | [`graph-2d-live`](./graph-2d-live) | Graph · React · no DB | `SigmaGraphView` — ForceAtlas2 settle, hover dimming, click-focus, palettes. |
| EX-04 | [`graph-3d-orbit`](./graph-3d-orbit) | Graph · React · no DB | `ForceGraph3DView` — 3D orbit/zoom, lazy-loaded three.js. |
| EX-05 | [`snapshot-baking`](./snapshot-baking) | Graph build pipeline | `bakeRenderGraph` at build time → `loadRenderSnapshot` warm start, zero runtime layout. |
| EX-09 | [`graph-controls-playground`](./graph-controls-playground) | Graph · React · no DB | One control panel over the shared `GraphControlFilters`, switchable across all three renderer tiers. |

The core-data tier — the full Fortémi database (**PGlite: Postgres-in-WASM**) in
the browser, no server. These examples legitimately ship the ~9 MB engine (it is
the point) and share the PGlite/Vite wiring via `@fortemi/examples-shared/vite-db`.

| ID | Example | Category | Teaches |
|----|---------|----------|---------|
| EX-06 | [`notes-crud-minimal`](./notes-crud-minimal) | Data · React · PGlite | The complete note lifecycle — `useNotes` / `useCreateNote` / `useUpdateNote` / `useDeleteNote`, soft-delete included. |
| EX-07 | [`search-basic`](./search-basic) | Data · React · PGlite | Postgres full-text search (`useSearch`, `mode: 'text'`), prefix suggestions, `ts_headline` snippets, tag facets — no model download. |
| EX-08 | [`shard-reader`](./shard-reader) | Data · React · PGlite→reader | The shard portability loop: `exportShard(db)` bakes a `.shard`; `useShard` browses it read-only with **no PGlite** on the reader side. |

The intermediate tier — where the starters compose.

| ID | Example | Category | Teaches |
|----|---------|----------|---------|
| EX-10 | [`notes-graph-explorer`](./notes-graph-explorer) | Data + Graph · React · PGlite | Derive a `CommunityGraph` from note **tags**, explore with `GraphView`, `useNote` on click — no embeddings. |
| EX-11 | [`aiwg-index-map`](./aiwg-index-map) | Index + Graph · React · no DB boot | `useAiwgIndex` → `toCommunityGraph` projects an AIWG artifact index into communities by type; `search` spotlights hits. Static index, nothing boots. |
| EX-12 | [`local-ai-setup`](./local-ai-setup) | Capabilities · React · PGlite | Detect tier (`useGpuCapabilities`/`useInferenceCapabilities`), discover local servers (`useLocalDiscovery`), **opt-in** `enable('semantic')` to download an embedding model, watch `useJobQueue`. The one example that downloads — on click only. |
| EX-14 | [`remote-backend`](./remote-backend) | Remote · React · no DB boot | The PGlite starters' note-list + search UI, sourced from a Fortémi server via `useRemote`. The local/remote seam (needs a running server). |
| EX-15 | [`custom-canvas-renderer`](./custom-canvas-renderer) | Graph · React · no DB | Render a `RenderGraph` to a hand-written `<canvas>` via `bakeRenderGraph` — the data-prep layer feeds any surface. |
| EX-13 | [`shard-exchange`](./shard-exchange) | Data · React · PGlite×2 | Two independent in-memory instances exchange a `.shard`: `exportShard` on one, `useImportShard` on the other with a conflict strategy. |

The composed applications — focused hooks wired into whole surfaces.

| ID | Example | Category | Teaches |
|----|---------|----------|---------|
| EX-16 | [`knowledge-garden`](./knowledge-garden) | Composed · React · PGlite | Notes CRUD + search + tag-graph + detail sharing one selection over one database. |
| EX-17 | [`docs-atlas`](./docs-atlas) | Composed · React · no DB (static) | Build-time markdown corpus → tag-similarity graph → baked snapshot; runtime PGlite-free graph + reader. Deployable static. |
| EX-18 | [`research-workbench`](./research-workbench) | Composed · React · PGlite | Papers with **attachments** (extracted text), **SKOS concept** tags, **citation** links, and **revision provenance** — `manageAttachments` / `useNoteConcepts` / `manageLinks` / `useNoteProvenance` / `useUpdateNote`, one selection over a citation `GraphView`. No downloads. |
| EX-19 | [`dual-instance-sync`](./dual-instance-sync) | Composed · React · PGlite×2 | Two divergent instances converge by exchanging shards both ways — idempotent, server-less sync. |

## Shared infrastructure

- **`_shared/`** (`@fortemi/examples-shared`) — deterministic synthetic
  `CommunityGraph` datasets (`smallGraph`, `mediumGraph`, `largeGraph`) and a
  tiny seed-notes corpus, so graph examples run instantly with no database. Not
  published; when you copy an example out, replace this import with your own graph
  data.
- **`_shared/vite-db.ts`** (`@fortemi/examples-shared/vite-db`) — the PGlite/worker
  Vite wiring every database example needs (`worker.format: 'es'`, PGlite
  excluded from pre-bundling, COOP/COEP headers, raw `.wasm` serving). Inline it
  when you copy a DB example out.
- **`tsconfig.base.json`** — shared TS config the examples extend.
- **CI** — the `examples` job in `.gitea/workflows/ci.yml` typechecks and builds
  every example (Gitea only; no npmjs.org / GitHub-leg spend).

### Keeping PGlite out of a graph-only bundle

Graph-only demos import the `@fortemi/graph` root entry and build without
consumer-side externals or aliases. The database-backed `GraphController` lives
behind `@fortemi/graph/controller`, so static graph views do not pull
`@fortemi/core`, the PGlite worker, or WASM assets into their module graph.

## Status

All 19 examples from [epic #315](https://git.integrolabs.net/Fortemi/fortemi-react/issues/315)
are delivered.
