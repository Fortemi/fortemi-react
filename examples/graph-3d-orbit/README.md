# EX-04 · graph-3d-orbit

**Category:** Graph · React · no database
**Packages:** `@fortemi/react/graph-3d`

The same synthetic graph rendered in 3D via `ForceGraph3DView` (three.js through
react-force-graph-3d). Three is lazy-loaded through `React.lazy`, so it only
ships when the view mounts.

## What it teaches
- `ForceGraph3DView`: orbit (drag), zoom (scroll), click-to-select.
- The `palette` and `theme` props (`{ background }`).
- three + react-force-graph-3d are optional peers — install them only for this
  view. The `stubFortemiCore` plugin keeps PGlite out of the bundle.

## Run it
```bash
pnpm install   # from the repo root, once
pnpm dev       # from this directory
```
