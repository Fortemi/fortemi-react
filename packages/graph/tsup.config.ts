import { defineConfig } from 'tsup';

// Framework-agnostic graph utilities. ESM only with .d.ts emitted.
// @fortemi/core is a runtime dependency (for GraphController) and must stay
// external — never bundle the core data layer into the graph package.

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  external: ['@fortemi/core'],
});
