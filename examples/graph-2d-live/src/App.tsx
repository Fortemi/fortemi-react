// EX-03 · graph-2d-live
//
// `SigmaGraphView` from `@fortemi/react/graph-2d` is the interactive tier:
// Sigma + graphology ForceAtlas2, lazy-loaded so the heavy renderer only ships
// when mounted. It cold-seeds a settle, dims non-neighbors on hover, focuses on
// click, and re-anchors on ⌘/Ctrl-click — all built in. Data is a synthetic
// `CommunityGraph`; no database in the module graph.

import { useState } from 'react'
import { SigmaGraphView } from '@fortemi/react/graph-2d'
import type { CommunityPalette } from '@fortemi/graph'
import { mediumGraph, labelFor } from '@fortemi/examples-shared'

const PALETTES: { id: CommunityPalette; label: string }[] = [
  { id: 'community', label: 'community (qualitative)' },
  { id: 'greyscale', label: 'greyscale (by density)' },
]

export function App() {
  const [palette, setPalette] = useState<CommunityPalette>('community')
  const [minDegree, setMinDegree] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <main className="page">
      <header>
        <h1>EX-03 · graph-2d-live</h1>
        <p className="lede">
          Sigma + ForceAtlas2 via <code>SigmaGraphView</code>. Hover to dim non-neighbors, click to
          focus, <kbd>⌘</kbd>/<kbd>Ctrl</kbd>-click to re-anchor. The renderer is lazy-loaded — it
          only ships when this view mounts.
        </p>
      </header>

      <section className="layout">
        <div className="canvas" style={{ height: 480 }}>
          <SigmaGraphView
            graph={mediumGraph}
            palette={palette}
            filters={{ minDegree }}
            labelFor={labelFor}
            onSelectNode={setSelected}
            height={480}
          />
        </div>

        <aside className="controls">
          <div className="control">
            <span>Palette</span>
            <div className="chips column">
              {PALETTES.map((p) => (
                <label key={String(p.id)} className="radio">
                  <input
                    type="radio"
                    name="palette"
                    checked={palette === p.id}
                    onChange={() => setPalette(p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>

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
            <span>Last focused</span>
            <p className="selected">{selected ? labelFor(selected) : '— click a node —'}</p>
          </div>
        </aside>
      </section>
    </main>
  )
}
