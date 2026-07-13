# EX-15 · custom-canvas-renderer

The built-in views (`GraphView`, `SigmaGraphView`, `ForceGraph3DView`) are only
*one* consumer of `@fortemi/graph`'s data-prep. This example targets a different
surface: it bakes a `CommunityGraph` into a `RenderGraph` and draws it to a
hand-written `<canvas>` — no framework renderer, no built-in view, no database.

```bash
pnpm install     # once, from the repo root
cd examples/custom-canvas-renderer
pnpm dev
```

## What it shows

- `bakeRenderGraph(graph, { layout, palette, labelFor })` — one call that runs
  layout (force / radial / community), community coloring, and degree-based node
  sizing, returning a `RenderGraph` with baked `x`/`y`.
- The rest is plain Canvas 2D: draw links, draw nodes, label the big ones.
- Hover/click hit-testing done by hand against the baked coordinates — hover
  dims the rest and highlights incident edges; click selects.
- Live layout + palette switches, each a fresh `bakeRenderGraph`.

The point: once you have a `RenderGraph`, you own the pixels. Swap the canvas for
WebGL, SVG, a minimap, a print export — the data-prep layer doesn't care.

## Copy it out

The app imports only `@fortemi/graph` and `@fortemi/examples-shared`. The
database-backed graph controller is isolated behind `@fortemi/graph/controller`,
so graph-only builds do not need a `@fortemi/core` alias or external.
