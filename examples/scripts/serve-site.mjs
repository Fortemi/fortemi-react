#!/usr/bin/env node
// Serves examples/_site/ as one demo site, with the cross-origin isolation headers
// the PGlite examples need (SharedArrayBuffer requires COOP: same-origin +
// COEP: require-corp). No dependencies — just node's http/fs.
//
//   pnpm examples:site:serve            # http://localhost:4321
//   PORT=8080 pnpm examples:site:serve

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const siteDir = join(here, '..', '_site')
const port = Number(process.env.PORT) || 4321

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.data': 'application/octet-stream',
}

function coiHeaders(res) {
  // Cross-origin isolation — required by PGlite's SharedArrayBuffer usage.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
}

async function tryFile(p) {
  try {
    const s = await stat(p)
    if (s.isFile()) return p
    if (s.isDirectory()) {
      const idx = join(p, 'index.html')
      const si = await stat(idx)
      if (si.isFile()) return idx
    }
  } catch { /* not found */ }
  return null
}

const server = createServer(async (req, res) => {
  coiHeaders(res)
  try {
    const url = new URL(req.url, `http://localhost:${port}`)
    // Contain the path inside siteDir.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    let target = join(siteDir, rel)
    if (!target.startsWith(siteDir)) { res.statusCode = 403; return res.end('forbidden') }

    let file = await tryFile(target)
    // Per-example SPA fallback: /<id>/anything → /<id>/index.html
    if (!file) {
      const seg = rel.split('/').filter(Boolean)[0]
      if (seg) file = await tryFile(join(siteDir, seg))
    }
    if (!file) file = await tryFile(siteDir) // root index

    if (!file) { res.statusCode = 404; return res.end('not found') }

    const body = await readFile(file)
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    res.statusCode = 200
    res.end(body)
  } catch (err) {
    res.statusCode = 500
    res.end(String(err?.message ?? err))
  }
})

server.listen(port, () => {
  console.log(`\n▸ examples gallery → http://localhost:${port}\n  (cross-origin isolated; PGlite examples work)\n`)
})
