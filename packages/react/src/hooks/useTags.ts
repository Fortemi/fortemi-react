import { useState, useEffect, useCallback } from 'react'
import { TagsRepository } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useTags() {
  const { db } = useFortemiContext()
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const repo = new TagsRepository(db)
    const result = await repo.listAllTags()
    setTags(result)
    setLoading(false)
  }, [db])

  useEffect(() => { void refresh() }, [refresh])

  return { tags, loading, refresh }
}
