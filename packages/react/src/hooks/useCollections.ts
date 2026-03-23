import { useState, useEffect, useCallback } from 'react'
import { CollectionsRepository, type CollectionRow } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useCollections() {
  const { db } = useFortemiContext()
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const repo = new CollectionsRepository(db)
    const result = await repo.list()
    setCollections(result)
    setLoading(false)
  }, [db])

  useEffect(() => { void refresh() }, [refresh])

  return { collections, loading, refresh }
}
