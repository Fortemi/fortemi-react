import { useCallback, useEffect, useState } from 'react'
import { GraphRepository, type CommunityGraph, type SimilarityGraphOptions } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useSimilarityGraph(
  embeddingSetId: string | null | undefined,
  options: SimilarityGraphOptions = {},
) {
  const { db } = useFortemiContext()
  const [graph, setGraph] = useState<CommunityGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    if (!embeddingSetId) {
      setGraph(null)
      return null
    }
    try {
      setLoading(true)
      const repo = new GraphRepository(db)
      const next = await repo.buildSimilarityGraph(embeddingSetId, options)
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
  }, [db, embeddingSetId, options.k, options.minSimilarity])

  useEffect(() => { void refresh() }, [refresh])

  return { graph, loading, error, refresh }
}
