import { useMemo, useState } from 'react'
import type { EmbeddingSetCriteria, EmbeddingSetSelector, VirtualEmbeddingSetDefinition } from '@fortemi/core'
import { GraphView, useEmbeddingSets, useSimilarityGraph } from '@fortemi/react'

type SourceFilter = 'any' | 'user' | 'docs-seed' | 'import' | 'api' | 'mcp'
type VisibilityFilter = 'any' | 'private' | 'public'
type EnrichmentFilter = 'any' | 'user-edited' | 'generated' | 'revised' | 'starred' | 'untitled'

const SELECT_STYLE = {
  padding: '6px 8px',
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
} as const

const LABEL_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#666',
} as const

function buildCriteria(
  source: SourceFilter,
  visibility: VisibilityFilter,
  enrichment: EnrichmentFilter,
  query: string,
): EmbeddingSetCriteria {
  const criteria: EmbeddingSetCriteria = {}
  if (source !== 'any') criteria.sources = [source]
  if (visibility !== 'any') criteria.visibilities = [visibility]
  if (query.trim()) criteria.query = query.trim()
  if (enrichment === 'user-edited') criteria.isUserEdited = true
  if (enrichment === 'generated') criteria.minGenerationCount = 1
  if (enrichment === 'revised') criteria.hasRevisions = true
  if (enrichment === 'starred') criteria.isStarred = true
  if (enrichment === 'untitled') criteria.hasTitle = false
  return criteria
}

function hasCriteria(criteria: EmbeddingSetCriteria): boolean {
  return Object.keys(criteria).length > 0
}

function virtualDefinition(baseSetId: string, criteria: EmbeddingSetCriteria): VirtualEmbeddingSetDefinition {
  return {
    id: `standalone-graph-${baseSetId}`,
    name: 'Filtered graph selection',
    purpose: 'Ad hoc graph selector from standalone property filters',
    source: { type: 'criteria', baseSetId, criteria },
    compatibility: {
      model: 'require-same',
      dimension: 'require-same',
      duplicateVectors: 'prefer-latest',
      missingVectors: 'omit',
    },
    materialization: {
      allowed: false,
      freshness: 'unknown',
    },
  }
}

export function GraphPage({ onBack }: { onBack: () => void }) {
  const { embeddingSets, loading: setsLoading } = useEmbeddingSets()
  const physicalSets = embeddingSets.filter((set) => set.kind === 'physical')
  const [baseSetId, setBaseSetId] = useState('')
  const [source, setSource] = useState<SourceFilter>('any')
  const [visibility, setVisibility] = useState<VisibilityFilter>('any')
  const [enrichment, setEnrichment] = useState<EnrichmentFilter>('any')
  const [query, setQuery] = useState('')
  const [k, setK] = useState(5)
  const [minSimilarity, setMinSimilarity] = useState(0.2)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const selectedBaseSetId = baseSetId || physicalSets[0]?.id || ''
  const criteria = useMemo(() => buildCriteria(source, visibility, enrichment, query), [source, visibility, enrichment, query])
  const selector = useMemo<EmbeddingSetSelector | null>(() => {
    if (!selectedBaseSetId) return null
    if (!hasCriteria(criteria)) return { kind: 'embedding-set', embeddingSetId: selectedBaseSetId }
    return { kind: 'virtual-definition', definition: virtualDefinition(selectedBaseSetId, criteria) }
  }, [selectedBaseSetId, criteria])

  const { graph, graphSource, cache, freshness, loading, error, refresh, recompute } = useSimilarityGraph(selector, {
    k,
    minSimilarity,
    autoRefresh: false,
  })

  const criteriaCount = Object.keys(criteria).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Graph</h2>
        <button
          onClick={onBack}
          style={{ fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', color: '#4a9eff', padding: 0 }}
        >
          &larr; Back to notes
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        <label style={LABEL_STYLE}>
          Vector set
          <select
            value={selectedBaseSetId}
            disabled={setsLoading || physicalSets.length === 0}
            onChange={(event) => setBaseSetId(event.target.value)}
            style={SELECT_STYLE}
          >
            {physicalSets.length === 0 ? <option value="">No vectors yet</option> : null}
            {physicalSets.map((set) => (
              <option key={set.id} value={set.id}>{set.name}</option>
            ))}
          </select>
        </label>
        <label style={LABEL_STYLE}>
          Source
          <select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)} style={SELECT_STYLE}>
            <option value="any">Any source</option>
            <option value="user">User</option>
            <option value="docs-seed">Project docs</option>
            <option value="import">Import</option>
            <option value="api">API</option>
            <option value="mcp">MCP</option>
          </select>
        </label>
        <label style={LABEL_STYLE}>
          Visibility
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as VisibilityFilter)} style={SELECT_STYLE}>
            <option value="any">Any visibility</option>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label style={LABEL_STYLE}>
          Enrichment
          <select value={enrichment} onChange={(event) => setEnrichment(event.target.value as EnrichmentFilter)} style={SELECT_STYLE}>
            <option value="any">Any state</option>
            <option value="user-edited">User edited</option>
            <option value="generated">Generated</option>
            <option value="revised">Has revisions</option>
            <option value="starred">Starred</option>
            <option value="untitled">Untitled</option>
          </select>
        </label>
        <label style={LABEL_STYLE}>
          Contains
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Optional text"
            style={SELECT_STYLE}
          />
        </label>
        <label style={LABEL_STYLE}>
          Neighbors
          <input
            type="number"
            min={1}
            max={20}
            value={k}
            onChange={(event) => setK(Number(event.target.value))}
            style={SELECT_STYLE}
          />
        </label>
        <label style={LABEL_STYLE}>
          Similarity
          <input
            type="number"
            min={-1}
            max={1}
            step={0.05}
            value={minSimilarity}
            onChange={(event) => setMinSimilarity(Number(event.target.value))}
            style={SELECT_STYLE}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => void refresh()}
          disabled={!selector || loading}
          style={{ padding: '7px 12px', border: 'none', borderRadius: 6, background: '#4a9eff', color: '#fff', cursor: selector && !loading ? 'pointer' : 'not-allowed', opacity: selector && !loading ? 1 : 0.5 }}
        >
          {loading ? 'Building...' : 'Build graph'}
        </button>
        <button
          onClick={() => void recompute()}
          disabled={!selector || loading}
          style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', color: '#333', cursor: selector && !loading ? 'pointer' : 'not-allowed', opacity: selector && !loading ? 1 : 0.5 }}
        >
          Recompute
        </button>
        <span style={{ fontSize: 12, color: '#666' }}>
          {criteriaCount > 0 ? `${criteriaCount} vector filter${criteriaCount === 1 ? '' : 's'}` : 'Full vector set'}
          {cache ? ` · ${cache}` : ''}
          {freshness ? ` · ${freshness}` : ''}
        </span>
      </div>

      {error ? (
        <div role="alert" style={{ padding: 12, border: '1px solid #f2c2c2', borderRadius: 6, background: '#fff6f6', color: '#9b1c1c', marginBottom: 12 }}>
          {error.message}
        </div>
      ) : null}

      <GraphView
        graph={graph}
        layout={{ algorithm: 'community' }}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        height={520}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, color: '#666', fontSize: 12 }}>
        <span>{graph ? `${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.communities.length} communities` : 'Build a graph from embedded notes.'}</span>
        <span>{selectedNodeId ? `Selected ${selectedNodeId}` : graphSource?.name ?? ''}</span>
      </div>
    </div>
  )
}
