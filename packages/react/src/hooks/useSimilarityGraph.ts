import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GraphRepository,
  type CommunityGraph,
  type EmbeddingSetSelector,
  type SimilarityGraphOptions,
  type SimilarityGraphRequest,
  type SimilarityGraphResult,
} from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

type UseSimilarityGraphOptions = SimilarityGraphOptions & Pick<SimilarityGraphRequest, 'metric' | 'source'> & {
  autoRefresh?: boolean
}

function normalizeSelector(embeddingSet: string | EmbeddingSetSelector): EmbeddingSetSelector {
  return typeof embeddingSet === 'string'
    ? { kind: 'embedding-set', embeddingSetId: embeddingSet }
    : embeddingSet
}

export function useSimilarityGraph(
  embeddingSet: string | EmbeddingSetSelector | null | undefined,
  options: UseSimilarityGraphOptions = {},
) {
  const { db } = useFortemiContext()
  const [graph, setGraph] = useState<CommunityGraph | null>(null)
  const [graphSource, setGraphSource] = useState<SimilarityGraphResult['graphSource'] | null>(null)
  const [cache, setCache] = useState<SimilarityGraphResult['cache'] | null>(null)
  const [freshness, setFreshness] = useState<SimilarityGraphResult['freshness'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const selectorKey = useMemo(() => JSON.stringify(embeddingSet ?? null), [embeddingSet])
  const autoRefresh = options.autoRefresh ?? true

  const load = useCallback(async (source?: SimilarityGraphRequest['source']) => {
    if (!embeddingSet) {
      setGraph(null)
      setGraphSource(null)
      setCache(null)
      setFreshness(null)
      return null
    }
    try {
      setLoading(true)
      const repo = new GraphRepository(db)
      const result = await repo.buildOrLoadSimilarityGraph({
        selector: normalizeSelector(embeddingSet),
        k: options.k,
        minSimilarity: options.minSimilarity,
        threshold: options.threshold,
        metric: options.metric,
        source: source ?? options.source,
      })
      setGraph(result.graph)
      setGraphSource(result.graphSource)
      setCache(result.cache)
      setFreshness(result.freshness)
      setError(null)
      return result
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db, selectorKey, options.k, options.minSimilarity, options.threshold, options.metric, options.source])

  const refresh = useCallback(() => load(), [load])
  const recompute = useCallback(() => load('live-only'), [load])
  const markStale = useCallback(async (reason: string) => {
    if (!graphSource) return
    await new GraphRepository(db).markSimilarityGraphStale(graphSource.id, reason)
    setFreshness('stale')
  }, [db, graphSource])

  useEffect(() => {
    if (autoRefresh) void refresh()
  }, [autoRefresh, refresh])

  return { graph, graphSource, loading, error, cache, freshness, refresh, recompute, markStale }
}
