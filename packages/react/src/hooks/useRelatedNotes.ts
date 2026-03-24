import { useState, useEffect } from 'react'
import { LinksRepository, NotesRepository } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface RelatedNote {
  noteId: string
  title: string | null
  confidence: number | null
  linkType: string
  direction: 'outbound' | 'inbound'
}

export function useRelatedNotes(noteId: string, limit = 3) {
  const { db, events } = useFortemiContext()
  const [links, setLinks] = useState<RelatedNote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const linksRepo = new LinksRepository(db)
      const notesRepo = new NotesRepository(db, events)
      const { outbound, inbound } = await linksRepo.listForNote(noteId)

      // Merge outbound + inbound, dedup by target note
      const seen = new Set<string>()
      const merged: RelatedNote[] = []

      for (const link of outbound) {
        if (seen.has(link.target_note_id) || link.target_note_id === noteId) continue
        seen.add(link.target_note_id)
        merged.push({
          noteId: link.target_note_id,
          title: null,
          confidence: link.confidence,
          linkType: link.link_type,
          direction: 'outbound',
        })
      }
      for (const link of inbound) {
        if (seen.has(link.source_note_id) || link.source_note_id === noteId) continue
        seen.add(link.source_note_id)
        merged.push({
          noteId: link.source_note_id,
          title: null,
          confidence: link.confidence,
          linkType: link.link_type,
          direction: 'inbound',
        })
      }

      // Sort by confidence descending (nulls last), take top N
      merged.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
      const top = merged.slice(0, limit)

      // Fetch titles
      for (const item of top) {
        try {
          const note = await notesRepo.get(item.noteId)
          item.title = note.title
        } catch {
          // Note may have been deleted
        }
      }

      setLinks(top)
      setLoading(false)
    }
    load()

    // Refresh when linking job completes
    const sub = events.on('job.completed', (e) => {
      if (e.noteId === noteId && e.type === 'linking') load()
    })
    return () => sub.dispose()
  }, [noteId, db, events, limit])

  return { links, loading }
}
