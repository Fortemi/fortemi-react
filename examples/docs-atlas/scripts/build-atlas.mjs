// EX-17 · build-time atlas bake.
//
// Runs in Node BEFORE the page is served (predev / prebuild). It reads the
// markdown corpus, derives a tag-similarity CommunityGraph, lays it out ONCE
// with bakeRenderGraph, and writes two static artifacts the runtime fetches:
//   public/atlas-snapshot.json — RenderGraph with baked x/y (no runtime layout)
//   public/atlas-docs.json     — [{ id, title, tags, html }] for the reader
// The only build dependency is @fortemi/graph; the runtime never touches PGlite.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bakeRenderGraph, stringifyRenderGraph, hasBakedPositions } from '@fortemi/graph'

const here = dirname(fileURLToPath(import.meta.url))
const corpusDir = join(here, '..', 'corpus')
const outDir = join(here, '..', 'public')

// --- frontmatter + tiny markdown → HTML (no dependency) ---------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function parseFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  const meta = {}
  let body = raw
  if (m) {
    body = raw.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = /^(\w+):\s*(.*)$/.exec(line.trim())
      if (kv) meta[kv[1]] = kv[2]
    }
  }
  return { meta, body }
}

function inline(text) {
  // escape first, then apply inline markup on the escaped string
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) =>
    `<a href="#${href}" data-doc="${href}">${t}</a>`)
  return s
}

function renderMarkdown(md) {
  const lines = md.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++ // closing fence
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`)
      i++
      continue
    }
    if (/^-\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^-\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (line.trim() === '') { i++; continue }
    // paragraph: gather until blank line
    const para = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|-\s|```)/.test(lines[i])) {
      para.push(lines[i++])
    }
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }
  return out.join('\n')
}

// --- read corpus ------------------------------------------------------------

const files = readdirSync(corpusDir).filter((f) => f.endsWith('.md')).sort()
const docs = files.map((file) => {
  const id = file.replace(/\.md$/, '')
  const { meta, body } = parseFrontmatter(readFileSync(join(corpusDir, file), 'utf8'))
  const tags = (meta.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  return { id, title: meta.title ?? id, tags, html: renderMarkdown(body) }
})

// --- tag-similarity CommunityGraph ------------------------------------------

const nodes = docs.map((d) => ({ id: d.id }))
const edges = []
for (let a = 0; a < docs.length; a++) {
  for (let b = a + 1; b < docs.length; b++) {
    const shared = docs[a].tags.filter((t) => docs[b].tags.includes(t))
    if (shared.length > 0) {
      edges.push({ source: docs[a].id, target: docs[b].id, weight: shared.length, kind: shared[0] })
    }
  }
}
const communityMap = new Map()
for (const d of docs) {
  const key = d.tags[0] ?? 'untagged'
  communityMap.set(key, [...(communityMap.get(key) ?? []), d.id])
}
const communities = [...communityMap.entries()].map(([tag, ids]) => ({ id: `tag-${tag}`, nodes: ids }))
const graph = { nodes, edges, communities }

// --- bake + write -----------------------------------------------------------

const titleById = new Map(docs.map((d) => [d.id, d.title]))
const rendered = bakeRenderGraph(graph, {
  palette: 'community',
  layout: { width: 760, height: 520, seed: 42, ticks: 320 },
  labelFor: (id) => titleById.get(id) ?? id,
})
if (!hasBakedPositions(rendered)) {
  console.error('bake failed: snapshot has no baked positions')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'atlas-snapshot.json'), stringifyRenderGraph(rendered))
writeFileSync(join(outDir, 'atlas-docs.json'), JSON.stringify(docs))

console.log(
  `atlas: ${docs.length} docs → ${rendered.nodes.length} nodes / ${rendered.links.length} links / ${rendered.clusters} clusters → public/`,
)
