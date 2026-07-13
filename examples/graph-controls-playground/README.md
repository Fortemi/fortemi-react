# EX-09 · graph-controls-playground

**Category:** Graph · React · no database
**Packages:** `@fortemi/react/graph`, `@fortemi/react/graph-2d`, `@fortemi/react/graph-3d`, `@fortemi/graph`

The headline reusable-controls showcase. One control panel drives the **shared**
`GraphControlFilters` contract — community show/hide, edge-kind, minimum degree —
over one dataset, and you can switch the renderer between `GraphView` (SVG),
`SigmaGraphView` (2D), and `ForceGraph3DView` (3D) without rewiring.

## What it teaches
- The shared control contract: the exact same `filters` object works on all
  three renderer tiers.
- Per-tier extras where the API supports them: `palette` (Sigma / 3D),
  `layout.algorithm` and `draggableNodes` (GraphView).
- How to compose all three graph subpaths in one app while keeping PGlite out of
  the bundle.

## Run it
```bash
pnpm install   # from the repo root, once
pnpm dev       # from this directory
```
