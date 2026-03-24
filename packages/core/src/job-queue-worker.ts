/**
 * Job queue worker — polls job_queue for pending jobs, dispatches to registered
 * handlers, manages status transitions and exponential backoff retries.
 *
 * Job types and priorities (lower = runs first):
 *   ai_revision:        1  (LLM enriches content first, requires llm)
 *   title_generation:   2  (generate title from enriched content)
 *   embedding:          3  (vectorize final content, requires semantic)
 *   concept_tagging:    4  (extract concepts from enriched content, requires llm)
 *   linking:            5  (find related notes, requires embeddings to exist)
 */

import type { PGlite } from '@electric-sql/pglite'
import type { TypedEventBus } from './event-bus.js'
import type { CapabilityManager, CapabilityName } from './capability-manager.js'
import { getLlmFunction } from './capabilities/llm-handler.js'
import { generateId } from './uuid.js'

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

/** Job types listed in execution priority order (lower number = runs first) */
export type JobType =
  | 'ai_revision'         // priority 1, requires llm — enriches content first
  | 'title_generation'    // priority 2, generates title from enriched content
  | 'embedding'           // priority 3, requires semantic
  | 'concept_tagging'     // priority 4, requires llm
  | 'linking'             // priority 5, requires embeddings to exist

/**
 * Job priorities — lower number = runs first.
 * Correct dependency order:
 *   1. ai_revision — LLM enriches content first
 *   2. title_generation — generate title from enriched content
 *   3. embedding — vectorize final content
 *   4. concept_tagging — extract concepts from enriched content
 *   5. linking — find related notes (requires embeddings to exist)
 */
export const JOB_PRIORITIES: Record<JobType, number> = {
  ai_revision: 1,
  title_generation: 2,
  embedding: 3,
  concept_tagging: 4,
  linking: 5,
}

export const JOB_CAPABILITIES: Partial<Record<JobType, string>> = {
  ai_revision: 'llm',
  embedding: 'semantic',
  concept_tagging: 'llm',
}

export interface EnqueueJobInput {
  noteId: string
  jobType: JobType
  priority?: number
  requiredCapability?: string | null
}

/** Enqueue a job into the job_queue table. Returns the new job ID. */
export async function enqueueJob(db: PGlite, input: EnqueueJobInput): Promise<string> {
  const id = generateId()
  const priority = input.priority ?? JOB_PRIORITIES[input.jobType] ?? 5
  const capability = input.requiredCapability !== undefined
    ? input.requiredCapability
    : JOB_CAPABILITIES[input.jobType] ?? null
  await db.query(
    `INSERT INTO job_queue (id, note_id, job_type, status, priority, required_capability, max_retries, retry_count)
     VALUES ($1, $2, $3, 'pending', $4, $5, 3, 0)`,
    [id, input.noteId, input.jobType, priority, capability],
  )
  return id
}

/** Enqueue the note creation pipeline: revision → title → embedding. */
export async function enqueueNoteCreationJobs(db: PGlite, noteId: string, hasTitle: boolean): Promise<void> {
  await enqueueJob(db, { noteId, jobType: 'ai_revision' })
  if (!hasTitle) {
    await enqueueJob(db, { noteId, jobType: 'title_generation' })
  }
  await enqueueJob(db, { noteId, jobType: 'embedding' })
}

/**
 * Enqueue the complete workflow for a note.
 * Order: revision → title → embedding → concepts → linking.
 * Jobs run in priority order so each step has the richest content available.
 */
export async function enqueueFullWorkflow(db: PGlite, noteId: string): Promise<void> {
  await enqueueJob(db, { noteId, jobType: 'ai_revision' })
  await enqueueJob(db, { noteId, jobType: 'title_generation' })
  await enqueueJob(db, { noteId, jobType: 'embedding' })
  await enqueueJob(db, { noteId, jobType: 'concept_tagging' })
  await enqueueJob(db, { noteId, jobType: 'linking' })
}

export interface JobStatus {
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

/** Query job queue status. Optionally filter by note_id. */
export async function getJobQueueStatus(db: PGlite, noteId?: string): Promise<JobStatus[]> {
  const query = noteId
    ? `SELECT * FROM job_queue WHERE note_id = $1 ORDER BY created_at DESC LIMIT 50`
    : `SELECT * FROM job_queue ORDER BY created_at DESC LIMIT 50`
  const params = noteId ? [noteId] : []
  const result = await db.query<JobStatus>(query, params)
  return result.rows
}

export class JobQueueWorker {
  private handlers = new Map<string, JobHandler>()
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private options: Required<JobQueueOptions>

  constructor(
    private db: PGlite,
    private events?: TypedEventBus,
    options: JobQueueOptions = {},
    private capabilityManager?: CapabilityManager,
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

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    // Recover jobs stuck in 'processing' from a previous session (app restart / crash)
    await this.recoverStaleJobs()
    this.poll()
  }

  /** Reset any 'processing' jobs back to 'pending' — they were interrupted by a restart */
  private async recoverStaleJobs(): Promise<void> {
    const result = await this.db.query<{ id: string; job_type: string }>(
      `UPDATE job_queue SET status = 'pending', updated_at = now()
       WHERE status = 'processing'
       RETURNING id, job_type`,
    )
    if (result.rows.length > 0) {
      console.log(`[JobQueue] Recovered ${result.rows.length} stale jobs:`, result.rows.map(r => r.job_type))
    }
    // Also clean up any legacy 'embedding_generation' jobs renamed to 'embedding'
    await this.db.query(
      `UPDATE job_queue SET job_type = 'embedding' WHERE job_type = 'embedding_generation'`,
    )
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
    this.processPendingJobs()
      .catch(() => {})
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this.poll(), this.options.pollIntervalMs)
        }
      })
  }

  private async processPendingJobs(): Promise<number> {
    const result = await this.db.query<Job>(
      `SELECT * FROM job_queue
       WHERE status = 'pending'
       ORDER BY priority ASC, created_at ASC
       LIMIT 10`,
    )

    let processed = 0

    if (result.rows.length > 0) {
      console.log(`[JobQueue] Found ${result.rows.length} pending jobs:`, result.rows.map(j => `${j.job_type}(${j.status})`))
    }

    for (const job of result.rows) {
      const handler = this.handlers.get(job.job_type)
      if (!handler) {
        console.warn(`[JobQueue] No handler for job type '${job.job_type}' — skipping job ${job.id.slice(0, 8)}`)
        continue
      }

      // Capability gating: skip jobs whose required capability is not ready
      if (job.required_capability) {
        const capName = job.required_capability as CapabilityName
        if (!this.capabilityManager?.isReady(capName)) {
          console.log(`[JobQueue] Skipping ${job.job_type} — capability '${capName}' not ready`)
          continue
        }
      }

      // Mark as processing
      await this.db.query(
        `UPDATE job_queue SET status = 'processing', updated_at = now() WHERE id = $1`,
        [job.id],
      )

      try {
        console.log(`[JobQueue] Running ${job.job_type} for note ${job.note_id.slice(0, 8)}...`)
        const jobResult = await handler(job, this.db)
        console.log(`[JobQueue] Completed ${job.job_type}:`, jobResult)

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
        console.error(`[JobQueue] Failed ${job.job_type}:`, err)
        const errorMessage = err instanceof Error ? err.message : String(err)
        const newRetryCount = job.retry_count + 1

        if (newRetryCount >= (job.max_retries || this.options.maxRetries)) {
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
          await this.db.query(
            `UPDATE job_queue SET status = 'pending', error = $1, retry_count = $2, updated_at = now() WHERE id = $3`,
            [errorMessage, newRetryCount, job.id],
          )
        }
      }
    }

    return processed
  }

  getBackoffDelay(retryCount: number): number {
    const delay = this.options.backoffBaseMs * Math.pow(2, retryCount)
    return Math.min(delay, this.options.backoffMaxMs)
  }
}

// ---- Built-in job handlers ----

/** Title generation: LLM first, fallback to first-line extraction */
export function titleGenerationHandler(job: Job, db: PGlite): Promise<unknown> {
  return (async () => {
    const result = await db.query<{ content: string }>(
      `SELECT content FROM note_revised_current WHERE note_id = $1`,
      [job.note_id],
    )
    if (result.rows.length === 0) throw new Error(`No content found for note ${job.note_id}`)

    const content = result.rows[0].content
    const llmFn = getLlmFunction()

    // Try LLM title generation first
    if (llmFn) {
      const prompt =
        `Generate a concise title (under 100 characters) for this note. ` +
        `Respond with ONLY the title text, no quotes, no explanation.\n\nNote content:\n${content.slice(0, 1000)}`

      const llmTitle = (await llmFn(prompt, { maxTokens: 60, temperature: 0.3 })).trim()
      if (llmTitle) {
        const title = llmTitle.length > 200 ? llmTitle.slice(0, 197) + '...' : llmTitle
        await db.query(
          `UPDATE note_revised_current
           SET model = $1, ai_metadata = $2, generation_count = generation_count + 1, updated_at = now()
           WHERE note_id = $3`,
          ['llm', JSON.stringify({ source: 'title_generation' }), job.note_id],
        )
        await db.query(`UPDATE note SET title = $1, updated_at = now() WHERE id = $2`, [title, job.note_id])
        return { title, model: 'llm' }
      }
    }

    // Fallback: extract title from first line with markdown stripping
    let title = content.split('\n')[0] ?? ''
    title = title
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .trim()

    if (title.length > 200) title = title.slice(0, 197) + '...'
    if (!title) title = 'Untitled Note'

    await db.query(`UPDATE note SET title = $1, updated_at = now() WHERE id = $2`, [title, job.note_id])
    return { title }
  })()
}

/** AI revision: LLM enhances note content, creates a revision record */
export function aiRevisionHandler(job: Job, db: PGlite): Promise<unknown> {
  return (async () => {
    const llmFn = getLlmFunction()
    if (!llmFn) return { skipped: true, reason: 'no LLM function registered' }

    const result = await db.query<{ content: string }>(
      `SELECT content FROM note_revised_current WHERE note_id = $1`,
      [job.note_id],
    )
    if (result.rows.length === 0) throw new Error(`No content found for note ${job.note_id}`)

    const content = result.rows[0].content

    const prompt =
      `You are a knowledge management assistant. Enhance the following note by:\n` +
      `- Improving clarity and structure\n` +
      `- Adding markdown formatting where appropriate\n` +
      `- Preserving all original information\n` +
      `- Keeping the same general length\n\n` +
      `Respond with ONLY the enhanced note content, no explanation.\n\n` +
      `Original note:\n${content}`

    const revised = (await llmFn(prompt, { maxTokens: 2000, temperature: 0.4 })).trim()
    if (!revised || revised === content) return { skipped: true, reason: 'no changes from LLM' }

    // Get next revision number
    const revResult = await db.query<{ max_rev: number }>(
      `SELECT COALESCE(MAX(revision_number), 0) as max_rev FROM note_revision WHERE note_id = $1`,
      [job.note_id],
    )
    const nextRev = (revResult.rows[0]?.max_rev ?? 0) + 1

    // Insert revision record (type='ai_enhancement' per server convention)
    const revId = generateId()
    await db.query(
      `INSERT INTO note_revision (id, note_id, revision_number, type, content, ai_metadata, model, created_at)
       VALUES ($1, $2, $3, 'ai_enhancement', $4, $5, 'llm', now())`,
      [revId, job.note_id, nextRev, revised, JSON.stringify({ source: 'ai_revision', original_length: content.length, revised_length: revised.length })],
    )

    // Update note_revised_current
    await db.query(
      `UPDATE note_revised_current
       SET content = $1, model = 'llm', ai_metadata = $2, generation_count = generation_count + 1, is_user_edited = false, updated_at = now()
       WHERE note_id = $3`,
      [revised, JSON.stringify({ source: 'ai_revision', revision_id: revId }), job.note_id],
    )

    // Chain: enqueue concept_tagging after ai_revision completes
    await enqueueJob(db, { noteId: job.note_id, jobType: 'concept_tagging' })

    return { revision_number: nextRev, revision_id: revId, model: 'llm' }
  })()
}

/** Concept tagging: LLM extracts SKOS concepts from revised content */
export function conceptTaggingHandler(job: Job, db: PGlite): Promise<unknown> {
  return (async () => {
    const llmFn = getLlmFunction()
    if (!llmFn) return { skipped: true, reason: 'no LLM function registered' }

    const result = await db.query<{ content: string }>(
      `SELECT content FROM note_revised_current WHERE note_id = $1`,
      [job.note_id],
    )
    if (result.rows.length === 0) throw new Error(`No content found for note ${job.note_id}`)

    const content = result.rows[0].content

    const prompt =
      `Task: Extract 3-5 topic tags from the text below.\n` +
      `Rules:\n` +
      `- Each tag is 1-3 words, lowercase\n` +
      `- Tags should be broad topics, not individual words from the text\n` +
      `- Return ONLY a comma-separated list, nothing else\n` +
      `- Example output: machine learning, web development, database design\n\n` +
      `Text:\n${content.slice(0, 1500)}\n\nTags:`

    const response = (await llmFn(prompt, { maxTokens: 60, temperature: 0.1 })).trim()

    // Parse and validate tags aggressively
    const tags = response
      .split(/[,\n]/)
      .map((t) => t.trim().toLowerCase().replace(/^[-*\d.]+\s*/, '').replace(/['"]/g, ''))
      .filter((t) => {
        if (t.length < 2 || t.length > 40) return false
        // Must be multi-character words, not single letters or numbers
        if (/^\d+$/.test(t)) return false
        // Reject if it's just a common stop word
        const stops = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about', 'between', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of', 'this', 'that', 'these', 'those', 'it', 'its'])
        if (stops.has(t)) return false
        // Reject single-word tags shorter than 3 chars
        if (!t.includes(' ') && t.length < 3) return false
        return true
      })
      .slice(0, 5)

    if (tags.length === 0) {
      return { skipped: true, reason: 'LLM returned no valid tags', raw: response.slice(0, 200) }
    }

    for (const tag of tags) {
      await db.query(
        `INSERT INTO note_tag (id, note_id, tag) VALUES ($1, $2, $3)
         ON CONFLICT (note_id, tag) DO NOTHING`,
        [generateId(), job.note_id, tag],
      )
    }

    return { tags, count: tags.length }
  })()
}

/** Linking: find semantically related notes using FTS + vector RRF */
export function linkingHandler(job: Job, db: PGlite): Promise<unknown> {
  return (async () => {
    // Check if this note has embeddings
    const embResult = await db.query<{ id: string }>(
      `SELECT id FROM embedding WHERE note_id = $1 LIMIT 1`,
      [job.note_id],
    )
    if (embResult.rows.length === 0) {
      return { skipped: true, reason: 'no embeddings for this note yet' }
    }

    // Get this note's embedding vector
    const vecResult = await db.query<{ vector: string }>(
      `SELECT vector::text FROM embedding WHERE note_id = $1 LIMIT 1`,
      [job.note_id],
    )
    if (vecResult.rows.length === 0) return { skipped: true, reason: 'no vector found' }

    // Find similar notes by vector cosine distance (top 5, excluding self)
    const similar = await db.query<{ note_id: string; distance: number }>(
      `SELECT e.note_id, e.vector <=> (SELECT vector FROM embedding WHERE note_id = $1 LIMIT 1) as distance
       FROM embedding e
       WHERE e.note_id != $1
       ORDER BY distance ASC
       LIMIT 5`,
      [job.note_id],
    )

    let created = 0
    for (const row of similar.rows) {
      if (row.distance > 0.8) continue // too dissimilar

      // Insert link if not already exists
      const existing = await db.query(
        `SELECT id FROM link WHERE source_note_id = $1 AND target_note_id = $2 AND link_type = 'semantic'`,
        [job.note_id, row.note_id],
      )
      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO link (id, source_note_id, target_note_id, link_type, confidence, created_at, updated_at)
           VALUES ($1, $2, $3, 'semantic', $4, now(), now())`,
          [generateId(), job.note_id, row.note_id, 1.0 - row.distance],
        )
        created++
      }
    }

    return { links_created: created, candidates: similar.rows.length }
  })()
}
