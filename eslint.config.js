import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Node.js runtime globals for tooling scripts. The `globals` npm package is not
// a dependency of this workspace, so the Node global set is declared inline and
// scoped to the tooling paths below. Browser-facing source is TypeScript, where
// typescript-eslint disables `no-undef` (TS performs its own global checking),
// so these globals are intentionally not applied there.
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  globalThis: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
}

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'docsite/**'],
  },
  {
    // Node-runtime tooling: build/release/fixture scripts and root config files.
    files: [
      '**/scripts/**/*.{js,mjs,cjs}',
      '**/tools/**/*.{js,mjs,cjs}',
      '*.{js,mjs,cjs}',
    ],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
)
