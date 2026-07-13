// Shared Vite wiring for the database-backed examples (anything that mounts
// `FortemiProvider` from `@fortemi/react`).
//
// The React package boots Postgres-in-WASM (PGlite). Three things make that
// build and run cleanly, and every DB example needs all three:
//
//   1. `worker.format: 'es'` — the provider references a module Worker
//      (`new Worker(new URL(...), { type: 'module' })`); Vite's default IIFE
//      worker format cannot code-split it, so the build fails without this.
//   2. `optimizeDeps.exclude: ['@electric-sql/pglite']` — PGlite ships its own
//      WASM/worker assets; pre-bundling them breaks streaming compilation.
//   3. COOP/COEP headers + raw `.wasm` serving in dev/preview — PGlite needs
//      `SharedArrayBuffer` and an unconsumed `Response` for
//      `WebAssembly.compileStreaming()`.
//
// Copy-out note: when you lift a DB example into your own app, inline the
// `worker`, `optimizeDeps`, `server.headers`, and `preview.headers` blocks below
// into your `vite.config.ts` and drop the `@fortemi/examples-shared` import —
// this file is example infrastructure, not a published package.

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, UserConfig } from 'vite'

const COOP_COEP = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * Dev/preview middleware that serves `.wasm` with the correct MIME + isolation
 * headers and an unconsumed body, so PGlite's `compileStreaming` works.
 */
export function pgliteWasmPlugin(): Plugin {
  return {
    name: 'fortemi-example-pglite-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('.wasm')) return next()
        const wasmFile = req.url.split('?')[0]
        const relative = wasmFile.startsWith('/') ? wasmFile.slice(1) : wasmFile
        const candidates = [
          path.resolve('node_modules', relative),
          path.resolve('../../node_modules', relative),
          path.resolve('../../packages/core/node_modules', relative),
          path.resolve(relative),
        ]
        const filePath = candidates.find((p) => {
          try {
            fs.accessSync(p)
            return true
          } catch {
            return false
          }
        })
        if (!filePath) return next()
        res.setHeader('Content-Type', 'application/wasm')
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * Vite config fragment every DB example spreads into its own `defineConfig`.
 * Excludes `plugins` so the example supplies `react()` (+ this file's
 * {@link pgliteWasmPlugin}) itself.
 */
export const fortemiDbConfig: Omit<UserConfig, 'plugins'> = {
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  server: { headers: COOP_COEP },
  preview: { headers: COOP_COEP },
}
