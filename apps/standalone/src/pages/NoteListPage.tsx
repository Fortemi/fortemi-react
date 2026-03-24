import { useState, useCallback } from 'react'
import { enqueueFullWorkflow } from '@fortemi/core'
import { useNotes, useSearch, useCreateNote, useDeleteNote, useJobQueue, useFortemiContext } from '@fortemi/react'
import { NoteList } from '../components/NoteList'
import { NoteCreateForm } from '../components/NoteCreateForm'
import { NoteDetail } from '../components/NoteDetail'
import { SearchBar } from '../components/SearchBar'
import { SearchResults } from '../components/SearchResults'
import { JobQueuePanel } from '../components/JobQueuePanel'

type SearchMode = 'auto' | 'text' | 'semantic' | 'hybrid'

export function NoteListPage({ onShowExamples }: { onShowExamples?: () => void }) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [searchMode, setSearchMode] = useState<SearchMode>('auto')
  const { data: noteData, loading: notesLoading } = useNotes({ sort: 'created_at', order: 'desc' })
  const { data: searchData, loading: searchLoading, search, clear } = useSearch()
  const { createNote } = useCreateNote()
  const { deleteNote, restoreNote } = useDeleteNote()
  const [searchQuery, setSearchQuery] = useState('')
  const { db, capabilityManager } = useFortemiContext()
  const semanticReady = capabilityManager.isReady('semantic')

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)

  // Start the job queue worker (title generation, etc.)
  useJobQueue(2000)

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      await search(query, { mode: searchMode })
    } else {
      clear()
    }
  }, [search, clear, searchMode])

  const handleModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
  }, [])

  const handleCreate = async (content: string, title?: string, tags?: string[]) => {
    await createNote({ content, title, tags })
    setShowCreateForm(false)
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (noteData) {
      setSelectedIds(new Set(noteData.items.map((n) => n.id)))
    }
  }, [noteData])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBatchWorkflow = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBatchRunning(true)
    try {
      for (const noteId of selectedIds) {
        await enqueueFullWorkflow(db, noteId)
      }
      setSelectedIds(new Set())
    } finally {
      setBatchRunning(false)
    }
  }, [selectedIds, db])

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
        <SearchBar
          onSearch={handleSearch}
          onModeChange={handleModeChange}
          mode={searchMode}
          semanticReady={semanticReady}
        />
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

      <JobQueuePanel />

      {onShowExamples && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={onShowExamples}
            style={{ fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', color: '#4a9eff', padding: 0 }}
          >
            View example applications &rarr;
          </button>
        </div>
      )}

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
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onBatchWorkflow={handleBatchWorkflow}
          batchRunning={batchRunning}
        />
      )}
    </div>
  )
}
