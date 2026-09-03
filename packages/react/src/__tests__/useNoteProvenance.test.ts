import { describe, expect, it, vi } from 'vitest'
import type { DatabaseClient, QueryResult } from '@fortemi/core'
import { loadNoteProvenanceEvents } from '../hooks/useNoteProvenance.js'

function result<T>(rows: T[]): QueryResult<T> {
  return { rows }
}

describe('loadNoteProvenanceEvents', () => {
  it('loads stored PROV edges with parsed attributes and chronological history', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(params).toEqual(['note-1'])
      if (sql.includes('FROM note WHERE')) {
        return result([{ created_at: new Date('2026-07-17T12:00:00Z') }])
      }
      if (sql.includes('FROM provenance_edge')) {
        return result([{
          activity: 'prov:Derive',
          agent: 'demo:citation-linker',
          started_at: new Date('2026-07-17T12:03:00Z'),
          ended_at: new Date('2026-07-17T12:03:00Z'),
          attributes: JSON.stringify({
            'prov:entity': 'citation:rag->dpr',
            'prov:wasDerivedFrom': 'paper:dpr',
            confidence: 'reviewed',
          }),
        }])
      }
      if (sql.includes('FROM job_queue')) {
        return result([{
          job_type: 'embedding',
          status: 'completed',
          updated_at: new Date('2026-07-17T12:02:00Z'),
          result: '{"dimensions":1024}',
        }])
      }
      if (sql.includes('FROM note_revision')) {
        return result([{
          revision_number: 2,
          type: 'ai',
          model: 'review-model',
          created_at: new Date('2026-07-17T12:04:00Z'),
        }])
      }
      throw new Error(`Unexpected query: ${sql}`)
    })
    const db = { query } as unknown as DatabaseClient

    const events = await loadNoteProvenanceEvents(db, 'note-1')

    expect(events.map((event) => event.type)).toEqual([
      'created',
      'job',
      'provenance',
      'revision',
    ])
    expect(events[2]).toMatchObject({
      label: 'PROV derive',
      agent: 'demo:citation-linker',
      activity: 'prov:Derive',
      detail: 'Agent: demo:citation-linker · Entity: citation:rag->dpr · Derived from: paper:dpr · Confidence: reviewed',
      attributes: {
        'prov:entity': 'citation:rag->dpr',
        'prov:wasDerivedFrom': 'paper:dpr',
        confidence: 'reviewed',
      },
    })
    expect(query).toHaveBeenCalledTimes(4)
  })

  it('keeps malformed optional metadata from hiding a provenance edge', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM provenance_edge')) {
        return result([{
          activity: 'custom:Transform',
          agent: 'demo:custom-agent',
          started_at: new Date('2026-07-17T12:00:00Z'),
          ended_at: null,
          attributes: '{not-json',
        }])
      }
      return result([])
    })
    const db = { query } as unknown as DatabaseClient

    const events = await loadNoteProvenanceEvents(db, 'note-2')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'provenance',
      label: 'custom:Transform',
      detail: 'Agent: demo:custom-agent · custom:Transform',
      attributes: null,
    })
  })
})
