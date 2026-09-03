import { useState, useEffect } from 'react'
import type { DatabaseClient } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface ProvenanceEvent {
  timestamp: Date
  type: 'created' | 'job' | 'revision' | 'provenance'
  label: string
  detail?: string
  agent?: string
  activity?: string
  attributes?: Record<string, unknown> | null
}

export async function loadNoteProvenanceEvents(
  db: DatabaseClient,
  noteId: string,
): Promise<ProvenanceEvent[]> {
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

  // 2. Stored W3C PROV-style edges.
  const provResult = await db.query<{
    activity: string
    agent: string
    started_at: Date
    ended_at: Date | null
    attributes: Record<string, unknown> | string | null
  }>(
    `SELECT activity, agent, started_at, ended_at, attributes
     FROM provenance_edge
     WHERE entity_type = 'note' AND entity_id = $1
     ORDER BY started_at ASC`,
    [noteId],
  )
  for (const edge of provResult.rows) {
    const attributes = parseAttributes(edge.attributes)
    allEvents.push({
      timestamp: new Date(edge.started_at),
      type: 'provenance',
      label: formatProvenanceActivity(edge.activity),
      detail: summarizeProvenance(edge.activity, edge.agent, attributes),
      agent: edge.agent,
      activity: edge.activity,
      attributes,
    })
  }

  // 3. Completed jobs
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

  // 4. User revisions
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

  return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

export function useNoteProvenance(noteId: string) {
  const { db, events: eventBus } = useFortemiContext()
  const [provenanceEvents, setEvents] = useState<ProvenanceEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setEvents(await loadNoteProvenanceEvents(db, noteId))
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

function parseAttributes(value: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }
  return value
}

function formatProvenanceActivity(activity: string): string {
  const labels: Record<string, string> = {
    'prov:Create': 'PROV create',
    'prov:Generate': 'PROV generate',
    'prov:Derive': 'PROV derive',
    'prov:Revision': 'PROV revision',
    'prov:Ingest': 'PROV ingest',
  }
  return labels[activity] ?? activity
}

function summarizeProvenance(
  activity: string,
  agent: string,
  attributes: Record<string, unknown> | null,
): string {
  const parts = [`Agent: ${agent}`]
  const entity = getString(attributes, 'prov:entity') ?? getString(attributes, 'entity')
  const source = getString(attributes, 'prov:wasDerivedFrom') ?? getString(attributes, 'source')
  const confidence = getString(attributes, 'confidence')
  if (entity) parts.push(`Entity: ${entity}`)
  if (source) parts.push(`Derived from: ${source}`)
  if (confidence) parts.push(`Confidence: ${confidence}`)
  if (parts.length === 1 && activity) parts.push(activity)
  return parts.join(' · ')
}

function getString(attributes: Record<string, unknown> | null, key: string): string | undefined {
  const value = attributes?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
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
