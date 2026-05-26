import { useCallback, useEffect, useMemo, useState } from 'react'
import { GraphRepository, type CommunityGraph, type EmbeddingSetSelector, type SimilarityGraphOptions } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useSimilarityGraph(
  embeddingSet: string | EmbeddingSetSelector | null | undefined,
  options: SimilarityGraphOptions = {},
) {
  const { db } = useFortemiContext()
  const [graph, setGraph] = useState<CommunityGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const selectorKey = useMemo(() => JSON.stringify(embeddingSet ?? null), [embeddingSet])

  const refresh = useCallback(async () => {
    if (!embeddingSet) {
      setGraph(null)
      return null
    }
    try {
      setLoading(true)
      const repo = new GraphRepository(db)
      const next = await repo.buildSimilarityGraph(embeddingSet, options)
      setGraph(next)
      setError(null)
      return next
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db, selectorKey, options.k, options.minSimilarity, options.threshold])

  useEffect(() => { void refresh() }, [refresh])

  return { graph, loading, error, refresh }
}
