import { useState, useEffect, useCallback } from 'react'
import { EmbeddingSetsRepository, type EmbeddingSetCreateInput, type EmbeddingSetRow } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useEmbeddingSets() {
  const { db } = useFortemiContext()
  const [embeddingSets, setEmbeddingSets] = useState<EmbeddingSetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const repo = new EmbeddingSetsRepository(db)
      setEmbeddingSets(await repo.list())
      setError(null)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db])

  const create = useCallback(async (input: EmbeddingSetCreateInput) => {
    const repo = new EmbeddingSetsRepository(db)
    const set = await repo.create(input)
    await refresh()
    return set
  }, [db, refresh])

  useEffect(() => { void refresh() }, [refresh])

  return { embeddingSets, loading, error, refresh, create }
}
