// EX-02 · graph-view-static
//
// `GraphView` from `@fortemi/react/graph` is the PGlite-free React SVG view: it
// takes a `CommunityGraph`, lays it out, and renders it with selection, hover
// labels, and the shared filter contract — no database in the module graph.

import { useMemo, useState } from 'react'
import { GraphView } from '@fortemi/react/graph'
import { communityLegend } from '@fortemi/graph'
import { mediumGraph, labelFor } from '@fortemi/examples-shared'

export function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [minDegree, setMinDegree] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())

  const legend = useMemo(() => communityLegend(mediumGraph), [])

  // The shared filter contract: `communityIds` is an allow-list, so to hide a
  // community we pass every community *except* the hidden ones.
  const visibleCommunityIds = legend.map((row) => row.communityId).filter((id) => !hidden.has(id))
  const allVisible = hidden.size === 0

  const toggleCommunity = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <main className="page">
      <header>
        <h1>EX-02 · graph-view-static</h1>
        <p className="lede">
          The PGlite-free <code>GraphView</code>. Click a node to select it; drag the canvas to pan;
          use the controls to filter by community or minimum degree.
        </p>
      </header>

      <section className="layout">
        <div className="canvas">
          <GraphView
            graph={mediumGraph}
            layout={{ algorithm: 'force' }}
            filters={{
              minDegree,
              communityIds: allVisible ? undefined : visibleCommunityIds,
            }}
            selectedNodeId={selected}
            onSelectNode={setSelected}
            labelFor={labelFor}
            width={720}
            height={460}
          />
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
                  className={hidden.has(row.communityId) ? 'chip off' : 'chip'}
                  onClick={() => toggleCommunity(row.communityId)}
                >
                  <i className="swatch" style={{ background: row.color }} />
                  {row.communityId} · {row.count}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <span>Selected</span>
            <p className="selected">{selected ? labelFor(selected) : '— nothing selected —'}</p>
          </div>
        </aside>
      </section>
    </main>
  )
}
