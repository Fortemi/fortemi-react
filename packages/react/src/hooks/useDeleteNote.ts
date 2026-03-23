import { useCallback } from 'react'
import { NotesRepository } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useDeleteNote() {
  const { db, events } = useFortemiContext()

  const deleteNote = useCallback(async (id: string) => {
    const repo = new NotesRepository(db, events)
    await repo.delete(id)
  }, [db, events])

  const restoreNote = useCallback(async (id: string) => {
    const repo = new NotesRepository(db, events)
    return repo.restore(id)
  }, [db, events])

  return { deleteNote, restoreNote }
}
