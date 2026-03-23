/**
 * Tests for JobQueueWorker and titleGenerationHandler.
 *
 * Uses in-memory PGlite with allMigrations applied.
 * Notes must be created before jobs due to FK constraints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { TypedEventBus } from '../event-bus.js'
import { allMigrations } from '../migrations/index.js'
import { JobQueueWorker, titleGenerationHandler } from '../job-queue-worker.js'
import type { JobQueueOptions } from '../job-queue-worker.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  const runner = new MigrationRunner(db)
  await runner.apply(allMigrations)
  return db
}

let noteCounter = 0
async function insertNote(db: PGlite, id?: string): Promise<string> {
  const noteId = id ?? `note-${++noteCounter}-${Date.now()}`
  await db.query(
    `INSERT INTO note (id, format, source, visibility, revision_mode)
     VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
    [noteId],
  )
  return noteId
}

async function insertJob(
  db: PGlite,
  opts: {
    id?: string
    noteId: string
    jobType?: string
    status?: string
    priority?: number
    maxRetries?: number
    retryCount?: number
  },
): Promise<string> {
  const id = opts.id ?? `job-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await db.query(
    `INSERT INTO job_queue (id, note_id, job_type, status, priority, max_retries, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      opts.noteId,
      opts.jobType ?? 'test.job',
      opts.status ?? 'pending',
      opts.priority ?? 5,
      opts.maxRetries ?? 3,
      opts.retryCount ?? 0,
    ],
  )
  return id
}

async function getJob(
  db: PGlite,
  id: string,
): Promise<{
  id: string
  status: string
  retry_count: number
  error: string | null
  result: unknown
}> {
  const result = await db.query<{
    id: string
    status: string
    retry_count: number
    error: string | null
    result: unknown
  }>(`SELECT id, status, retry_count, error, result FROM job_queue WHERE id = $1`, [id])
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JobQueueWorker', () => {
  let db: PGlite
  let events: TypedEventBus
  let worker: JobQueueWorker

  beforeEach(async () => {
    db = await setupDb()
    events = new TypedEventBus()
    worker = new JobQueueWorker(db, events)
  })

  afterEach(async () => {
    worker.stop()
    await db.close()
  })

  // -------------------------------------------------------------------------
  // processOnce — basic pickup
  // -------------------------------------------------------------------------

  it('processOnce() returns 0 when no pending jobs exist', async () => {
    const count = await worker.processOnce()
    expect(count).toBe(0)
  })

  it('processOnce() returns 0 when no handler is registered for the job type', async () => {
    const noteId = await insertNote(db)
    await insertJob(db, { noteId, jobType: 'unhandled.job' })

    const count = await worker.processOnce()
    expect(count).toBe(0)
  })

  it('processOnce() picks up a pending job and invokes the handler', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'hello' })

    const handler = vi.fn().mockResolvedValue({ greeting: 'hi' })
    worker.registerHandler('hello', handler)

    await worker.processOnce()

    expect(handler).toHaveBeenCalledOnce()
    const [calledJob] = handler.mock.calls[0] as [{ id: string }, PGlite]
    expect(calledJob.id).toBe(jobId)
  })

  it('handler receives the job object with correct fields', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'inspect', priority: 7 })

    let capturedJob: unknown
    worker.registerHandler('inspect', async (job) => {
      capturedJob = job
      return null
    })

    await worker.processOnce()

    const j = capturedJob as { id: string; note_id: string; priority: number }
    expect(j.id).toBe(jobId)
    expect(j.note_id).toBe(noteId)
    expect(j.priority).toBe(7)
  })

  // -------------------------------------------------------------------------
  // Status transitions: pending → processing → completed
  // -------------------------------------------------------------------------

  it('job status transitions from pending to completed on success', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'succeed' })
    worker.registerHandler('succeed', async () => ({ ok: true }))

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('completed')
  })

  // -------------------------------------------------------------------------
  // Result stored in JSONB
  // -------------------------------------------------------------------------

  it('job result is stored in the result JSONB column after completion', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'with-result' })
    worker.registerHandler('with-result', async () => ({ score: 42, label: 'pass' }))

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('completed')
    expect(job.result).toEqual({ score: 42, label: 'pass' })
  })

  it('null handler return value is stored as null result', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'null-result' })
    worker.registerHandler('null-result', async () => null)

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('completed')
    expect(job.result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // job.completed event
  // -------------------------------------------------------------------------

  it('emits job.completed event with correct payload on success', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'event-test' })
    worker.registerHandler('event-test', async () => 'done')

    const completedHandler = vi.fn()
    events.on('job.completed', completedHandler)

    await worker.processOnce()

    expect(completedHandler).toHaveBeenCalledOnce()
    expect(completedHandler).toHaveBeenCalledWith({
      id: jobId,
      noteId,
      type: 'event-test',
    })
  })

  it('does not emit job.completed when worker has no events bus', async () => {
    const workerNoEvents = new JobQueueWorker(db)
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'no-events' })
    workerNoEvents.registerHandler('no-events', async () => 'ok')

    // Should not throw even without event bus
    await expect(workerNoEvents.processOnce()).resolves.toBe(1)

    const job = await getJob(db, jobId)
    expect(job.status).toBe('completed')
  })

  // -------------------------------------------------------------------------
  // Failure: retry_count increments, stays pending when below max_retries
  // -------------------------------------------------------------------------

  it('failed job below max_retries stays pending with incremented retry_count', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'flaky', maxRetries: 3, retryCount: 0 })
    worker.registerHandler('flaky', async () => {
      throw new Error('transient error')
    })

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('pending')
    expect(job.retry_count).toBe(1)
    expect(job.error).toBe('transient error')
  })

  it('failed job at retry_count 1 with max_retries 2 stays pending on second attempt', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'flaky2', maxRetries: 3, retryCount: 1 })
    worker.registerHandler('flaky2', async () => {
      throw new Error('still failing')
    })

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('pending')
    expect(job.retry_count).toBe(2)
  })

  // -------------------------------------------------------------------------
  // Terminal failure: status 'failed' at max_retries
  // -------------------------------------------------------------------------

  it('job reaches failed status when retry_count hits max_retries', async () => {
    const noteId = await insertNote(db)
    // retry_count = 2, max_retries = 3 → next failure hits 3 >= 3 → failed
    const jobId = await insertJob(db, { noteId, jobType: 'terminal', maxRetries: 3, retryCount: 2 })
    worker.registerHandler('terminal', async () => {
      throw new Error('fatal error')
    })

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('failed')
    expect(job.retry_count).toBe(3)
    expect(job.error).toBe('fatal error')
  })

  it('job fails immediately when max_retries is 1 and first attempt fails', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'zero-retries', maxRetries: 1, retryCount: 0 })
    worker.registerHandler('zero-retries', async () => {
      throw new Error('no retry')
    })

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('failed')
    expect(job.retry_count).toBe(1)
  })

  // -------------------------------------------------------------------------
  // job.failed event on terminal failure
  // -------------------------------------------------------------------------

  it('emits job.failed event on terminal failure', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'fail-event', maxRetries: 1, retryCount: 0 })
    worker.registerHandler('fail-event', async () => {
      throw new Error('boom')
    })

    const failedHandler = vi.fn()
    events.on('job.failed', failedHandler)

    await worker.processOnce()

    expect(failedHandler).toHaveBeenCalledOnce()
    expect(failedHandler).toHaveBeenCalledWith({
      id: jobId,
      noteId,
      type: 'fail-event',
      error: 'boom',
    })
  })

  it('does not emit job.failed when retry_count has not reached max_retries', async () => {
    const noteId = await insertNote(db)
    await insertJob(db, { noteId, jobType: 'not-failed-yet', maxRetries: 3, retryCount: 0 })
    worker.registerHandler('not-failed-yet', async () => {
      throw new Error('transient')
    })

    const failedHandler = vi.fn()
    events.on('job.failed', failedHandler)

    await worker.processOnce()

    expect(failedHandler).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Worker continues after individual job failures
  // -------------------------------------------------------------------------

  it('worker processes subsequent jobs after one fails', async () => {
    const noteId1 = await insertNote(db)
    const noteId2 = await insertNote(db)
    const failJobId = await insertJob(db, { noteId: noteId1, jobType: 'fail-type', maxRetries: 1 })
    const successJobId = await insertJob(db, { noteId: noteId2, jobType: 'success-type' })

    worker.registerHandler('fail-type', async () => {
      throw new Error('fail')
    })
    worker.registerHandler('success-type', async () => ({ ok: true }))

    await worker.processOnce()

    const failedJob = await getJob(db, failJobId)
    const successJob = await getJob(db, successJobId)
    expect(failedJob.status).toBe('failed')
    expect(successJob.status).toBe('completed')
  })

  it('processOnce returns count of successfully completed jobs only', async () => {
    const noteId1 = await insertNote(db)
    const noteId2 = await insertNote(db)
    await insertJob(db, { noteId: noteId1, jobType: 'will-fail', maxRetries: 1 })
    await insertJob(db, { noteId: noteId2, jobType: 'will-succeed' })

    worker.registerHandler('will-fail', async () => { throw new Error('oops') })
    worker.registerHandler('will-succeed', async () => 'done')

    const count = await worker.processOnce()
    expect(count).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Priority ordering
  // -------------------------------------------------------------------------

  it('processes higher-priority jobs before lower-priority jobs', async () => {
    const noteId1 = await insertNote(db)
    const noteId2 = await insertNote(db)
    const noteId3 = await insertNote(db)

    const order: string[] = []
    worker.registerHandler('ordered', async (job) => {
      order.push(job.id)
      return null
    })

    // Insert in reverse priority order to verify ordering
    const lowId = await insertJob(db, { noteId: noteId1, jobType: 'ordered', priority: 1 })
    const highId = await insertJob(db, { noteId: noteId2, jobType: 'ordered', priority: 10 })
    const midId = await insertJob(db, { noteId: noteId3, jobType: 'ordered', priority: 5 })

    await worker.processOnce()

    expect(order).toEqual([highId, midId, lowId])
  })

  // -------------------------------------------------------------------------
  // start() / stop() lifecycle
  // -------------------------------------------------------------------------

  it('start() sets running state and stop() halts polling', async () => {
    // Use a very long poll interval so we can stop before a second poll fires
    const slowWorker = new JobQueueWorker(db, events, { pollIntervalMs: 60000 })

    slowWorker.start()
    expect((slowWorker as unknown as { running: boolean }).running).toBe(true)

    // Wait for the initial poll to complete (no jobs or handlers registered, so it returns fast)
    await new Promise((resolve) => setTimeout(resolve, 50))

    slowWorker.stop()
    expect((slowWorker as unknown as { running: boolean }).running).toBe(false)
  })

  it('calling start() twice is idempotent — second call is a no-op', async () => {
    const slowWorker = new JobQueueWorker(db, events, { pollIntervalMs: 60000 })

    slowWorker.start()
    // Wait for initial poll to finish
    await new Promise((resolve) => setTimeout(resolve, 50))

    const timerAfterFirst = (slowWorker as unknown as { timer: ReturnType<typeof setTimeout> | null }).timer

    slowWorker.start() // second call should be a no-op
    const timerAfterSecond = (slowWorker as unknown as { timer: ReturnType<typeof setTimeout> | null }).timer

    // The timer reference should be the same (no new poll loop spawned)
    expect(timerAfterFirst).toBe(timerAfterSecond)

    slowWorker.stop()
    expect((slowWorker as unknown as { running: boolean }).running).toBe(false)
  })

  // -------------------------------------------------------------------------
  // getBackoffDelay — exponential with cap
  // -------------------------------------------------------------------------

  it('getBackoffDelay returns 1000ms for retry 0 (base default)', () => {
    const delay = worker.getBackoffDelay(0)
    expect(delay).toBe(1000)
  })

  it('getBackoffDelay doubles with each retry', () => {
    expect(worker.getBackoffDelay(0)).toBe(1000)
    expect(worker.getBackoffDelay(1)).toBe(2000)
    expect(worker.getBackoffDelay(2)).toBe(4000)
    expect(worker.getBackoffDelay(3)).toBe(8000)
  })

  it('getBackoffDelay is capped at backoffMaxMs', () => {
    // With base 1000ms, retry 20 would be 1000 * 2^20 = ~1 billion ms
    const delay = worker.getBackoffDelay(20)
    expect(delay).toBe(300000)
  })

  it('getBackoffDelay respects custom backoffBaseMs and backoffMaxMs', () => {
    const options: JobQueueOptions = {
      backoffBaseMs: 500,
      backoffMaxMs: 10000,
    }
    const customWorker = new JobQueueWorker(db, undefined, options)

    expect(customWorker.getBackoffDelay(0)).toBe(500)
    expect(customWorker.getBackoffDelay(1)).toBe(1000)
    expect(customWorker.getBackoffDelay(2)).toBe(2000)
    // 500 * 2^5 = 16000 > 10000 → capped
    expect(customWorker.getBackoffDelay(5)).toBe(10000)
  })

  // -------------------------------------------------------------------------
  // Non-Error throws
  // -------------------------------------------------------------------------

  it('handles non-Error thrown values gracefully', async () => {
    const noteId = await insertNote(db)
    const jobId = await insertJob(db, { noteId, jobType: 'string-throw', maxRetries: 1 })
    worker.registerHandler('string-throw', async () => {
       
      throw 'raw string error'
    })

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toBe('raw string error')
  })
})

// ---------------------------------------------------------------------------
// titleGenerationHandler
// ---------------------------------------------------------------------------

describe('titleGenerationHandler', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await setupDb()
  })

  afterEach(async () => {
    await db.close()
  })

  async function setupNoteWithContent(content: string): Promise<{ noteId: string; jobId: string }> {
    const noteId = `note-title-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await db.query(
      `INSERT INTO note (id, format, source, visibility, revision_mode)
       VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
      [noteId],
    )
    await db.query(
      `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
      [noteId, content],
    )
    const jobId = `job-title-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await db.query(
      `INSERT INTO job_queue (id, note_id, job_type, status, priority, max_retries, retry_count)
       VALUES ($1, $2, 'title_generation', 'pending', 5, 3, 0)`,
      [jobId, noteId],
    )
    return { noteId, jobId }
  }

  function makeJob(noteId: string, jobId: string) {
    return {
      id: jobId,
      note_id: noteId,
      job_type: 'title_generation',
      status: 'pending',
      priority: 5,
      required_capability: null,
      retry_count: 0,
      max_retries: 3,
      error: null,
      result: null,
      created_at: new Date(),
      updated_at: new Date(),
    }
  }

  it('extracts the first line as the title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('My First Note\nSome body text')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('My First Note')
  })

  it('strips markdown header syntax from title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('## My Heading\nBody here')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('My Heading')
  })

  it('strips bold markdown from title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('**Bold Title** is here')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Bold Title is here')
  })

  it('strips italic markdown from title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('*Italic Title* text')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Italic Title text')
  })

  it('strips inline code markdown from title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('Use `const x = 1` in your code')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Use const x = 1 in your code')
  })

  it('strips markdown links from title', async () => {
    const { noteId, jobId } = await setupNoteWithContent('[Click here](https://example.com) for more')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Click here for more')
  })

  it('strips multiple markdown formats in a single line', async () => {
    const { noteId, jobId } = await setupNoteWithContent('## **Bold** and *italic* title')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Bold and italic title')
  })

  it('truncates title to 200 chars with ellipsis', async () => {
    const longLine = 'A'.repeat(300)
    const { noteId, jobId } = await setupNoteWithContent(longLine)
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toHaveLength(200)
    expect(result.title.endsWith('...')).toBe(true)
    expect(result.title.slice(0, 197)).toBe('A'.repeat(197))
  })

  it('does not truncate a title of exactly 200 chars', async () => {
    const exactLine = 'B'.repeat(200)
    const { noteId, jobId } = await setupNoteWithContent(exactLine)
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toHaveLength(200)
    expect(result.title.endsWith('...')).toBe(false)
  })

  it('returns "Untitled Note" when the first line is empty', async () => {
    const { noteId, jobId } = await setupNoteWithContent('\nBody without title')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Untitled Note')
  })

  it('returns "Untitled Note" when content is only whitespace on first line', async () => {
    const { noteId, jobId } = await setupNoteWithContent('   \nActual content here')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Untitled Note')
  })

  it('updates the note title in the database', async () => {
    const { noteId, jobId } = await setupNoteWithContent('# Database Update Test\nContent')
    await titleGenerationHandler(makeJob(noteId, jobId), db)

    const result = await db.query<{ title: string }>(
      `SELECT title FROM note WHERE id = $1`,
      [noteId],
    )
    expect(result.rows[0].title).toBe('Database Update Test')
  })

  it('throws when note has no revised content', async () => {
    const noteId = `note-no-content-${Date.now()}`
    await db.query(
      `INSERT INTO note (id, format, source, visibility, revision_mode)
       VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
      [noteId],
    )
    const jobId = `job-no-content-${Date.now()}`
    const job = makeJob(noteId, jobId)

    await expect(titleGenerationHandler(job, db)).rejects.toThrow(
      `No content found for note ${noteId}`,
    )
  })

  it('handles content with only a single line (no newline)', async () => {
    const { noteId, jobId } = await setupNoteWithContent('Single line content')
    const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
    expect(result.title).toBe('Single line content')
  })

  it('handles h1 through h6 header levels', async () => {
    for (let level = 1; level <= 6; level++) {
      const { noteId, jobId } = await setupNoteWithContent(`${'#'.repeat(level)} Level ${level} Header`)
      const result = await titleGenerationHandler(makeJob(noteId, jobId), db) as { title: string }
      expect(result.title).toBe(`Level ${level} Header`)
    }
  })
})

// ---------------------------------------------------------------------------
// Integration: JobQueueWorker + titleGenerationHandler
// ---------------------------------------------------------------------------

describe('JobQueueWorker with titleGenerationHandler', () => {
  let db: PGlite
  let events: TypedEventBus
  let worker: JobQueueWorker

  beforeEach(async () => {
    db = await setupDb()
    events = new TypedEventBus()
    worker = new JobQueueWorker(db, events)
    worker.registerHandler('title_generation', titleGenerationHandler)
  })

  afterEach(async () => {
    worker.stop()
    await db.close()
  })

  it('processes a title_generation job end-to-end', async () => {
    const noteId = `note-e2e-${Date.now()}`
    await db.query(
      `INSERT INTO note (id, format, source, visibility, revision_mode)
       VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
      [noteId],
    )
    await db.query(
      `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
      [noteId, '# Integration Test Title\nBody content here.'],
    )
    const jobId = `job-e2e-${Date.now()}`
    await db.query(
      `INSERT INTO job_queue (id, note_id, job_type, status, priority, max_retries, retry_count)
       VALUES ($1, $2, 'title_generation', 'pending', 5, 3, 0)`,
      [jobId, noteId],
    )

    const completedHandler = vi.fn()
    events.on('job.completed', completedHandler)

    const count = await worker.processOnce()
    expect(count).toBe(1)

    // Job completed
    const job = await getJob(db, jobId)
    expect(job.status).toBe('completed')
    expect(job.result).toEqual({ title: 'Integration Test Title' })

    // Note title updated
    const noteResult = await db.query<{ title: string }>(
      `SELECT title FROM note WHERE id = $1`,
      [noteId],
    )
    expect(noteResult.rows[0].title).toBe('Integration Test Title')

    // Event emitted
    expect(completedHandler).toHaveBeenCalledWith({
      id: jobId,
      noteId,
      type: 'title_generation',
    })
  })

  it('marks title_generation job failed when note has no revised content', async () => {
    const noteId = `note-no-rev-${Date.now()}`
    await db.query(
      `INSERT INTO note (id, format, source, visibility, revision_mode)
       VALUES ($1, 'markdown', 'user', 'private', 'standard')`,
      [noteId],
    )
    const jobId = `job-no-rev-${Date.now()}`
    // max_retries = 1 so it fails immediately
    await db.query(
      `INSERT INTO job_queue (id, note_id, job_type, status, priority, max_retries, retry_count)
       VALUES ($1, $2, 'title_generation', 'pending', 5, 1, 0)`,
      [jobId, noteId],
    )

    const failedHandler = vi.fn()
    events.on('job.failed', failedHandler)

    await worker.processOnce()

    const job = await getJob(db, jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toContain('No content found for note')
    expect(failedHandler).toHaveBeenCalledOnce()
  })
})
