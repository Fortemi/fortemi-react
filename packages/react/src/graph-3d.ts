/**
 * `@fortemi/react/graph-3d` — 3D force-directed graph view (issue #262).
 *
 * A third renderer tier backed by `react-force-graph-3d` (Three.js), an OPTIONAL
 * peer dependency loaded lazily via `React.lazy` → dynamic `import()` so Three
 * only ships when this view is mounted. Install it only if you use the 3D view:
 *
 *   pnpm add react-force-graph-3d three
 *
 * Kept on its own subpath so Three never enters a consumer's bundle unless
 * imported. Data is a `@fortemi/graph` `RenderGraph`.
 */

export { ForceGraph3DView } from './components/ForceGraph3DView.js'
export type { ForceGraph3DViewProps, ForceGraph3DTheme } from './components/ForceGraph3DView.js'
