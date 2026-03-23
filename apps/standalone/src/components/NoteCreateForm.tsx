import { useState } from 'react'

interface NoteCreateFormProps {
  onSubmit: (content: string, title?: string, tags?: string[]) => Promise<void>
  onCancel: () => void
}

export function NoteCreateForm({ onSubmit, onCancel }: NoteCreateFormProps) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean)
      await onSubmit(content, title || undefined, tags.length > 0 ? tags : undefined)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Note content (markdown)"
        rows={6}
        required
        style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, fontFamily: 'monospace', boxSizing: 'border-box' }}
      />
      <input
        type="text"
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        placeholder="Tags (comma-separated)"
        style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={submitting || !content.trim()}
          style={{ padding: '8px 16px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {submitting ? 'Creating...' : 'Create Note'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}
