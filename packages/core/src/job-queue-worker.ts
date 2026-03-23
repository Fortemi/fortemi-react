/**
 * Job queue worker — polls job_queue for pending jobs, dispatches to registered
 * handlers, manages status transitions and exponential backoff retries.
 *
 * @implements @.aiwg/research/findings/REF-018-react.md
 */

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from './event-bus.js'

export interface JobQueueOptions {
  /** How often to poll for new jobs (ms). Default: 5000 */
  pollIntervalMs?: number
  /** Global max retries used when job.max_retries is 0. Default: 3 */
  maxRetries?: number
  /** Base delay for exponential backoff (ms). Default: 1000 */
  backoffBaseMs?: number
  /** Maximum backoff delay cap (ms). Default: 300000 (5 min) */
  backoffMaxMs?: number
}

interface Job {
  id: string
  note_id: string
  job_type: string
  status: string
  priority: number
  required_capability: string | null
  retry_count: number
  max_retries: number
  error: string | null
  result: unknown | null
  created_at: Date
  updated_at: Date
}

type JobHandler = (job: Job, db: PGlite) => Promise<unknown>

export class JobQueueWorker {
  private handlers = new Map<string, JobHandler>()
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private options: Required<JobQueueOptions>

  constructor(
    private db: PGlite,
    private events?: TypedEventBus,
    options: JobQueueOptions = {},
  ) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      maxRetries: options.maxRetries ?? 3,
      backoffBaseMs: options.backoffBaseMs ?? 1000,
      backoffMaxMs: options.backoffMaxMs ?? 300000,
    }
  }

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Process one batch of pending jobs. Useful for testing without polling. */
  async processOnce(): Promise<number> {
    return this.processPendingJobs()
  }

  private poll(): void {
    if (!this.running) return
    // Guard against processing when stopped mid-flight
    this.processPendingJobs()
      .catch(() => {
        // Silently swallow errors from in-flight DB operations when worker is stopped
      })
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this.poll(), this.options.pollIntervalMs)
        }
      })
  }

  private async processPendingJobs(): Promise<number> {
    // Fetch pending jobs ordered by priority DESC, created_at ASC
    const result = await this.db.query<Job>(
      `SELECT * FROM job_queue
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 10`,
    )

    let processed = 0

    for (const job of result.rows) {
      const handler = this.handlers.get(job.job_type)
      if (!handler) continue

      // Mark as processing
      await this.db.query(
        `UPDATE job_queue SET status = 'processing', updated_at = now() WHERE id = $1`,
        [job.id],
      )

      try {
        const jobResult = await handler(job, this.db)

        // Mark as completed
        await this.db.query(
          `UPDATE job_queue SET status = 'completed', result = $1, updated_at = now() WHERE id = $2`,
          [JSON.stringify(jobResult ?? null), job.id],
        )

        this.events?.emit('job.completed', {
          id: job.id,
          noteId: job.note_id,
          type: job.job_type,
        })

        processed++
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        const newRetryCount = job.retry_count + 1

        if (newRetryCount >= (job.max_retries || this.options.maxRetries)) {
          // Terminal failure
          await this.db.query(
            `UPDATE job_queue SET status = 'failed', error = $1, retry_count = $2, updated_at = now() WHERE id = $3`,
            [errorMessage, newRetryCount, job.id],
          )

          this.events?.emit('job.failed', {
            id: job.id,
            noteId: job.note_id,
            type: job.job_type,
            error: errorMessage,
          })
        } else {
          // Retry — put back to pending with incremented retry_count
          await this.db.query(
            `UPDATE job_queue SET status = 'pending', error = $1, retry_count = $2, updated_at = now() WHERE id = $3`,
            [errorMessage, newRetryCount, job.id],
          )
        }
      }
    }

    return processed
  }

  /** Calculate exponential backoff delay for a given retry count */
  getBackoffDelay(retryCount: number): number {
    const delay = this.options.backoffBaseMs * Math.pow(2, retryCount)
    return Math.min(delay, this.options.backoffMaxMs)
  }
}

/** Built-in title generation handler — extracts title from note_revised_current */
export function titleGenerationHandler(job: Job, db: PGlite): Promise<unknown> {
  return (async () => {
    // Get note content
    const result = await db.query<{ content: string }>(
      `SELECT content FROM note_revised_current WHERE note_id = $1`,
      [job.note_id],
    )

    if (result.rows.length === 0) {
      throw new Error(`No content found for note ${job.note_id}`)
    }

    const content = result.rows[0].content

    // Extract title: first line, strip markdown, truncate
    let title = content.split('\n')[0] ?? ''

    // Strip markdown formatting
    title = title
      .replace(/^#{1,6}\s+/, '') // headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/`(.*?)`/g, '$1') // inline code
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links
      .trim()

    // Truncate to 200 chars with ellipsis
    if (title.length > 200) {
      title = title.slice(0, 197) + '...'
    }

    // If still empty, use generic title
    if (!title) {
      title = 'Untitled Note'
    }

    // Update note title
    await db.query(`UPDATE note SET title = $1, updated_at = now() WHERE id = $2`, [
      title,
      job.note_id,
    ])

    return { title }
  })()
}
