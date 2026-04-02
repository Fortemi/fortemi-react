/**
 * React hook for comprehensive inference capability detection.
 * Broader scope than useGpuCapabilities — includes VRAM estimation, WebNN, Chrome AI.
 *
 * @implements #115 hardware capability detection improvements
 */

import { useState, useEffect, useRef } from 'react'
import {
  detectInferenceCapabilities,
  type InferenceCapabilities,
} from '@fortemi/core'

export interface UseInferenceCapabilitiesReturn {
  capabilities: InferenceCapabilities | null
  loading: boolean
  error: Error | null
}

/**
 * Detects inference capabilities on mount.
 * Caches the result — hardware caps don't change during a session.
 */
export function useInferenceCapabilities(): UseInferenceCapabilitiesReturn {
  const [capabilities, setCapabilities] = useState<InferenceCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    detectInferenceCapabilities()
      .then((caps) => {
        setCapabilities(caps)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })
  }, [])

  return { capabilities, loading, error }
}
