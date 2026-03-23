import { useState, useEffect, useCallback } from 'react'
import { NotesRepository, type NoteSummary, type NoteListOptions, type PaginatedResult } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useNotes(options: NoteListOptions = {}) {
  const { db, events } = useFortemiContext()
  const [data, setData] = useState<PaginatedResult<NoteSummary> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const repo = new NotesRepository(db, events)
      const result = await repo.list(options)
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [db, events, JSON.stringify(options)])

  useEffect(() => {
    void refresh()

    // Re-fetch when notes change
    const subs = [
      events.on('note.created', refresh),
      events.on('note.updated', refresh),
      events.on('note.deleted', refresh),
      events.on('note.restored', refresh),
      // Refresh when jobs complete — title generation, ai_revision, etc. modify note data
      events.on('job.completed', refresh),
    ]
    return () => subs.forEach(s => s.dispose())
  }, [refresh, events])

  return { data, loading, error, refresh }
}
