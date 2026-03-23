import { useEffect, useRef } from 'react'
import { JobQueueWorker, titleGenerationHandler } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

/**
 * Starts the job queue worker on mount, stops on unmount.
 * Registers the built-in title generation handler.
 */
export function useJobQueue(pollIntervalMs = 3000) {
  const { db, events } = useFortemiContext()
  const workerRef = useRef<JobQueueWorker | null>(null)

  useEffect(() => {
    const worker = new JobQueueWorker(db, events, { pollIntervalMs })
    worker.registerHandler('title_generation', titleGenerationHandler)
    worker.start()
    workerRef.current = worker

    return () => {
      worker.stop()
      workerRef.current = null
    }
  }, [db, events, pollIntervalMs])

  return workerRef
}
