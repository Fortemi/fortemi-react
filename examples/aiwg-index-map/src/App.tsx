// EX-11 · aiwg-index-map
//
// An AIWG artifact index (agents, commands, rules, skills, docs) is just another
// CommunityGraph source. `useAiwgIndex(sampleIndex)` holds a static export;
// `toCommunityGraph()` turns it into nodes + relationship edges + type-based
// communities, which `GraphView` renders directly. `search()` filters the same
// graph. No database boots — no FortemiProvider, so PGlite never runs.

import { useMemo, useState } from 'react'
import {
  GraphModeToggle,
  Graph3DLazy,
  ThemeToggle,
  useThemeMode,
  graphThemeFor,
  type GraphMode,
} from '@fortemi/examples-shared/ui'
import { GraphView } from '@fortemi/react/graph'
import { useAiwgIndex } from '@fortemi/react'
import type { AiwgFortemiRecord } from '@fortemi/core/aiwg-index'
import { sampleIndex } from './index-fixture.js'

type Layout = 'force' | 'community' | 'radial'

export function App() {
  const { index, counts, data, search, toCommunityGraph } = useAiwgIndex(sampleIndex)

  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<Layout>('community')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('2d')
  const themeMode = useThemeMode()
  const graphTheme = graphThemeFor(themeMode)

  // The index → CommunityGraph projection. Communities are `type:<kind>` because
  // the records carry no concepts; the graph legend becomes the artifact taxonomy.
  const graph = useMemo(() => toCommunityGraph(), [toCommunityGraph])

  const byId = useMemo(() => {
    const m = new Map<string, AiwgFortemiRecord>()
    index?.items.forEach((r) => m.set(r.id, r))
    return m
  }, [index])

  const labelFor = (id: string) => byId.get(id)?.title ?? id

  // Matched ids from the last search — spotlight them in the graph and the list.
  const matchedIds = useMemo(
    () => (data && query.trim() ? data.items.map((r) => r.id) : null),
    [data, query],
  )

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    search(query, { rank: true })
  }
  const clear = () => { setQuery(''); search('') }

  const record = selected ? byId.get(selected) : null
  const totalTypes = Object.keys(counts).length

  return (
    <main className="page wide">
      <ThemeToggle floating />
      <header>
        <h1>EX-11 · aiwg-index-map</h1>
        <p className="lede">
          An AIWG artifact index is a graph source. <code>useAiwgIndex(sampleIndex)</code> holds a
          static export; <code>toCommunityGraph()</code> projects it to nodes, relationship edges,
          and <strong>type-based communities</strong>; <code>search()</code> filters it. No database —
          nothing boots.
        </p>
      </header>

      <div className="row counts">
        {Object.entries(counts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([type, n]) => (
            <span key={type} className="chip">{type} · {n}</span>
          ))}
        <span className="muted">{index?.items.length ?? 0} artifacts · {totalTypes} kinds</span>
      </div>

      <form className="search-bar" onSubmit={onSearch}>
        <input
          placeholder='Search the index… (try "security" or "sdlc")'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">Search</button>
        {matchedIds && (
          <button type="button" className="ghost" onClick={clear}>
            Clear ({matchedIds.length})
          </button>
        )}
        <span className="spacer" />
        <label className="ctrl">
          Layout
          <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
            <option value="community">community</option>
            <option value="force">force</option>
            <option value="radial">radial</option>
          </select>
        </label>
      </form>

      <section className="split">
        <div className="canvas" style={{ position: 'relative' }}>
          <GraphModeToggle
            mode={mode}
            onModeChange={setMode}
            style={{ margin: 8 }}
          />
          {mode === '2d' ? (
            <GraphView
              graph={graph}
              layout={{ algorithm: layout }}
              filters={{ nodeIds: matchedIds ?? undefined }}
              selectedNodeId={selected}
              onSelectNode={setSelected}
              labelFor={labelFor}
              width={640}
              height={460}
            />
          ) : (
            <Graph3DLazy
              graph={graph}
              filters={{ nodeIds: matchedIds ?? undefined }}
              labelFor={labelFor}
              onSelectNode={setSelected}
              theme={graphTheme.force3d}
              height={460}
            />
          )}
        </div>

        <aside className="detail">
          {record ? (
            <>
              <span className="chip small">{record.type}</span>
              <strong>{record.title}</strong>
              <p className="muted mono">{record.source.repo_relative_path}</p>
              {record.tags.length > 0 && (
                <div className="chips">
                  {record.tags.map((t) => (
                    <span key={t} className="chip small">{t}</span>
                  ))}
                </div>
              )}
              {record.relationships.length > 0 && (
                <ul className="rels">
                  {record.relationships.map((r, i) => (
                    <li key={i}>
                      <code>{r.type}</code> → {labelFor(r.target_id)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="selected">Select a node to inspect the artifact and its relationships.</p>
          )}
        </aside>
      </section>
    </main>
  )
}
