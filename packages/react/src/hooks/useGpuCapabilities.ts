import { useState, useEffect, useRef } from 'react'
import {
  detectGpuCapabilities,
  estimateVramTier,
  type GpuCapabilities,
  type VramTier,
} from '@fortemi/core'

export interface UseGpuCapabilitiesReturn {
  caps: GpuCapabilities | null
  vramTier: VramTier | null
  isDetecting: boolean
  error: Error | null
}

/**
 * Detects WebGPU capabilities on mount.
 * Caches the result — GPU caps don't change during a session.
 */
export function useGpuCapabilities(): UseGpuCapabilitiesReturn {
  const [caps, setCaps] = useState<GpuCapabilities | null>(null)
  const [vramTier, setVramTier] = useState<VramTier | null>(null)
  const [isDetecting, setIsDetecting] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    detectGpuCapabilities()
      .then((detected) => {
        setCaps(detected)
        setVramTier(estimateVramTier(detected))
        setIsDetecting(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsDetecting(false)
      })
  }, [])

  return { caps, vramTier, isDetecting, error }
}
