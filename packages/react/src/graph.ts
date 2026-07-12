/**
 * `@fortemi/react/graph` — presentational graph surface (issue #261).
 *
 * A PGlite-free entry point: `GraphView` renders a `CommunityGraph` as SVG
 * using only `@fortemi/graph` (framework-agnostic layout/filter/color helpers)
 * and React. It carries NO runtime dependency on `@fortemi/core` — the sole
 * `@fortemi/core` reference in `GraphView` is a type-only `CommunityGraph`
 * import, erased at build.
 *
 * Consumers that want only the graph rendering (e.g. a docs-map / static
 * tenant with no database) import from this subpath instead of the package
 * root, so the PGlite WASM engine and the DB worker never enter their module
 * graph and Vite code-split builds succeed.
 */

export { GraphView } from './components/GraphView.js'
export type { GraphViewFilters, GraphViewProps } from './components/GraphView.js'
