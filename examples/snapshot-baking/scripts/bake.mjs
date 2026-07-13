// EX-05 · build-time layout baking.
//
// Runs in Node BEFORE the page is served (see the `prebuild`/`predev` scripts).
// It lays the graph out ONCE with `bakeRenderGraph`, then writes a render-ready
// snapshot — nodes carrying baked x/y — to `public/graph-snapshot.json`. The
// page then loads that snapshot and renders instantly, with no runtime layout.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bakeRenderGraph, stringifyRenderGraph, hasBakedPositions } from '@fortemi/graph'

// A compact deterministic CommunityGraph, built inline so this script depends
// only on @fortemi/graph (identical seed ⇒ identical layout ⇒ stable snapshot).
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeGraph({ communities = 5, per = 8, seed = 42 } = {}) {
  const rng = mulberry32(seed)
  const nodes = []
  const communityDefs = []
  const seen = new Set()
  const edges = []
  const add = (s, t) => {
    if (s === t) return
    const k = s < t ? `${s} ${t}` : `${t} ${s}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ source: s, target: t, weight: 1 + Math.round(rng() * 3) })
  }
  for (let c = 0; c < communities; c++) {
    const members = []
    for (let i = 0; i < per; i++) {
      const id = `n-${c}-${i}`
      nodes.push({ id })
      members.push(id)
    }
    for (let i = 1; i < members.length; i++) add(members[i - 1], members[i])
    for (let i = 0; i < members.length; i++)
      for (let j = i + 2; j < members.length; j++) if (rng() < 0.28) add(members[i], members[j])
    communityDefs.push({ id: `c-${c}`, nodes: members })
  }
  for (let b = 0; b < communities; b++) {
    const ca = Math.floor(rng() * communities)
    let cb = Math.floor(rng() * communities)
    if (cb === ca) cb = (cb + 1) % communities
    add(`n-${ca}-${Math.floor(rng() * per)}`, `n-${cb}-${Math.floor(rng() * per)}`)
  }
  return { nodes, edges, communities: communityDefs }
}

const graph = makeGraph()
const rendered = bakeRenderGraph(graph, {
  palette: 'community',
  layout: { width: 720, height: 460, seed: 42, ticks: 300 },
})

if (!hasBakedPositions(rendered)) {
  console.error('bake failed: snapshot has no baked positions')
  process.exit(1)
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'graph-snapshot.json')
writeFileSync(outPath, stringifyRenderGraph(rendered))

console.log(
  `baked ${rendered.nodes.length} nodes / ${rendered.links.length} links / ${rendered.clusters} clusters → public/graph-snapshot.json`,
)
