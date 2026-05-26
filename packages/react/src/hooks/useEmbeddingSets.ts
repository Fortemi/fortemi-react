import { useState, useEffect, useCallback } from 'react'
import {
  EmbeddingSetsRepository,
  type EmbeddingSetCreateInput,
  type EmbeddingSetDescriptor,
  type EmbeddingSetRow,
  type VirtualEmbeddingSetDefinition,
} from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useEmbeddingSets() {
  const { db } = useFortemiContext()
  const [embeddingSets, setEmbeddingSets] = useState<EmbeddingSetDescriptor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const repo = new EmbeddingSetsRepository(db)
      setEmbeddingSets(await repo.listDescriptors())
      setError(null)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db])

  const create = useCallback(async (input: EmbeddingSetCreateInput): Promise<EmbeddingSetRow> => {
    const repo = new EmbeddingSetsRepository(db)
    const set = await repo.create(input)
    await refresh()
    return set
  }, [db, refresh])

  const createVirtualDefinition = useCallback(async (
    input: VirtualEmbeddingSetDefinition,
  ): Promise<EmbeddingSetRow> => {
    const repo = new EmbeddingSetsRepository(db)
    const set = await repo.createVirtualDefinition(input)
    await refresh()
    return set
  }, [db, refresh])

  useEffect(() => { void refresh() }, [refresh])

  return { embeddingSets, loading, error, refresh, create, createVirtualDefinition }
}
