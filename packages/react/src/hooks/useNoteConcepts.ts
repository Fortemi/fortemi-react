import { useState, useEffect } from 'react'
import { useFortemiContext } from '../FortemiProvider.js'

export interface NoteConcept {
  conceptId: string
  prefLabel: string
  schemeName: string
  schemeId: string
}

export function useNoteConcepts(noteId: string) {
  const { db, events } = useFortemiContext()
  const [concepts, setConcepts] = useState<NoteConcept[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      // Query note_skos_tag join skos_concept join skos_scheme
      const result = await db.query<{
        concept_id: string
        pref_label: string
        scheme_id: string
        scheme_title: string
      }>(
        `SELECT nst.concept_id, sc.pref_label, sc.scheme_id, ss.title as scheme_title
         FROM note_skos_tag nst
         JOIN skos_concept sc ON sc.id = nst.concept_id AND sc.deleted_at IS NULL
         JOIN skos_scheme ss ON ss.id = sc.scheme_id AND ss.deleted_at IS NULL
         WHERE nst.note_id = $1
         ORDER BY sc.pref_label`,
        [noteId],
      )
      setConcepts(result.rows.map((r) => ({
        conceptId: r.concept_id,
        prefLabel: r.pref_label,
        schemeName: r.scheme_title,
        schemeId: r.scheme_id,
      })))
      setLoading(false)
    }
    load()

    const sub = events.on('job.completed', (e) => {
      if (e.noteId === noteId && e.type === 'concept_tagging') load()
    })
    return () => sub.dispose()
  }, [noteId, db, events])

  return { concepts, loading }
}
