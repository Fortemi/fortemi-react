import { useState } from 'react'
import { useNotes, useSearch, useCreateNote, useDeleteNote, useJobQueue } from '@fortemi/react'
import { NoteList } from '../components/NoteList'
import { NoteCreateForm } from '../components/NoteCreateForm'
import { NoteDetail } from '../components/NoteDetail'
import { SearchBar } from '../components/SearchBar'
import { SearchResults } from '../components/SearchResults'

export function NoteListPage() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const { data: noteData, loading: notesLoading } = useNotes({ sort: 'created_at', order: 'desc' })
  const { data: searchData, loading: searchLoading, search, clear } = useSearch()
  const { createNote } = useCreateNote()
  const { deleteNote, restoreNote } = useDeleteNote()
  const [searchQuery, setSearchQuery] = useState('')

  // Start the job queue worker (title generation, etc.)
  useJobQueue(2000)

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      await search(query)
    } else {
      clear()
    }
  }

  const handleCreate = async (content: string, title?: string, tags?: string[]) => {
    await createNote({ content, title, tags })
    setShowCreateForm(false)
  }

  // Note detail view
  if (selectedNoteId) {
    return (
      <NoteDetail
        noteId={selectedNoteId}
        onBack={() => setSelectedNoteId(null)}
      />
    )
  }

  const isSearching = searchQuery.trim().length > 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <SearchBar onSearch={handleSearch} />
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            padding: '8px 16px',
            background: '#4a9eff',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {showCreateForm ? 'Cancel' : '+ New Note'}
        </button>
      </div>

      {showCreateForm && (
        <NoteCreateForm onSubmit={handleCreate} onCancel={() => setShowCreateForm(false)} />
      )}

      {isSearching ? (
        <SearchResults
          data={searchData}
          loading={searchLoading}
          query={searchQuery}
          onSelect={setSelectedNoteId}
        />
      ) : (
        <NoteList
          data={noteData}
          loading={notesLoading}
          onDelete={deleteNote}
          onRestore={restoreNote}
          onSelect={setSelectedNoteId}
        />
      )}
    </div>
  )
}
