import { useState, useCallback } from 'react'
import { NotesRepository, type NoteCreateInput, type NoteFull } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useCreateNote() {
  const { db, events } = useFortemiContext()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createNote = useCallback(async (input: NoteCreateInput): Promise<NoteFull> => {
    try {
      setLoading(true)
      const repo = new NotesRepository(db, events)
      const note = await repo.create(input)
      setError(null)
      return note
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db, events])

  return { createNote, loading, error }
}
