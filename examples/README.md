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

## Shared infrastructure

- **`_shared/`** (`@fortemi/examples-shared`) — deterministic synthetic
  `CommunityGraph` datasets (`smallGraph`, `mediumGraph`, `largeGraph`) and a
  tiny seed-notes corpus, so graph examples run instantly with no database. Not
  published; when you copy an example out, replace this import with your own graph
  data.
- **`tsconfig.base.json`** — shared TS config the examples extend.
- **CI** — the `examples` job in `.gitea/workflows/ci.yml` typechecks and builds
  every example (Gitea only; no npmjs.org / GitHub-leg spend).

### Keeping PGlite out of a graph-only bundle

`@fortemi/graph` re-exports `GraphController`, which imports the `@fortemi/core`
database layer (Postgres-in-WASM) to load graphs *live*. Graph-only demos never
construct a controller, so each ships a tiny Vite plugin that stubs
`@fortemi/core` — keeping the ~9 MB PGlite engine out of the build. When you copy
an example out, keep this plugin if you render graphs without a database:

```ts
// vite.config.ts
import { defineConfig, type Plugin } from 'vite'

function stubFortemiCore(): Plugin {
  const stubId = '\0fortemi-core-stub'
  return {
    name: 'stub-fortemi-core',
    enforce: 'pre',
    resolveId: (source) => (source === '@fortemi/core' ? stubId : null),
    load: (id) =>
      id === stubId
        ? 'export class GraphRepository {}\nexport class CommunitiesRepository {}\n'
        : null,
  }
}

export default defineConfig({ plugins: [stubFortemiCore()] })
```

## Planned

The remaining tiers from [epic #315](https://git.integrolabs.net/Fortemi/fortemi-react/issues/315),
built in the epic's suggested order:

- **Core-data starters:** EX-06 `notes-crud-minimal`, EX-07 `search-basic`, EX-08 `shard-reader`
- **Intermediate:** EX-10 `notes-graph-explorer`, EX-11 `aiwg-index-map`, EX-12 `local-ai-setup`, EX-13 `shard-exchange`, EX-14 `remote-backend`, EX-15 `custom-canvas-renderer`
- **Composed apps:** EX-16 `knowledge-garden`, EX-17 `docs-atlas`, EX-18 `research-workbench`, EX-19 `dual-instance-sync`
