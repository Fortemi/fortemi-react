import { useState, useCallback } from 'react'
import {
  prefetchShard,
  isShardPrefetched,
  type PrefetchOptions,
  type PrefetchResult,
} from '@fortemi/core'

export interface UseShardPrefetchReturn {
  /** Warm (and optionally SHA-verify) a static shard asset in the background. */
  prefetch: (url: string, options?: PrefetchOptions) => Promise<PrefetchResult>
  /** Whether a url already has warm bytes (import would be just the index build). */
  isPrefetched: (url: string) => boolean
  /** Per-url warming flags, e.g. to disable an "open" button until the bytes land. */
  warming: Record<string, boolean>
  error: Error | null
}

/**
 * Background warm/prefetch for static shard assets (#181).
 *
 * fortemi-react is server-free: shards are static, typically build-time-generated
 * assets. This hook warms their bytes ahead of the user's opt-in click so the
 * click is purely the index build — the avoidable download moves to idle.
 *
 * @example
 * ```tsx
 * const { prefetch, isPrefetched } = useShardPrefetch()
 *
 * useEffect(() => {
 *   const id = requestIdleCallback(() => {
 *     void prefetch('/shards/research.shard', { expectedSha256: RESEARCH_SHARD_SHA256 })
 *   })
 *   return () => cancelIdleCallback(id)
 * }, [prefetch])
 *
 * // <button disabled={!isPrefetched('/shards/research.shard')} onClick={open}>Open</button>
 * ```
 */
export function useShardPrefetch(): UseShardPrefetchReturn {
  const [warming, setWarming] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Error | null>(null)

  const prefetch = useCallback(async (url: string, options?: PrefetchOptions): Promise<PrefetchResult> => {
    setWarming((w) => ({ ...w, [url]: true }))
    setError(null)
    try {
      return await prefetchShard(url, options)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setWarming((w) => ({ ...w, [url]: false }))
    }
  }, [])

  return { prefetch, isPrefetched: isShardPrefetched, warming, error }
}
