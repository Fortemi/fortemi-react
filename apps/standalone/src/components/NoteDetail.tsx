import { useState, useEffect, useCallback } from 'react'
import { NotesRepository, type NoteFull, type NoteRevision, enqueueJob, getJobQueueStatus, type JobStatus, type JobType, JOB_CAPABILITIES } from '@fortemi/core'
import { useNote, useUpdateNote, useDeleteNote, useFortemiContext } from '@fortemi/react'

interface NoteDetailProps {
  noteId: string
  onBack: () => void
}

export function NoteDetail({ noteId, onBack }: NoteDetailProps) {
  const { data: note, loading, error } = useNote(noteId)
  const { updateNote } = useUpdateNote()
  const { deleteNote, restoreNote } = useDeleteNote()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <p style={{ color: '#999' }}>Loading note...</p>
  if (error) return <p style={{ color: '#c00' }}>Error: {error.message}</p>
  if (!note) return <p style={{ color: '#999' }}>Note not found</p>

  const startEdit = () => {
    setEditContent(note.current.content)
    setEditTitle(note.title ?? '')
    setEditing(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      await updateNote(noteId, {
        title: editTitle || undefined,
        content: editContent,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <button onClick={onBack} style={{ cursor: 'pointer', padding: '4px 8px' }}>
          &larr; Back
        </button>
        <div style={{ flex: 1 }} />
        {!editing && (
          <button onClick={startEdit} style={{ cursor: 'pointer', padding: '4px 12px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: 4 }}>
            Edit
          </button>
        )}
        {note.deleted_at ? (
          <button onClick={() => restoreNote(noteId)} style={{ cursor: 'pointer', padding: '4px 12px' }}>
            Restore
          </button>
        ) : (
          <button onClick={() => deleteNote(noteId)} style={{ cursor: 'pointer', padding: '4px 12px', color: '#c00' }}>
            Delete
          </button>
        )}
      </div>

      {editing ? (
        <EditForm
          title={editTitle}
          content={editContent}
          onTitleChange={setEditTitle}
          onContentChange={setEditContent}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
          saving={saving}
        />
      ) : (
        <NoteView note={note} />
      )}
    </div>
  )
}

function NoteView({ note }: { note: NoteFull }) {
  const [showOriginal, setShowOriginal] = useState(false)

  return (
    <div>
      {/* Title + metadata */}
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>
        {note.title ?? 'Untitled'}
        {note.is_starred && <span title="Starred" style={{ marginLeft: 8, color: '#f5a623' }}>&#9733;</span>}
      </h2>

      <div style={{ color: '#999', fontSize: 12, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>Created {new Date(note.created_at).toLocaleString()}</span>
        <span>Updated {new Date(note.updated_at).toLocaleString()}</span>
        <span>Format: {note.format}</span>
        <span>Source: {note.source}</span>
        {note.is_archived && <span style={{ color: '#f5a623' }}>Archived</span>}
        {note.deleted_at && <span style={{ color: '#c00' }}>Deleted</span>}
      </div>

      {/* Tags */}
      {note.tags.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {note.tags.map((tag) => (
            <span key={tag} style={{ display: 'inline-block', background: '#e8f0fe', color: '#1a73e8', borderRadius: 4, padding: '2px 8px', fontSize: 12, marginRight: 4 }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Current content */}
      <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}>
        {note.current.content}
      </div>

      {/* Revision info panel */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#666' }}>Revision Info</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#666' }}>
          <span>Generation count:</span>
          <span style={{ fontWeight: 500 }}>{note.current.generation_count}</span>
          <span>User edited:</span>
          <span style={{ fontWeight: 500 }}>{note.current.is_user_edited ? 'Yes' : 'No'}</span>
          <span>Model:</span>
          <span style={{ fontWeight: 500 }}>{note.current.model ?? 'None'}</span>
          <span>Content hash:</span>
          <span style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: 11 }}>{note.original.content_hash.slice(0, 24)}...</span>
          <span>Current updated:</span>
          <span style={{ fontWeight: 500 }}>{new Date(note.current.updated_at).toLocaleString()}</span>
        </div>

        {note.current.ai_metadata != null && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#666' }}>AI Metadata</summary>
            <pre style={{ fontSize: 11, background: '#fff', padding: 8, borderRadius: 4, overflow: 'auto' }}>
              {JSON.stringify(note.current.ai_metadata, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* AI Actions + per-note job status */}
      <NoteAIActions noteId={note.id} />

      {/* Original content toggle */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowOriginal(!showOriginal)}
          style={{ cursor: 'pointer', fontSize: 12, color: '#4a9eff', background: 'none', border: 'none', padding: 0 }}
        >
          {showOriginal ? 'Hide original content' : 'Show original content'}
        </button>
        {showOriginal && (
          <div style={{ marginTop: 8, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: 16, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
              Original (immutable) &mdash; {new Date(note.original.created_at).toLocaleString()}
            </div>
            {note.original.content}
          </div>
        )}
      </div>

      {/* Revision history */}
      <RevisionPanel noteId={note.id} />

      {/* Note ID for debugging */}
      <div style={{ color: '#ccc', fontSize: 10, fontFamily: 'monospace' }}>
        ID: {note.id}
      </div>
    </div>
  )
}

function EditForm({ title, content, onTitleChange, onContentChange, onSave, onCancel, saving }: {
  title: string
  content: string
  onTitleChange: (v: string) => void
  onContentChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div style={{ border: '1px solid #4a9eff', borderRadius: 8, padding: 16 }}>
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Title"
        style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, fontSize: 16, boxSizing: 'border-box' }}
      />
      <textarea
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={12}
        style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, fontFamily: 'monospace', fontSize: 14, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSave} disabled={saving} style={{ padding: '6px 16px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {saving ? 'Saving...' : 'Save (creates revision)'}
        </button>
        <button onClick={onCancel} style={{ padding: '6px 16px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

function RevisionPanel({ noteId }: { noteId: string }) {
  const { db, events } = useFortemiContext()
  const [revisions, setRevisions] = useState<NoteRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRevision, setSelectedRevision] = useState<NoteRevision | null>(null)

  useEffect(() => {
    const repo = new NotesRepository(db, events)
    repo.getRevisions(noteId).then((r) => {
      setRevisions(r)
      setLoading(false)
    })

    const sub = events.on('note.updated', (e) => {
      if (e.id === noteId) {
        repo.getRevisions(noteId).then(setRevisions)
      }
    })
    return () => sub.dispose()
  }, [noteId, db, events])

  if (loading) return null
  if (revisions.length === 0) {
    return (
      <div style={{ color: '#999', fontSize: 12, marginBottom: 16 }}>
        No revision history yet. Edit the note to create a revision.
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#666' }}>
        Revision History ({revisions.length})
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {revisions.map((rev) => (
          <div
            key={rev.id}
            onClick={() => setSelectedRevision(selectedRevision?.id === rev.id ? null : rev)}
            style={{
              padding: '6px 8px',
              borderRadius: 4,
              background: selectedRevision?.id === rev.id ? '#e8f0fe' : '#fff',
              border: '1px solid #eee',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <strong>Rev #{rev.revision_number}</strong>
                <span style={{ marginLeft: 8, color: rev.type === 'ai' ? '#1a73e8' : '#666' }}>
                  ({rev.type})
                </span>
                {rev.model && <span style={{ marginLeft: 8, color: '#999' }}>{rev.model}</span>}
              </span>
              <span style={{ color: '#999' }}>{new Date(rev.created_at).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      {selectedRevision && (
        <div style={{ marginTop: 8, background: '#fff', border: '1px solid #ddd', borderRadius: 4, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13, maxHeight: 300, overflow: 'auto' }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
            Revision #{selectedRevision.revision_number} — {selectedRevision.type}
            {selectedRevision.model && ` — ${selectedRevision.model}`}
          </div>
          {selectedRevision.content}
        </div>
      )}
    </div>
  )
}

function AIJobButton({ label, jobType, enqueueing, onTrigger, capReady, capName, title }: {
  label: string
  jobType: JobType
  enqueueing: string | null
  onTrigger: (jobType: JobType, cap?: string | null) => void
  capReady?: boolean
  capName?: string
  title: string
}) {
  const needsCap = capName !== undefined
  const available = !needsCap || capReady
  return (
    <button
      onClick={() => onTrigger(jobType, JOB_CAPABILITIES[jobType] ?? null)}
      disabled={enqueueing === jobType}
      style={{
        padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #ccc',
        cursor: 'pointer', background: '#fff',
        opacity: available ? 1 : 0.6,
      }}
      title={title + (needsCap && !capReady ? ` (enable ${capName} in Settings — job will queue and wait)` : '')}
    >
      {enqueueing === jobType ? 'Queuing...' : label}
      {needsCap && !capReady && <span style={{ color: '#999', marginLeft: 4, fontSize: 10 }}>({capName})</span>}
    </button>
  )
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f5a623',
  processing: '#4a9eff',
  completed: '#34a853',
  failed: '#ea4335',
}

function NoteAIActions({ noteId }: { noteId: string }) {
  const { db, events, capabilityManager } = useFortemiContext()
  const [noteJobs, setNoteJobs] = useState<JobStatus[]>([])
  const [enqueueing, setEnqueueing] = useState<string | null>(null)

  const refresh = useCallback(() => {
    getJobQueueStatus(db, noteId).then(setNoteJobs).catch(() => {})
  }, [db, noteId])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    const sub1 = events.on('job.completed', (e) => { if (e.noteId === noteId) refresh() })
    const sub2 = events.on('job.failed', (e) => { if (e.noteId === noteId) refresh() })
    return () => {
      clearInterval(timer)
      sub1.dispose()
      sub2.dispose()
    }
  }, [refresh, events, noteId])

  const triggerJob = async (jobType: JobType, requiredCapability?: string | null) => {
    setEnqueueing(jobType)
    try {
      await enqueueJob(db, { noteId, jobType, requiredCapability })
      refresh()
    } finally {
      setEnqueueing(null)
    }
  }

  const semanticReady = capabilityManager.isReady('semantic')
  const llmReady = capabilityManager.isReady('llm')

  const pendingOrProcessing = noteJobs.filter((j) => j.status === 'pending' || j.status === 'processing')
  const recentCompleted = noteJobs.filter((j) => j.status === 'completed').slice(0, 3)
  const recentFailed = noteJobs.filter((j) => j.status === 'failed').slice(0, 3)

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f0f4ff' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#444' }}>AI Actions</h4>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <AIJobButton
          label="Generate Title"
          jobType="title_generation"
          enqueueing={enqueueing}
          onTrigger={triggerJob}
          title="Extract or generate title (LLM if available, fallback to first-line)"
        />
        <AIJobButton
          label="AI Revision"
          jobType="ai_revision"
          enqueueing={enqueueing}
          onTrigger={triggerJob}
          capReady={llmReady}
          capName="LLM"
          title="LLM enhances note content, creates a revision record"
        />
        <AIJobButton
          label="Generate Embedding"
          jobType="embedding"
          enqueueing={enqueueing}
          onTrigger={triggerJob}
          capReady={semanticReady}
          capName="Semantic"
          title="Generate vector embedding for semantic search and linking"
        />
        <AIJobButton
          label="Concept Tagging"
          jobType="concept_tagging"
          enqueueing={enqueueing}
          onTrigger={triggerJob}
          capReady={llmReady}
          capName="LLM"
          title="Extract topic tags from content using LLM"
        />
        <AIJobButton
          label="Find Links"
          jobType="linking"
          enqueueing={enqueueing}
          onTrigger={triggerJob}
          title="Discover semantically related notes (requires embedding)"
        />
      </div>
      <div style={{ fontSize: 10, color: '#999', marginBottom: 4 }}>
        Jobs requiring capabilities will queue and run when the capability is enabled in Settings.
      </div>

      {/* Active / recent jobs for this note */}
      {(pendingOrProcessing.length > 0 || recentCompleted.length > 0 || recentFailed.length > 0) && (
        <div style={{ fontSize: 11, marginTop: 4 }}>
          {pendingOrProcessing.map((j) => (
            <div key={j.id} style={{ color: STATUS_COLORS[j.status], padding: '2px 0' }}>
              {j.status === 'processing' ? '\u2699' : '\u23f3'} {j.job_type} — {j.status}
              {j.retry_count > 0 && ` (retry ${j.retry_count}/${j.max_retries})`}
            </div>
          ))}
          {recentCompleted.map((j) => (
            <div key={j.id} style={{ color: STATUS_COLORS.completed, padding: '2px 0' }}>
              \u2713 {j.job_type} — completed {new Date(j.updated_at).toLocaleTimeString()}
            </div>
          ))}
          {recentFailed.map((j) => (
            <div key={j.id} style={{ color: STATUS_COLORS.failed, padding: '2px 0' }}>
              \u2717 {j.job_type} — failed: {j.error?.slice(0, 80)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
