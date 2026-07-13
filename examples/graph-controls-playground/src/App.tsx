// EX-09 · graph-controls-playground
//
// The reusable-controls showcase. One control panel drives the SHARED filter
// contract (`GraphControlFilters`) — community show/hide, edge-kind, minimum
// degree — over one synthetic dataset, and you can switch the renderer between
// the static `GraphView`, the interactive Sigma tier, and the 3D tier without
// rewiring. Each tier honors the same `filters` object; palette, layout
// algorithm, and node-dragging are shown where the tier supports them.

import { useMemo, useState } from 'react'
import { GraphView } from '@fortemi/react/graph'
import { SigmaGraphView } from '@fortemi/react/graph-2d'
import { ForceGraph3DView } from '@fortemi/react/graph-3d'
import { communityLegend } from '@fortemi/graph'
import type { CommunityPalette, GraphControlFilters, GraphLayoutAlgorithm } from '@fortemi/graph'
import { mediumGraph, labelFor } from '@fortemi/examples-shared'

type Tier = 'static' | 'sigma' | 'three'
const EDGE_KINDS = ['link', 'ref', 'tag'] as const
const ALGORITHMS: GraphLayoutAlgorithm[] = ['force', 'radial', 'community']

export function App() {
  const [tier, setTier] = useState<Tier>('static')
  const [minDegree, setMinDegree] = useState(0)
  const [palette, setPalette] = useState<CommunityPalette>('community')
  const [algorithm, setAlgorithm] = useState<GraphLayoutAlgorithm>('force')
  const [draggable, setDraggable] = useState(false)
  const [hiddenCommunities, setHiddenCommunities] = useState<Set<string>>(() => new Set())
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)

  const legend = useMemo(() => communityLegend(mediumGraph), [])

  // One filters object, honored identically by all three renderer tiers.
  const filters: GraphControlFilters = useMemo(() => {
    const f: GraphControlFilters = { minDegree }
    if (hiddenCommunities.size > 0) {
      f.communityIds = legend
        .map((r) => r.communityId)
        .filter((id) => !hiddenCommunities.has(id))
    }
    if (hiddenKinds.size > 0) {
      f.edgeKinds = EDGE_KINDS.filter((k) => !hiddenKinds.has(k))
    }
    return f
  }, [minDegree, hiddenCommunities, hiddenKinds, legend])

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  return (
    <main className="page wide">
      <header>
        <h1>EX-09 · graph-controls-playground</h1>
        <p className="lede">
          One control panel, one dataset, three renderers. The community / edge-kind / minimum-degree
          filters are the <em>shared</em> <code>GraphControlFilters</code> contract — switch tiers and
          the same filter object keeps working.
        </p>
      </header>

      <div className="tier-tabs">
        {(['static', 'sigma', 'three'] as Tier[]).map((t) => (
          <button key={t} className={tier === t ? 'tab on' : 'tab'} onClick={() => setTier(t)}>
            {t === 'static' ? 'GraphView (SVG)' : t === 'sigma' ? 'Sigma (2D)' : 'three.js (3D)'}
          </button>
        ))}
      </div>

      <section className="layout">
        <div className={tier === 'three' ? 'canvas dark' : 'canvas'} style={{ height: 500 }}>
          {tier === 'static' && (
            <GraphView
              graph={mediumGraph}
              filters={filters}
              layout={{ algorithm }}
              draggableNodes={draggable}
              selectedNodeId={selected}
              onSelectNode={setSelected}
              labelFor={labelFor}
              width={720}
              height={500}
            />
          )}
          {tier === 'sigma' && (
            <SigmaGraphView
              graph={mediumGraph}
              filters={filters}
              palette={palette}
              labelFor={labelFor}
              onSelectNode={setSelected}
              height={500}
            />
          )}
          {tier === 'three' && (
            <ForceGraph3DView
              graph={mediumGraph}
              filters={filters}
              palette={palette}
              labelFor={labelFor}
              onSelectNode={setSelected}
              theme={{ background: '#14120f' }}
              height={500}
            />
          )}
        </div>

        <aside className="controls">
          <label className="control">
            <span>Minimum degree: {minDegree}</span>
            <input
              type="range"
              min={0}
              max={6}
              value={minDegree}
              onChange={(e) => setMinDegree(Number(e.target.value))}
            />
          </label>

          <div className="control">
            <span>Communities</span>
            <div className="chips">
              {legend.map((row) => (
                <button
                  key={row.communityId}
                  className={hiddenCommunities.has(row.communityId) ? 'chip off' : 'chip'}
                  onClick={() => setHiddenCommunities((s) => toggle(s, row.communityId))}
                >
                  <i className="swatch" style={{ background: row.color }} />
                  {row.communityId}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <span>Edge kinds</span>
            <div className="chips">
              {EDGE_KINDS.map((k) => (
                <button
                  key={k}
                  className={hiddenKinds.has(k) ? 'chip off' : 'chip'}
                  onClick={() => setHiddenKinds((s) => toggle(s, k))}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {(tier === 'sigma' || tier === 'three') && (
            <div className="control">
              <span>Palette</span>
              <div className="chips column">
                {(['community', 'greyscale'] as CommunityPalette[]).map((p) => (
                  <label key={String(p)} className="radio">
                    <input
                      type="radio"
                      name="palette"
                      checked={palette === p}
                      onChange={() => setPalette(p)}
                    />
                    {String(p)}
                  </label>
                ))}
              </div>
            </div>
          )}

          {tier === 'static' && (
            <>
              <div className="control">
                <span>Layout algorithm</span>
                <div className="chips column">
                  {ALGORITHMS.map((a) => (
                    <label key={a} className="radio">
                      <input
                        type="radio"
                        name="algorithm"
                        checked={algorithm === a}
                        onChange={() => setAlgorithm(a)}
                      />
                      {a}
                    </label>
                  ))}
                </div>
              </div>
              <label className="radio">
                <input type="checkbox" checked={draggable} onChange={(e) => setDraggable(e.target.checked)} />
                Draggable nodes (drag to pin, shift-click to release)
              </label>
            </>
          )}

          <div className="control">
            <span>Selected</span>
            <p className="selected">{selected ? labelFor(selected) : '— click a node —'}</p>
          </div>
        </aside>
      </section>
    </main>
  )
}
