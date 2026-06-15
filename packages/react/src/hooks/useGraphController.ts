import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CommunitiesRepository,
  GraphRepository,
  type CommunityCreateInput,
  type CommunityFilterDefinition,
  type CommunityGraph,
  type CommunitySourceDescriptor,
  type EmbeddingSetSelector,
  type SimilarityGraphResult,
} from '@fortemi/core'
import type { GraphLayoutAlgorithm } from '@fortemi/graph'
import { useFortemiContext } from '../FortemiProvider.js'

export type GraphSourceMode = 'citations' | 'topics' | 'precomputed' | 'dynamic-search' | 'user-authored'

export interface GraphLayoutState {
  algorithm: GraphLayoutAlgorithm
  pinSelectedNodes?: boolean
  preserveViewport?: boolean
  communitySpacing?: number
}

export interface GraphTransitionState {
  fromMode?: GraphSourceMode
  toMode: GraphSourceMode
  reason: 'mode-change' | 'embedding-set-change' | 'community-source-change' | 'filter-change' | 'recompute'
  startedAt: string
}

export interface GraphControllerStatus {
  loading: boolean
  error: Error | null
  freshness: 'fresh' | 'stale' | 'unknown' | null
  cache: SimilarityGraphResult['cache'] | null
}

export interface GraphSourceControllerState {
  mode: GraphSourceMode
  graph: CommunityGraph | null
  graphSource?: SimilarityGraphResult['graphSource'] | { id: string; name: string }
  communitySource?: CommunitySourceDescriptor
  embeddingSetSelector?: EmbeddingSetSelector
  filters?: CommunityFilterDefinition
  layout: GraphLayoutState
  status: GraphControllerStatus
  transition?: GraphTransitionState
}

export interface UseGraphControllerOptions {
  initialMode?: GraphSourceMode
  initialEmbeddingSetSelector?: EmbeddingSetSelector
  initialCommunitySourceId?: string
  initialFilters?: CommunityFilterDefinition
  layout?: Partial<GraphLayoutState>
}

const DEFAULT_LAYOUT: GraphLayoutState = {
  algorithm: 'force',
  preserveViewport: true,
  communitySpacing: 1,
}

export function useGraphController(options: UseGraphControllerOptions = {}) {
  const { db } = useFortemiContext()
  const [mode, setModeState] = useState<GraphSourceMode>(options.initialMode ?? 'citations')
  const [graph, setGraph] = useState<CommunityGraph | null>(null)
  const [graphSource, setGraphSource] = useState<GraphSourceControllerState['graphSource']>()
  const [communitySource, setCommunitySourceState] = useState<CommunitySourceDescriptor>()
  const [embeddingSetSelector, setEmbeddingSetSelectorState] = useState<EmbeddingSetSelector | undefined>(options.initialEmbeddingSetSelector)
  const [communitySourceId, setCommunitySourceId] = useState<string | null>(options.initialCommunitySourceId ?? null)
  const [filters, setFiltersState] = useState<CommunityFilterDefinition | undefined>(options.initialFilters)
  const [layout] = useState<GraphLayoutState>({ ...DEFAULT_LAYOUT, ...options.layout })
  const [status, setStatus] = useState<GraphControllerStatus>({ loading: false, error: null, freshness: null, cache: null })
  const [transition, setTransition] = useState<GraphTransitionState>()
  const selectorKey = useMemo(() => JSON.stringify(embeddingSetSelector ?? null), [embeddingSetSelector])
  const filtersKey = useMemo(() => JSON.stringify(filters ?? null), [filters])

  const setTransitionReason = useCallback((toMode: GraphSourceMode, reason: GraphTransitionState['reason'], fromMode = mode) => {
    setTransition({ fromMode, toMode, reason, startedAt: new Date().toISOString() })
  }, [mode])

  const refresh = useCallback(async () => {
    try {
      setStatus((current) => ({ ...current, loading: true, error: null }))
      const graphRepo = new GraphRepository(db)
      const communityRepo = new CommunitiesRepository(db)
      const sources = await communityRepo.listCommunitySources()
      const activeCommunity = communitySourceId ? sources.find((source) => source.id === communitySourceId) : undefined
      setCommunitySourceState(activeCommunity)

      if (mode === 'citations') {
        const nextGraph = await graphRepo.buildLinkGraph()
        setGraph(nextGraph)
        setGraphSource({ id: 'citations', name: 'Citation graph' })
        setStatus({ loading: false, error: null, freshness: 'fresh', cache: null })
        return
      }

      if (mode === 'topics') {
        if (!embeddingSetSelector) throw new Error('topics mode requires an embedding-set selector')
        const result = await graphRepo.buildOrLoadSimilarityGraph({ selector: embeddingSetSelector })
        setGraph(result.graph)
        setGraphSource(result.graphSource)
        setStatus({ loading: false, error: null, freshness: result.freshness, cache: result.cache })
        return
      }

      if (mode === 'precomputed') {
        if (!activeCommunity?.graphSourceId) throw new Error('precomputed mode requires a community source with graphSourceId')
        const assignments = await communityRepo.getCommunityAssignments(activeCommunity.id)
        const nextGraph = await graphRepo.loadGraphArtifact(activeCommunity.graphSourceId, assignments.map((assignment) => assignment.noteId))
        setGraph(nextGraph)
        setGraphSource({ id: activeCommunity.graphSourceId, name: activeCommunity.name })
        setStatus({ loading: false, error: null, freshness: activeCommunity.freshness ?? 'unknown', cache: null })
        return
      }

      if (mode === 'dynamic-search') {
        const assignments = await communityRepo.previewDynamicCommunity(filters ?? {})
        setGraph({ nodes: assignments.map((assignment) => ({ id: assignment.noteId })), edges: [], communities: [{ id: 'dynamic-preview', nodes: assignments.map((assignment) => assignment.noteId) }] })
        setGraphSource({ id: 'dynamic-preview', name: 'Dynamic preview' })
        setStatus({ loading: false, error: null, freshness: 'unknown', cache: null })
        return
      }

      if (mode === 'user-authored') {
        if (!activeCommunity) throw new Error('user-authored mode requires an active community source')
        const assignments = await communityRepo.getCommunityAssignments(activeCommunity.id)
        setGraph({ nodes: assignments.map((assignment) => ({ id: assignment.noteId })), edges: [], communities: [{ id: activeCommunity.id, nodes: assignments.map((assignment) => assignment.noteId) }] })
        setGraphSource({ id: activeCommunity.graphSourceId ?? activeCommunity.id, name: activeCommunity.name })
        setStatus({ loading: false, error: null, freshness: activeCommunity.freshness ?? 'unknown', cache: null })
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setStatus((current) => ({ ...current, loading: false, error: e }))
      throw e
    }
  }, [db, mode, selectorKey, communitySourceId, filtersKey])

  const setMode = useCallback((nextMode: GraphSourceMode) => {
    setTransitionReason(nextMode, 'mode-change')
    setModeState(nextMode)
  }, [setTransitionReason])

  const setEmbeddingSetSelector = useCallback((selector: EmbeddingSetSelector) => {
    setEmbeddingSetSelectorState(selector)
    setTransitionReason('topics', 'embedding-set-change')
    setModeState('topics')
  }, [setTransitionReason])

  const setCommunitySource = useCallback((sourceId: string | null) => {
    setCommunitySourceId(sourceId)
    setTransitionReason(mode, 'community-source-change')
  }, [mode, setTransitionReason])

  const setFilters = useCallback((nextFilters: CommunityFilterDefinition) => {
    setFiltersState(nextFilters)
    setTransitionReason('dynamic-search', 'filter-change')
    setModeState('dynamic-search')
  }, [setTransitionReason])

  const recompute = useCallback(async () => {
    setTransitionReason(mode, 'recompute')
    if (mode === 'topics' && embeddingSetSelector) {
      const result = await new GraphRepository(db).buildOrLoadSimilarityGraph({ selector: embeddingSetSelector, source: 'live-only' })
      setGraph(result.graph)
      setGraphSource(result.graphSource)
      setStatus({ loading: false, error: null, freshness: result.freshness, cache: result.cache })
      return
    }
    await refresh()
  }, [db, mode, selectorKey, refresh, setTransitionReason])

  const previewDynamicCommunity = useCallback(async (nextFilters: CommunityFilterDefinition) => {
    setFilters(nextFilters)
    await refresh()
  }, [refresh, setFilters])

  const saveCurrentCommunity = useCallback(async (input: CommunityCreateInput) => {
    const source = await new CommunitiesRepository(db).saveCommunity(input)
    setCommunitySourceId(source.id)
    setCommunitySourceState(source)
    return source
  }, [db])

  useEffect(() => { void refresh() }, [refresh])

  return {
    mode,
    graph,
    graphSource,
    communitySource,
    embeddingSetSelector,
    filters,
    layout,
    status,
    transition,
    setMode,
    setEmbeddingSetSelector,
    setCommunitySource,
    setFilters,
    refresh,
    recompute,
    previewDynamicCommunity,
    saveCurrentCommunity,
  }
}
