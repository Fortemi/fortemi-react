import { defineConfig } from 'tsup';

// React hooks + FortemiProvider. ESM only with .d.ts.
// React stays external (peer dep). @fortemi/core and @fortemi/graph are
// regular dependencies (consumer pnpm-adds them) — kept external so they
// resolve at runtime rather than being inlined into the react bundle.

export default defineConfig({
  // `index` is the full surface (provider + hooks + GraphView).
  // `graph` is a PGlite-free presentational subpath (GraphView only) — issue #261.
  entry: { index: 'src/index.ts', graph: 'src/graph.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  external: ['react', 'react-dom', '@fortemi/core', '@fortemi/graph'],
});
