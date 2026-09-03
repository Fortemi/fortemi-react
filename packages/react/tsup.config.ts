import { defineConfig } from 'tsup';

// React hooks + FortemiProvider. ESM only with .d.ts.
// React stays external (peer dep). @fortemi/core and @fortemi/graph are
// regular dependencies (consumer pnpm-adds them) — kept external so they
// resolve at runtime rather than being inlined into the react bundle.

export default defineConfig({
  // `index` is the full surface (provider + hooks + GraphView).
  // `graph` is a PGlite-free presentational subpath (GraphView only) — issue #261.
  // `graph-2d` is the Sigma interactive explorer (issue #263); `graph-3d` is the
  // react-force-graph-3d/Three view (issue #262). Both heavy renderers' deps are
  // optional peers, dynamically imported, so they stay external.
  entry: {
    index: 'src/index.ts',
    dataset: 'src/dataset/index.ts',
    graph: 'src/graph.ts',
    'graph-2d': 'src/graph-2d.ts',
    'graph-3d': 'src/graph-3d.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  external: [
    'react',
    'react-dom',
    '@fortemi/core',
    '@fortemi/graph',
    // Optional peer deps for the interactive tiers — dynamically imported, never bundled.
    'graphology',
    'sigma',
    'graphology-layout-forceatlas2',
    'graphology-layout-forceatlas2/worker',
    'react-force-graph-3d',
    'three',
  ],
});
