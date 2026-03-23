import type { NoteSummary, PaginatedResult } from '@fortemi/core'

interface NoteListProps {
  data: PaginatedResult<NoteSummary> | null
  loading: boolean
  onDelete: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<unknown>
}

export function NoteList({ data, loading, onDelete, onRestore }: NoteListProps) {
  if (loading && !data) return <p style={{ color: '#999' }}>Loading notes...</p>
  if (!data || data.items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
        <p>No notes yet. Create your first note!</p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
        {data.total} note{data.total !== 1 ? 's' : ''}
      </p>
      {data.items.map((note) => (
        <div
          key={note.id}
          style={{
            padding: 12,
            border: '1px solid #eee',
            borderRadius: 8,
            marginBottom: 8,
            opacity: note.deleted_at ? 0.5 : 1,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong>{note.title ?? 'Untitled'}</strong>
              {note.is_starred && <span title="Starred" style={{ marginLeft: 4 }}>*</span>}
              {note.deleted_at && <span style={{ marginLeft: 8, color: '#c00', fontSize: 12 }}>(deleted)</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
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
            <div style={{ marginTop: 4 }}>
              {note.tags.map((tag) => (
                <span key={tag} style={{ display: 'inline-block', background: '#f0f0f0', borderRadius: 4, padding: '2px 6px', fontSize: 11, marginRight: 4 }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div style={{ color: '#999', fontSize: 11, marginTop: 4 }}>
            {new Date(note.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  )
}
