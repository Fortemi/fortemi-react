# EX-01 · graph-svg-vanilla

**Category:** Graph · no React · no database
**Packages:** `@fortemi/graph`

The smallest proof that the fortemi graph stack is framework-agnostic. A
`CommunityGraph` is authored by hand and rendered to interactive SVG with the
renderer the package ships (`renderCommunityGraph`) — no React, no PGlite, no
server, no model download.

## What it teaches

- The `CommunityGraph` data model is just three arrays: `nodes`, `edges`,
  `communities`. You can author one by hand.
- `renderCommunityGraph(container, graph, options)` gives you layout, zoom, pan,
  and hover for free in any DOM element — zero framework.
- `communityLegend(graph)` is the shared legend data every renderer tier uses.
- **How to keep PGlite out of a graph-only bundle.** The `@fortemi/graph` root
  entry is database-free; live database orchestration lives at
  `@fortemi/graph/controller`. This demo imports only the root helpers, so
  PGlite never enters the build.

## APIs used

| API | From |
|-----|------|
| `renderCommunityGraph` | `@fortemi/graph` |
| `communityLegend` | `@fortemi/graph` |
| `type CommunityGraph` | `@fortemi/graph` |

## Run it

```bash
pnpm install   # from the repo root, once
pnpm dev       # from this directory
```

Then open the printed URL. `pnpm build` produces a static site in `dist/`.

## Copy it out

This example imports only from `@fortemi/graph`. To use it in your own project,
`npm i @fortemi/graph` and drop in `src/main.ts`. Import
`@fortemi/graph/controller` only when you need live database-backed graph
loading.
