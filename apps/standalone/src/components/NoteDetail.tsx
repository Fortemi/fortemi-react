import { useState, useEffect, useCallback } from 'react'
import { NotesRepository, type NoteFull, type NoteRevision, enqueueJob, enqueueFullWorkflow, getJobQueueStatus, type JobStatus, type JobType, JOB_CAPABILITIES } from '@fortemi/core'
import { useNote, useUpdateNote, useDeleteNote, useFortemiContext, useRelatedNotes, useNoteConcepts, useNoteProvenance } from '@fortemi/react'

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
      {/* Title */}
      <h2 style={{ margin: '0 0 12px', fontSize: 22 }}>
        {note.title ?? 'Untitled'}
        {note.is_starred && <span title="Starred" style={{ marginLeft: 8, color: '#f5a623' }}>&#9733;</span>}
      </h2>

      {/* Metadata panel (#91) */}
      <MetadataPanel note={note} />

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

      {/* Concepts panel (#92) */}
      <ConceptsPanel noteId={note.id} />

      {/* Current content */}
      <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 16, marginBottom: 16, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}>
        {note.current.content}
      </div>

      {/* Related notes panel (#90) */}
      <RelatedNotesPanel noteId={note.id} />

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

      {/* Provenance panel (#93) */}
      <ProvenancePanel noteId={note.id} />

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

function MetadataPanel({ note }: { note: NoteFull }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyId = () => {
    navigator.clipboard.writeText(note.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <details open={expanded} style={{ marginBottom: 12 }} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 8 }}>
        Metadata
      </summary>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12, color: '#666', background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 8, padding: 12 }}>
        <span>Format:</span><span style={{ fontWeight: 500 }}>{note.format}</span>
        <span>Visibility:</span><span style={{ fontWeight: 500 }}>{note.visibility}</span>
        <span>Source:</span><span style={{ fontWeight: 500 }}>{note.source}</span>
        <span>Archive:</span><span style={{ fontWeight: 500 }}>{note.archive_id ?? 'default'}</span>
        <span>Revision mode:</span><span style={{ fontWeight: 500 }}>{note.revision_mode}</span>
        <span>Starred:</span><span style={{ fontWeight: 500 }}>{note.is_starred ? 'Yes' : 'No'}</span>
        <span>Archived:</span><span style={{ fontWeight: 500 }}>{note.is_archived ? 'Yes' : 'No'}</span>
        <span>Pinned:</span><span style={{ fontWeight: 500 }}>{note.is_pinned ? 'Yes' : 'No'}</span>
        <span>Created:</span><span style={{ fontWeight: 500 }}>{new Date(note.created_at).toLocaleString()}</span>
        <span>Updated:</span><span style={{ fontWeight: 500 }}>{new Date(note.updated_at).toLocaleString()}</span>
        <span>ID:</span>
        <span style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: 11 }}>
          {note.id.slice(0, 18)}...
          <button onClick={copyId} style={{ marginLeft: 4, fontSize: 10, cursor: 'pointer', background: 'none', border: '1px solid #ccc', borderRadius: 3, padding: '1px 4px' }}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </span>
      </div>
    </details>
  )
}

function ConceptsPanel({ noteId }: { noteId: string }) {
  const { concepts, loading } = useNoteConcepts(noteId)

  if (loading) return null
  if (concepts.length === 0) return null

  return (
    <details open style={{ marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 8 }}>
        Concepts ({concepts.length})
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {concepts.map((c) => (
          <div key={c.conceptId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: '#f0f4ff', borderRadius: 4 }}>
            <span style={{ color: '#999', fontSize: 10, minWidth: 60 }}>[{c.schemeName}]</span>
            <span style={{ fontWeight: 500 }}>{c.prefLabel}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

function RelatedNotesPanel({ noteId, onNavigate }: { noteId: string; onNavigate?: (id: string) => void }) {
  const { links, loading } = useRelatedNotes(noteId)

  if (loading) return null

  return (
    <details open style={{ marginBottom: 16 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 8 }}>
        Related Notes ({links.length})
      </summary>
      {links.length === 0 ? (
        <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
          No related notes yet. Click &ldquo;Find Links&rdquo; to discover connections.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {links.map((link) => (
            <div
              key={link.noteId}
              onClick={() => onNavigate?.(link.noteId)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid #eee', borderRadius: 6, cursor: onNavigate ? 'pointer' : 'default', transition: 'border-color 0.15s' }}
              onMouseEnter={(e) => { if (onNavigate) e.currentTarget.style.borderColor = '#4a9eff' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#eee' }}
            >
              {link.confidence != null && (
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#666', minWidth: 36 }}>
                  {link.confidence.toFixed(2)}
                </span>
              )}
              <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{link.title ?? 'Untitled'}</span>
              <span style={{ fontSize: 10, color: '#999', background: '#f0f0f0', borderRadius: 3, padding: '1px 5px' }}>
                {link.linkType}
              </span>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}

function ProvenancePanel({ noteId }: { noteId: string }) {
  const { events: provEvents, loading } = useNoteProvenance(noteId)

  if (loading) return null
  if (provEvents.length === 0) return null

  const typeColors: Record<string, string> = {
    created: '#34a853',
    job: '#4a9eff',
    revision: '#f5a623',
  }

  return (
    <details style={{ marginBottom: 16 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 8 }}>
        Provenance ({provEvents.length} events)
      </summary>
      <div style={{ borderLeft: '2px solid #e0e0e0', paddingLeft: 12 }}>
        {provEvents.map((evt, i) => (
          <div key={i} style={{ fontSize: 12, marginBottom: 6, display: 'flex', gap: 8 }}>
            <span style={{ color: '#999', fontFamily: 'monospace', fontSize: 11, minWidth: 50, flexShrink: 0 }}>
              {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ color: typeColors[evt.type] ?? '#666', fontWeight: 500 }}>
              {evt.label}
            </span>
            {evt.detail && (
              <span style={{ color: '#999' }}>&mdash; {evt.detail}</span>
            )}
          </div>
        ))}
      </div>
    </details>
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

  const triggerFullWorkflow = async () => {
    setEnqueueing('full_workflow')
    try {
      await enqueueFullWorkflow(db, noteId)
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
        <button
          onClick={triggerFullWorkflow}
          disabled={enqueueing === 'full_workflow'}
          style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4,
            border: 'none', cursor: 'pointer',
            background: '#34a853', color: 'white',
          }}
          title="Run all 5 jobs in order: Revision → Title → Embedding → Concepts → Links"
        >
          {enqueueing === 'full_workflow' ? 'Queuing...' : 'Full Workflow'}
        </button>
        <span style={{ borderLeft: '1px solid #ccc', margin: '0 2px' }} />
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
