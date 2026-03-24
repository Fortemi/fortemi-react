import { useState, useEffect } from 'react'
import { useFortemiContext } from '../FortemiProvider.js'

export interface ProvenanceEvent {
  timestamp: Date
  type: 'created' | 'job' | 'revision'
  label: string
  detail?: string
}

export function useNoteProvenance(noteId: string) {
  const { db, events: eventBus } = useFortemiContext()
  const [provenanceEvents, setEvents] = useState<ProvenanceEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const allEvents: ProvenanceEvent[] = []

      // 1. Note creation
      const noteResult = await db.query<{ created_at: Date }>(
        'SELECT created_at FROM note WHERE id = $1',
        [noteId],
      )
      if (noteResult.rows[0]) {
        allEvents.push({
          timestamp: new Date(noteResult.rows[0].created_at),
          type: 'created',
          label: 'Created by user',
        })
      }

      // 2. Completed jobs
      const jobResult = await db.query<{
        job_type: string
        status: string
        updated_at: Date
        result: string | null
      }>(
        `SELECT job_type, status, updated_at, result::text FROM job_queue
         WHERE note_id = $1 AND status = 'completed'
         ORDER BY updated_at ASC`,
        [noteId],
      )
      for (const job of jobResult.rows) {
        let detail: string | undefined
        try {
          if (job.result) {
            const parsed = typeof job.result === 'string' ? JSON.parse(job.result) : job.result
            detail = summarizeJobResult(job.job_type, parsed)
          }
        } catch { /* ignore parse errors */ }
        allEvents.push({
          timestamp: new Date(job.updated_at),
          type: 'job',
          label: formatJobType(job.job_type),
          detail,
        })
      }

      // 3. User revisions
      const revResult = await db.query<{
        revision_number: number
        type: string
        model: string | null
        created_at: Date
      }>(
        `SELECT revision_number, type, model, created_at FROM note_revision
         WHERE note_id = $1
         ORDER BY created_at ASC`,
        [noteId],
      )
      for (const rev of revResult.rows) {
        allEvents.push({
          timestamp: new Date(rev.created_at),
          type: 'revision',
          label: rev.type === 'user' ? `User edit (revision #${rev.revision_number})` : `AI revision #${rev.revision_number}`,
          detail: rev.model ? `Model: ${rev.model}` : undefined,
        })
      }

      // Sort chronologically
      allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      setEvents(allEvents)
      setLoading(false)
    }
    load()

    // Refresh on any job completion for this note
    const sub = eventBus.on('job.completed', (e) => {
      if (e.noteId === noteId) load()
    })
    // note: event field is `type` not `jobType` per EventBus schema
    return () => sub.dispose()
  }, [noteId, db, eventBus])

  return { events: provenanceEvents, loading }
}

function formatJobType(type: string): string {
  const labels: Record<string, string> = {
    title_generation: 'Title generation',
    embedding: 'Embedding',
    concept_tagging: 'Concept tagging',
    linking: 'Find links',
    ai_revision: 'AI revision',
  }
  return labels[type] ?? type
}

function summarizeJobResult(jobType: string, result: Record<string, unknown>): string {
  switch (jobType) {
    case 'title_generation':
      return result.title ? `"${result.title}"` : 'No title generated'
    case 'embedding':
      return result.dimensions ? `${result.dimensions}-dim vector` : 'Embedded'
    case 'concept_tagging':
      return result.concepts_added ? `${result.concepts_added} concepts` : 'Tagged'
    case 'linking':
      return result.links_created ? `${result.links_created} links found` : 'No new links'
    case 'ai_revision':
      return result.model ? `via ${result.model}` : 'Revised'
    default:
      return ''
  }
}
