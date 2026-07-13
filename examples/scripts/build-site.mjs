#!/usr/bin/env node
// Builds every example into one deployable static site under examples/_site/.
//
// For each example we run `vite build --base=/<id>/` (so its assets resolve when
// hosted under a subpath) into the example's own dist/, then copy that into
// examples/_site/<id>/. A generated index.html links to all of them. The two
// bake-first examples (snapshot-baking, docs-atlas) get their bake step run first.
//
// The output is a plain static tree — deployable to any host that can send the
// COOP/COEP headers the PGlite examples need. `serve-site.mjs` does exactly that
// for local preview.

import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const examplesDir = join(here, '..')
const root = join(examplesDir, '..')
const siteDir = join(examplesDir, '_site')

const manifest = JSON.parse(readFileSync(join(examplesDir, 'gallery.manifest.json'), 'utf8'))
const all = manifest.tiers.flatMap((t) => t.examples)

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

console.log(`\n▸ Building ${all.length} examples into examples/_site/\n`)
rmSync(siteDir, { recursive: true, force: true })
mkdirSync(siteDir, { recursive: true })

let built = 0
for (const e of all) {
  const pkg = `@fortemi/example-${e.id}`
  console.log(`── ${e.ex} ${e.id}`)
  if (e.prebuild) run('pnpm', ['--filter', pkg, 'run', e.prebuild])
  run('pnpm', ['--filter', pkg, 'exec', 'vite', 'build', '--base', `/${e.id}/`])

  const dist = join(examplesDir, e.id, 'dist')
  if (!existsSync(dist)) throw new Error(`no dist produced for ${e.id}`)
  cpSync(dist, join(siteDir, e.id), { recursive: true })
  built++
}

writeFileSync(join(siteDir, 'index.html'), renderIndex(manifest))
console.log(`\n✓ Built ${built} examples + gallery index → examples/_site/`)
console.log('  Serve it with:  pnpm examples:site:serve\n')

// ── gallery index page ────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function card(e) {
  const badges = [
    e.downloads ? '<span class="badge dl" title="Downloads a model — on user click only">downloads</span>' : '',
    e.needsServer ? '<span class="badge srv" title="Needs a running Fortémi server">needs server</span>' : '',
  ].join('')
  return `<a class="card" href="./${esc(e.id)}/">
  <div class="card-head"><span class="ex">${esc(e.ex)}</span>${badges}</div>
  <h3>${esc(e.title)}</h3>
  <p>${esc(e.teaser)}</p>
  <span class="open">Open →</span>
</a>`
}

function tier(t) {
  return `<section class="tier">
  <h2>${esc(t.name)}</h2>
  <p class="blurb">${esc(t.blurb)}</p>
  <div class="grid">${t.examples.map(card).join('\n')}</div>
</section>`
}

function renderIndex(m) {
  const count = m.tiers.reduce((n, t) => n + t.examples.length, 0)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(m.title)}</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --panel:#161b22; --panel2:#1c232d; --border:#2b333d; --text:#e6e9ef; --muted:#8b95a3; --accent:#6ea8fe; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:2.5rem 1.5rem 5rem; }
  header h1 { margin:0 0 .35rem; font-size:1.7rem; }
  header p { margin:0 0 .25rem; color:var(--muted); max-width:70ch; }
  .count { color:var(--muted); font-size:.85rem; }
  .tier { margin-top:2.4rem; }
  .tier h2 { margin:0 0 .2rem; font-size:1.1rem; }
  .blurb { margin:0 0 1rem; color:var(--muted); max-width:74ch; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:.9rem; }
  .card { display:flex; flex-direction:column; gap:.4rem; background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:1rem 1.1rem; text-decoration:none; color:inherit; transition:border-color .12s, transform .12s; }
  .card:hover { border-color:var(--accent); transform:translateY(-2px); }
  .card-head { display:flex; align-items:center; gap:.5rem; }
  .ex { font-size:.72rem; letter-spacing:.06em; color:var(--muted); background:var(--panel2); border-radius:999px; padding:.1rem .5rem; }
  .badge { font-size:.68rem; border-radius:999px; padding:.1rem .5rem; font-weight:600; }
  .badge.dl { background:#3a2a12; color:#f0c674; }
  .badge.srv { background:#12293a; color:#7fc7ff; }
  .card h3 { margin:.1rem 0 0; font-size:1rem; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .card p { margin:0; color:var(--muted); font-size:.85rem; flex:1; }
  .open { color:var(--accent); font-size:.82rem; font-weight:600; }
  footer { margin-top:3rem; color:var(--muted); font-size:.8rem; }
  code { background:var(--panel2); padding:.05rem .35rem; border-radius:4px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${esc(m.title)}</h1>
      <p>${esc(m.subtitle)}</p>
      <p class="count">${count} examples · click any card to run it in the browser</p>
    </header>
    ${m.tiers.map(tier).join('\n')}
    <footer>
      Each example is a standalone Vite app importing only <code>@fortemi/*</code> names — copy any
      out and it runs on its own. Built with <code>pnpm examples:site</code>.
    </footer>
  </div>
</body>
</html>`
}
