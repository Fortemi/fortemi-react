import { useEffect, useRef, useState, useCallback } from 'react'
import {
  JobQueueWorker,
  titleGenerationHandler,
  aiRevisionHandler,
  conceptTaggingHandler,
  linkingHandler,
  embeddingGenerationHandler,
  enqueueJob,
  getJobQueueStatus,
  type JobType,
  type JobStatus,
} from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

/**
 * Starts the job queue worker on mount, stops on unmount.
 * Registers all built-in handlers matching the server pipeline:
 *   title_generation, ai_revision, embedding, concept_tagging, linking
 */
export function useJobQueue(pollIntervalMs = 3000) {
  const { db, events, capabilityManager } = useFortemiContext()
  const workerRef = useRef<JobQueueWorker | null>(null)
  const [jobs, setJobs] = useState<JobStatus[]>([])

  useEffect(() => {
    const worker = new JobQueueWorker(db, events, { pollIntervalMs }, capabilityManager)

    // Register all server-compatible handlers
    worker.registerHandler('title_generation', titleGenerationHandler)
    worker.registerHandler('ai_revision', aiRevisionHandler)
    worker.registerHandler('embedding', embeddingGenerationHandler)
    worker.registerHandler('concept_tagging', conceptTaggingHandler)
    worker.registerHandler('linking', linkingHandler)

    worker.start()
    workerRef.current = worker

    // Poll job status for UI display
    const refreshJobs = () => {
      getJobQueueStatus(db).then(setJobs).catch(() => {})
    }
    refreshJobs()
    const statusTimer = setInterval(refreshJobs, pollIntervalMs)

    // Refresh on job events
    const completedSub = events.on('job.completed', refreshJobs)
    const failedSub = events.on('job.failed', refreshJobs)

    return () => {
      worker.stop()
      workerRef.current = null
      clearInterval(statusTimer)
      completedSub.dispose()
      failedSub.dispose()
    }
  }, [db, events, capabilityManager, pollIntervalMs])

  const enqueue = useCallback(
    async (noteId: string, jobType: JobType, requiredCapability?: string | null) => {
      const id = await enqueueJob(db, { noteId, jobType, requiredCapability })
      getJobQueueStatus(db).then(setJobs).catch(() => {})
      return id
    },
    [db],
  )

  const getJobsForNote = useCallback(
    async (noteId: string) => {
      return getJobQueueStatus(db, noteId)
    },
    [db],
  )

  return { workerRef, jobs, enqueue, getJobsForNote }
}
