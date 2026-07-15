// EX-04 · graph-3d-orbit
//
// `ForceGraph3DView` from `@fortemi/react/graph-3d` renders the same synthetic
// `CommunityGraph` as a 3D force-directed graph (three.js via
// react-force-graph-3d). Three is loaded lazily through `React.lazy` so it only
// ships when this view mounts. Drag to orbit, scroll to zoom, click to select.

import { useState } from 'react'
import {
  GraphModeToggle,
  GraphNodeSummary,
  ThemeToggle,
  useThemeMode,
  graphThemeFor,
  type GraphMode,
} from '@fortemi/examples-shared/ui'
import { GraphView } from '@fortemi/react/graph'
import { ForceGraph3DView } from '@fortemi/react/graph-3d'
import type { CommunityPalette } from '@fortemi/graph'
import { mediumGraph, labelFor } from '@fortemi/examples-shared'

const PALETTES: { id: CommunityPalette; label: string }[] = [
  { id: 'community', label: 'community' },
  { id: 'greyscale', label: 'greyscale' },
]

export function App() {
  const [palette, setPalette] = useState<CommunityPalette>('community')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('3d')

  const themeMode = useThemeMode()
  const graphTheme = graphThemeFor(themeMode)

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-04 · graph-3d-orbit</h1>
        <p className="lede">
          The same graph in 3D via <code>ForceGraph3DView</code>. Drag to orbit, scroll to zoom,
          click a node to select. three.js is lazy-loaded — it only ships when this view mounts.
        </p>
      </header>

      <section className="layout">
        <div className={mode === '3d' ? 'canvas dark' : 'canvas'} style={{ height: 500 }}>
          {mode === '3d' ? (
            <ForceGraph3DView
              graph={mediumGraph}
              palette={palette}
              labelFor={labelFor}
              onSelectNode={setSelected}
              theme={graphTheme.force3d}
              height={500}
            />
          ) : (
            <GraphView
              graph={mediumGraph}
              layout={{ algorithm: 'force' }}
              selectedNodeId={selected}
              onSelectNode={setSelected}
              labelFor={labelFor}
              width={720}
              height={500}
            />
          )}
        </div>

        <aside className="controls">
          <div className="control">
            <span>Dimension</span>
            <GraphModeToggle mode={mode} onModeChange={setMode} />
          </div>

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

          <div className="control">
            <span>Selected</span>
            {selected ? (
              <GraphNodeSummary
                graph={mediumGraph}
                nodeId={selected}
                labelFor={labelFor}
                onClose={() => setSelected(null)}
              />
            ) : (
              <p className="selected">— click a node —</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  )
}
