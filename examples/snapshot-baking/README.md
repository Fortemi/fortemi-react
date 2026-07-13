# EX-05 · snapshot-baking

**Category:** Graph build pipeline · no database
**Packages:** `@fortemi/graph`

Build-time layout vs. runtime layout. A Node script bakes the graph layout once;
the page loads the result and renders it with no layout pass at all.

## What it teaches
- `bakeRenderGraph(graph, { layout })` runs the layout once and returns a
  `RenderGraph` with baked `x`/`y`.
- `stringifyRenderGraph` writes a deterministic, cache-friendly snapshot.
- `loadRenderSnapshot(url)` warm-starts the page — instant render, no runtime
  layout — and returns `null` (never throws) when the snapshot is absent or
  lacks positions, so a real app can fall back to a live build.
- Because the render only maps coordinates, the page has no framework or WASM
  cost beyond React itself.

## How it works
```
pnpm bake        # node scripts/bake.mjs → public/graph-snapshot.json
pnpm dev         # predev bakes first, then serves the page
```
The `predev` and `prebuild` scripts run the bake automatically.

## APIs used
| API | From |
|-----|------|
| `bakeRenderGraph`, `stringifyRenderGraph`, `hasBakedPositions` | `@fortemi/graph` |
| `loadRenderSnapshot`, `type RenderGraph` | `@fortemi/graph` |
