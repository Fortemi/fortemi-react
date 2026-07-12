/**
 * `@fortemi/react/graph-2d` — interactive 2D graph explorer (issue #263).
 *
 * A heavier renderer tier than the static `GraphView`, backed by Sigma +
 * graphology ForceAtlas2. Those are OPTIONAL peer dependencies, lazy-loaded via
 * dynamic `import()` when the component mounts — install them only if you use
 * this view:
 *
 *   pnpm add sigma graphology graphology-layout-forceatlas2
 *
 * Kept on its own subpath so the heavy renderer never enters a consumer's
 * bundle unless imported. Like the root package it is PGlite-adjacent only
 * through types; the runtime data is a `@fortemi/graph` `RenderGraph`.
 */

export { SigmaGraphView } from './components/SigmaGraphView.js'
export type { SigmaGraphViewProps, SigmaTheme } from './components/SigmaGraphView.js'
