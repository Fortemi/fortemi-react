import { useCallback, useEffect, useState } from 'react'
import {
  CommunitiesRepository,
  type CommunityAssignmentView,
  type CommunityCreateInput,
  type CommunityFilterDefinition,
  type CommunitySourceDescriptor,
  type CommunitySummary,
} from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export function useCommunities() {
  const { db } = useFortemiContext()
  const [sources, setSources] = useState<CommunitySourceDescriptor[]>([])
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<CommunitySummary[]>([])
  const [assignments, setAssignments] = useState<Map<string, CommunityAssignmentView>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (sourceId = activeSourceId) => {
    try {
      setLoading(true)
      const repo = new CommunitiesRepository(db)
      const nextSources = await repo.listCommunitySources()
      setSources(nextSources)
      if (sourceId) {
        const [nextSummaries, nextAssignments] = await Promise.all([
          repo.listCommunitySummaries(sourceId),
          repo.getCommunityAssignments(sourceId),
        ])
        setSummaries(nextSummaries)
        setAssignments(new Map(nextAssignments.map((assignment) => [assignment.noteId, assignment])))
      } else {
        setSummaries([])
        setAssignments(new Map())
      }
      setError(null)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [db, activeSourceId])

  const preview = useCallback((filters: CommunityFilterDefinition) => {
    return new CommunitiesRepository(db).previewDynamicCommunity(filters)
  }, [db])

  const save = useCallback(async (input: CommunityCreateInput) => {
    const source = await new CommunitiesRepository(db).saveCommunity(input)
    setActiveSourceId(source.id)
    await refresh(source.id)
    return source
  }, [db, refresh])

  const rerun = useCallback((sourceId: string) => {
    return new CommunitiesRepository(db).rerunDynamicCommunity(sourceId)
  }, [db])

  const setActiveSource = useCallback((sourceId: string | null) => {
    setActiveSourceId(sourceId)
    void refresh(sourceId)
  }, [refresh])

  useEffect(() => { void refresh() }, [refresh])

  return { sources, activeSourceId, summaries, assignments, loading, error, preview, save, rerun, setActiveSource, refresh }
}
