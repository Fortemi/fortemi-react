import { defineConfig } from 'tsup';

// Pure framework-agnostic graph utilities. ESM only with .d.ts emitted.
// No runtime dependencies — nothing is marked external.

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
});
