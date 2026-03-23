import { useState, useCallback } from 'react'
import { SearchRepository, getEmbedFunction, type SearchResponse, type SearchOptions } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useSearch() {
  const { db, capabilityManager } = useFortemiContext()
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const search = useCallback(async (query: string, options?: SearchOptions) => {
    try {
      setLoading(true)
      const semanticReady = capabilityManager.isReady('semantic')
      const repo = new SearchRepository(db, semanticReady)

      let queryEmbedding: number[] | undefined
      if (semanticReady && query.trim()) {
        const embedFn = getEmbedFunction()
        if (embedFn) {
          const [embedding] = await embedFn([query])
          queryEmbedding = embedding
        }
      }

      const result = await repo.search(query, options, queryEmbedding)
      setData(result)
      setError(null)
      return result
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db, capabilityManager])

  const clear = useCallback(() => { setData(null); setError(null) }, [])

  return { data, loading, error, search, clear }
}
