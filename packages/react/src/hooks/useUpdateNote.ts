import { useState, useCallback } from 'react'
import { NotesRepository, type NoteUpdateInput, type NoteFull } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useUpdateNote() {
  const { db, events } = useFortemiContext()
  const [loading, setLoading] = useState(false)

  const updateNote = useCallback(async (id: string, input: NoteUpdateInput): Promise<NoteFull> => {
    setLoading(true)
    try {
      const repo = new NotesRepository(db, events)
      return await repo.update(id, input)
    } finally {
      setLoading(false)
    }
  }, [db, events])

  return { updateNote, loading }
}
