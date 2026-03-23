import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Serves .wasm files directly without Vite consuming the response body.
 * PGlite uses WebAssembly.compileStreaming() which requires an unconsumed
 * Response. Vite's dev middleware reads response bodies for its transform
 * pipeline, which breaks streaming WASM compilation.
 */
function pgliteWasmPlugin(): Plugin {
  return {
    name: 'pglite-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('.wasm')) {
          return next()
        }
        // Resolve the wasm file from node_modules
        const wasmFile = req.url.split('?')[0]
        const relativePath = wasmFile.startsWith('/') ? wasmFile.slice(1) : wasmFile
        const candidates = [
          path.resolve('node_modules', relativePath),
          path.resolve('../../packages/core/node_modules', relativePath),
          path.resolve(relativePath),
        ]
        const filePath = candidates.find(p => {
          try { fs.accessSync(p); return true } catch { return false }
        })
        if (!filePath) {
          return next()
        }
        res.setHeader('Content-Type', 'application/wasm')
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), pgliteWasmPlugin()],
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
  // PGlite requires SharedArrayBuffer — these COOP/COEP headers are mandatory
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
