import type { SearchResponse } from '@fortemi/core'

interface SearchResultsProps {
  data: SearchResponse | null
  loading: boolean
  query: string
  onSelect: (id: string) => void
}

const MODE_LABELS: Record<string, string> = {
  text: 'text search',
  semantic: 'semantic search',
  hybrid: 'hybrid search',
}

export function SearchResults({ data, loading, query, onSelect }: SearchResultsProps) {
  if (loading) return <p style={{ color: '#999' }}>Searching...</p>
  if (!data) return null
  if (data.results.length === 0) {
    return <p style={{ color: '#999' }}>No results for &ldquo;{query}&rdquo;</p>
  }

  const modeLabel = MODE_LABELS[data.mode] ?? data.mode

  return (
    <div>
      <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
        {data.total} result{data.total !== 1 ? 's' : ''} via {modeLabel}
      </p>
      {data.results.map((result) => (
        <div
          key={result.id}
          onClick={() => onSelect(result.id)}
          style={{
            padding: 12,
            border: '1px solid #eee',
            borderRadius: 8,
            marginBottom: 8,
            cursor: 'pointer',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#4a9eff' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#eee' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                color: '#666',
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: 600,
                minWidth: 40,
                flexShrink: 0,
              }}
            >
              {result.rank.toFixed(2)}
            </span>
            <strong style={{ flex: 1 }}>{result.title ?? 'Untitled'}</strong>
            {result.has_embedding && (
              <span
                style={{
                  display: 'inline-block',
                  background: '#e8f5e9',
                  color: '#2e7d32',
                  borderRadius: 4,
                  padding: '1px 5px',
                  fontSize: 10,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                E
              </span>
            )}
          </div>
          <div
            style={{ color: '#666', fontSize: 13, marginTop: 4 }}
            dangerouslySetInnerHTML={{ __html: result.snippet }}
          />
          {result.tags.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {result.tags.map((tag) => (
                <span key={tag} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', fontSize: 11, marginRight: 4 }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
