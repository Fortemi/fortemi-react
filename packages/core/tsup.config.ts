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
      'aiwg-index': 'src/aiwg-index.ts',
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
      '@electric-sql/pglite',
      '@noble/hashes',
      'fflate',
      'uuid',
      'zod',
    ],
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
