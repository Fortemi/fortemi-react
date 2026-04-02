/**
 * React hook for local inference server auto-discovery.
 * Probes on mount and periodically re-discovers.
 *
 * @implements #116 local server auto-discovery
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  discoverLocalProviders,
  type DiscoveredProvider,
  type DiscoveryOptions,
} from '@fortemi/core'

export interface UseLocalDiscoveryOptions extends DiscoveryOptions {
  /** Re-discovery interval in ms (default: 60000). Set to 0 to disable. */
  interval?: number
  /** Whether to discover on mount (default: true) */
  enabled?: boolean
}

export interface UseLocalDiscoveryReturn {
  providers: DiscoveredProvider[]
  discovering: boolean
  error: Error | null
  refresh: () => void
}

export function useLocalDiscovery(
  options: UseLocalDiscoveryOptions = {},
): UseLocalDiscoveryReturn {
  const { interval = 60000, enabled = true, ...discoveryOptions } = options
  const [providers, setProviders] = useState<DiscoveredProvider[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const discover = useCallback(async () => {
    if (!mountedRef.current) return
    setDiscovering(true)
    setError(null)
    try {
      const found = await discoverLocalProviders(discoveryOptions)
      if (mountedRef.current) {
        setProviders(found)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (mountedRef.current) {
        setDiscovering(false)
      }
    }
  }, [discoveryOptions])

  useEffect(() => {
    mountedRef.current = true

    if (enabled) {
      discover()

      if (interval > 0) {
        intervalRef.current = setInterval(discover, interval)
      }
    }

    return () => {
      mountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, interval, discover])

  return { providers, discovering, error, refresh: discover }
}
