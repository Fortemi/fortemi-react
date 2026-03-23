import { useState, useEffect, useCallback } from 'react'
import type { JobStatus } from '@fortemi/core'
import { getJobQueueStatus } from '@fortemi/core'
import { useFortemiContext } from '@fortemi/react'

const STATUS_COLORS: Record<string, string> = {
  pending: '#f5a623',
  processing: '#4a9eff',
  completed: '#34a853',
  failed: '#ea4335',
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23f3',     // hourglass
  processing: '\u2699',  // gear
  completed: '\u2713',   // check
  failed: '\u2717',      // cross
}

export function JobQueuePanel() {
  const { db, events } = useFortemiContext()
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(() => {
    getJobQueueStatus(db).then(setJobs).catch(() => {})
  }, [db])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)
    const sub1 = events.on('job.completed', refresh)
    const sub2 = events.on('job.failed', refresh)
    return () => {
      clearInterval(timer)
      sub1.dispose()
      sub2.dispose()
    }
  }, [refresh, events])

  const pending = jobs.filter((j) => j.status === 'pending').length
  const processing = jobs.filter((j) => j.status === 'processing').length
  const failed = jobs.filter((j) => j.status === 'failed').length
  const completed = jobs.filter((j) => j.status === 'completed').length

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
      >
        <h4 style={{ margin: 0, fontSize: 13, color: '#666' }}>
          Job Queue
        </h4>
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          {processing > 0 && <span style={{ color: STATUS_COLORS.processing }}>{processing} running</span>}
          {pending > 0 && <span style={{ color: STATUS_COLORS.pending }}>{pending} pending</span>}
          {failed > 0 && <span style={{ color: STATUS_COLORS.failed }}>{failed} failed</span>}
          {jobs.length === 0 && <span style={{ color: '#999' }}>Empty</span>}
          {jobs.length > 0 && pending === 0 && processing === 0 && failed === 0 && (
            <span style={{ color: STATUS_COLORS.completed }}>{completed} done</span>
          )}
          <span style={{ color: '#999' }}>{expanded ? '\u25b2' : '\u25bc'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
          {jobs.length === 0 ? (
            <p style={{ color: '#999', fontSize: 12, margin: '8px 0 0' }}>No jobs in queue</p>
          ) : (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#999', textAlign: 'left', borderBottom: '1px solid #eee' }}>
                  <th style={{ padding: '4px 6px' }}>Status</th>
                  <th style={{ padding: '4px 6px' }}>Type</th>
                  <th style={{ padding: '4px 6px' }}>Note</th>
                  <th style={{ padding: '4px 6px' }}>Retries</th>
                  <th style={{ padding: '4px 6px' }}>Updated</th>
                  <th style={{ padding: '4px 6px' }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '4px 6px', color: STATUS_COLORS[job.status] ?? '#666' }}>
                      {STATUS_ICONS[job.status] ?? '?'} {job.status}
                    </td>
                    <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{job.job_type}</td>
                    <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 10 }}>
                      {job.note_id.slice(0, 8)}...
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      {job.retry_count}/{job.max_retries}
                    </td>
                    <td style={{ padding: '4px 6px', color: '#999' }}>
                      {new Date(job.updated_at).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '4px 6px', color: '#c00', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.error ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
