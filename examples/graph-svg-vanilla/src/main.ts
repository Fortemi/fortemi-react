// EX-01 · graph-svg-vanilla
//
// The smallest possible proof that the fortemi graph stack is framework-agnostic:
// build a `CommunityGraph` by hand, hand it to `renderCommunityGraph`, done.
// No React, no PGlite, no server, no model download. This is the exact renderer
// the package ships — you get layout, zoom/pan, and hover for free.

import { renderCommunityGraph, communityLegend } from '@fortemi/graph'
import type { CommunityGraph } from '@fortemi/graph'

// Human labels for our node ids (kept next to the graph so it reads clearly).
const LABELS: Record<string, string> = {
  'capture-notes': 'notes',
  'capture-editor': 'editor',
  'capture-tags': 'tags',
  'capture-collections': 'collections',
  'graph-layout': 'layout',
  'graph-render': 'render',
  'graph-view': 'view',
  'graph-controls': 'controls',
  'store-worker': 'worker',
  'store-pglite': 'pglite',
  'store-shard': 'shard',
  'store-blob': 'blob',
}

// A CommunityGraph is just three arrays: nodes (identity), edges (source→target
// with a weight), and communities (which node ids belong together). Authoring
// one by hand is entirely reasonable — this is the whole data model.
const graph: CommunityGraph = {
  nodes: Object.keys(LABELS).map((id) => ({ id })),
  edges: [
    // capture cluster
    { source: 'capture-notes', target: 'capture-editor', weight: 3 },
    { source: 'capture-notes', target: 'capture-tags', weight: 2 },
    { source: 'capture-notes', target: 'capture-collections', weight: 2 },
    { source: 'capture-editor', target: 'capture-tags', weight: 1 },
    // graph cluster
    { source: 'graph-layout', target: 'graph-render', weight: 3 },
    { source: 'graph-render', target: 'graph-view', weight: 3 },
    { source: 'graph-view', target: 'graph-controls', weight: 2 },
    { source: 'graph-layout', target: 'graph-controls', weight: 1 },
    // store cluster
    { source: 'store-worker', target: 'store-pglite', weight: 3 },
    { source: 'store-pglite', target: 'store-shard', weight: 2 },
    { source: 'store-shard', target: 'store-blob', weight: 2 },
    { source: 'store-worker', target: 'store-blob', weight: 1 },
    // bridges between clusters
    { source: 'capture-notes', target: 'store-pglite', weight: 1, kind: 'persists' },
    { source: 'graph-render', target: 'capture-collections', weight: 1, kind: 'reads' },
    { source: 'store-shard', target: 'graph-view', weight: 1, kind: 'feeds' },
  ],
  communities: [
    { id: 'capture', nodes: ['capture-notes', 'capture-editor', 'capture-tags', 'capture-collections'] },
    { id: 'graph', nodes: ['graph-layout', 'graph-render', 'graph-view', 'graph-controls'] },
    { id: 'store', nodes: ['store-worker', 'store-pglite', 'store-shard', 'store-blob'] },
  ],
}

const container = document.getElementById('graph')
if (!container) throw new Error('missing #graph container')
const mount = container

// The SVG background follows the page theme via the `--graph-bg` CSS variable.
// Community node colors read clearly on both light and dark, so swapping the
// background is all the graph needs — re-rendered whenever the shared theme
// toggle (in index.html) fires a `themechange` event.
const graphBg = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--graph-bg').trim() || '#faf8f4'

function renderGraph() {
  return renderCommunityGraph(mount, graph, {
    width: 760,
    height: 460,
    background: graphBg(),
    labelFor: (id) => LABELS[id] ?? id,
  })
}

let handle = renderGraph()
window.addEventListener('themechange', () => {
  handle.destroy()
  handle = renderGraph()
})

// The same `communityLegend` helper every renderer tier uses — sorted by size,
// colors matching the rendered nodes.
const legend = document.getElementById('legend')
if (legend) {
  legend.innerHTML = communityLegend(graph)
    .map(
      (row) =>
        `<span><i class="swatch" style="background:${row.color}"></i>${row.communityId} · ${row.count} nodes</span>`,
    )
    .join('')
}
