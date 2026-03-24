import type { NoteSummary, PaginatedResult } from '@fortemi/core'

interface NoteListProps {
  data: PaginatedResult<NoteSummary> | null
  loading: boolean
  onDelete: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<unknown>
  onSelect: (id: string) => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onSelectAll?: () => void
  onDeselectAll?: () => void
  onBatchWorkflow?: () => void
  batchRunning?: boolean
}

export function NoteList({
  data, loading, onDelete, onRestore, onSelect,
  selectedIds, onToggleSelect, onSelectAll, onDeselectAll, onBatchWorkflow, batchRunning,
}: NoteListProps) {
  if (loading && !data) return <p style={{ color: '#999' }}>Loading notes...</p>
  if (!data || data.items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
        <p>No notes yet. Create your first note!</p>
      </div>
    )
  }

  const hasSelection = selectedIds && selectedIds.size > 0
  const allSelected = selectedIds && data.items.every((n) => selectedIds.has(n.id))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
          {data.total} note{data.total !== 1 ? 's' : ''}
        </p>
        {onToggleSelect && (
          <>
            <button
              onClick={allSelected ? onDeselectAll : onSelectAll}
              style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid #ccc', borderRadius: 3, padding: '2px 6px', color: '#666' }}
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            {hasSelection && onBatchWorkflow && (
              <button
                onClick={onBatchWorkflow}
                disabled={batchRunning}
                style={{
                  fontSize: 11, cursor: 'pointer', borderRadius: 3, padding: '2px 8px',
                  background: '#34a853', color: 'white', border: 'none', fontWeight: 600,
                }}
                title="Run full workflow (Title → Revision → Embedding → Concepts → Links) on all selected notes"
              >
                {batchRunning ? 'Queuing...' : `Workflow (${selectedIds!.size})`}
              </button>
            )}
          </>
        )}
      </div>
      {data.items.map((note) => (
        <div
          key={note.id}
          style={{
            padding: 12,
            border: selectedIds?.has(note.id) ? '1px solid #4a9eff' : '1px solid #eee',
            borderRadius: 8,
            marginBottom: 8,
            opacity: note.deleted_at ? 0.5 : 1,
            cursor: 'pointer',
            transition: 'border-color 0.15s',
            background: selectedIds?.has(note.id) ? '#f0f7ff' : undefined,
          }}
          onMouseEnter={(e) => { if (!selectedIds?.has(note.id)) e.currentTarget.style.borderColor = '#4a9eff' }}
          onMouseLeave={(e) => { if (!selectedIds?.has(note.id)) e.currentTarget.style.borderColor = '#eee' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }} onClick={() => onSelect(note.id)}>
              {onToggleSelect && (
                <input
                  type="checkbox"
                  checked={selectedIds?.has(note.id) ?? false}
                  onChange={(e) => { e.stopPropagation(); onToggleSelect(note.id) }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'pointer', accentColor: '#4a9eff' }}
                />
              )}
              <div>
                <strong>{note.title ?? 'Untitled'}</strong>
                {note.is_starred && <span title="Starred" style={{ marginLeft: 4, color: '#f5a623' }}>&#9733;</span>}
                {note.is_archived && <span style={{ marginLeft: 8, color: '#f5a623', fontSize: 12 }}>(archived)</span>}
                {note.deleted_at && <span style={{ marginLeft: 8, color: '#c00', fontSize: 12 }}>(deleted)</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
              {note.deleted_at ? (
                <button onClick={() => onRestore(note.id)} style={{ fontSize: 12, cursor: 'pointer' }}>
                  Restore
                </button>
              ) : (
                <button onClick={() => onDelete(note.id)} style={{ fontSize: 12, cursor: 'pointer', color: '#c00' }}>
                  Delete
                </button>
              )}
            </div>
          </div>
          {note.tags.length > 0 && (
            <div style={{ marginTop: 4, marginLeft: onToggleSelect ? 28 : 0 }}>
              {note.tags.map((tag) => (
                <span key={tag} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', fontSize: 11, marginRight: 4 }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div style={{ color: '#999', fontSize: 11, marginTop: 4, marginLeft: onToggleSelect ? 28 : 0 }}>
            {new Date(note.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  )
}
