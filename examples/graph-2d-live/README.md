# EX-03 · graph-2d-live

**Category:** Graph · React · no database
**Packages:** `@fortemi/react/graph-2d`

Interactive 2D graph explorer backed by Sigma + graphology ForceAtlas2, lazy-
loaded so the heavy renderer only ships when mounted.

## What it teaches
- `SigmaGraphView` renders a `CommunityGraph` (or a `RenderGraph`) with a cold-
  seed ForceAtlas2 settle, hover dimming, click-focus, and ⌘/Ctrl-click re-anchor.
- The `palette` prop: `'community'` (qualitative) vs `'greyscale'` (by density).
- Shared filters (`minDegree`) apply identically to every renderer tier.
- Sigma + graphology are optional peers — install them only for this view. The
  graph-only subpaths keep PGlite out of the bundle.

## Run it
```bash
pnpm install   # from the repo root, once
pnpm dev       # from this directory
```
