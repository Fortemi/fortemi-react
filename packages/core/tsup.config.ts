import { defineConfig } from 'tsup';

// Main library entry. Built to ESM with .d.ts emitted.
// Worker entries (sw.ts, pglite-worker.ts) are emitted as separate
// bundles so consumers can wire them up via Vite's `?worker` or static
// hosting. They are intentionally excluded from the main entry because
// they execute in worker contexts and pull in different globals.

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'aiwg-index-schema': 'src/aiwg-index-schema.ts',
      'aiwg-index-shard': 'src/aiwg-index-shard.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    outDir: 'dist',
    noExternal: ['wkx', 'buffer', 'buffer/', 'base64-js', 'ieee754', 'inherits'],
    esbuildOptions(options) {
      options.inject = ['src/shard/geometry-buffer.ts'];
      options.alias = { ...options.alias, util: './src/shard/geometry-util.js' };
    },
    external: [
      '@electric-sql/pglite',
      '@noble/hashes',
      'fflate',
      'uuid',
      'zod',
    ],
  },
  {
    // Dependency-free static-search artifact. Keep shard/schema/runtime code in
    // their dedicated subpaths so this file remains directly vendorable.
    entry: {
      'aiwg-index': 'src/aiwg-index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    minify: true,
    outDir: 'dist',
  },
  {
    entry: { 'pglite-worker': 'src/worker/pglite-worker.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist/worker',
    external: ['@electric-sql/pglite'],
  },
  {
    entry: { sw: 'src/service-worker/sw.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    target: 'es2022',
    outDir: 'dist/service-worker',
  },
]);
