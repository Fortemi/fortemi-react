import { defineConfig } from 'tsup';

// Framework-agnostic graph utilities. ESM only with .d.ts emitted. The root
// entry stays database-free; GraphController lives on a dedicated subpath and
// keeps @fortemi/core external.

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    controller: 'src/controller.ts',
  },
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
