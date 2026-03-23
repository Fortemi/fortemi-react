import { useState, useEffect } from 'react'
import { NotesRepository, type NoteFull } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useNote(id: string | null) {
  const { db, events } = useFortemiContext()
  const [data, setData] = useState<NoteFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!id) { setData(null); setLoading(false); return }

    let cancelled = false
    const repo = new NotesRepository(db, events)

    const load = async () => {
      try {
        setLoading(true)
        const note = await repo.get(id)
        if (!cancelled) { setData(note); setError(null) }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const sub1 = events.on('note.updated', (e) => { if (e.id === id) void load() })
    // Reload when jobs complete (title generation, ai_revision, etc.)
    const sub2 = events.on('job.completed', (e) => { if (e.noteId === id) void load() })
    return () => { cancelled = true; sub1.dispose(); sub2.dispose() }
  }, [id, db, events])

  return { data, loading, error }
}
