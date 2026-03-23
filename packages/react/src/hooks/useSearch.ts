import { useState, useCallback } from 'react'
import { SearchRepository, type SearchResponse, type SearchOptions } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useSearch() {
  const { db } = useFortemiContext()
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const search = useCallback(async (query: string, options?: SearchOptions) => {
    try {
      setLoading(true)
      const repo = new SearchRepository(db)
      const result = await repo.search(query, options)
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
  }, [db])

  const clear = useCallback(() => { setData(null); setError(null) }, [])

  return { data, loading, error, search, clear }
}
