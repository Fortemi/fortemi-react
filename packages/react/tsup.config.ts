import { defineConfig } from 'tsup';

// React hooks + FortemiProvider. ESM only with .d.ts.
// React and @fortemi/core stay external — peer deps for React,
// regular dependency for core (consumer pnpm-adds both).

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
  external: ['react', 'react-dom', '@fortemi/core'],
});
