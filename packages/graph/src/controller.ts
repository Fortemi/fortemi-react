// Framework-agnostic graph-source controller.
//
// Owns the graph "source mode" state machine (citations | topics | precomputed
// | dynamic-search | user-authored), transition tracking, and the mode→fetch
// dispatch. The capability previously lived inside the React `useGraphController`
// hook; it now lives here so JS-only hosts can drive the same logic without
// React. The React hook is a thin `useSyncExternalStore` adapter over this class.
//
// This module depends on @fortemi/core for the repositories and shared types.
// @fortemi/core never depends on @fortemi/graph — the dependency direction is
// the linear chain: pglite ← @fortemi/core ← @fortemi/graph ← @fortemi/react.

import {
  CommunitiesRepository,
  GraphRepository,
  type CommunityCreateInput,
  type CommunityFilterDefinition,
  type CommunityGraph,
  type CommunitySourceDescriptor,
  type DatabaseClient,
  type EmbeddingSetSelector,
  type QueryExecutor,
  type SimilarityGraphResult,
} from '@fortemi/core'
import type { GraphLayoutAlgorithm } from './types.js'

/** A database handle accepted by the underlying repositories. */
export type GraphControllerDb = QueryExecutor & DatabaseClient

export type GraphSourceMode =
  | 'citations'
  | 'topics'
  | 'precomputed'
  | 'dynamic-search'
  | 'user-authored'

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

export type GraphSourceRef = SimilarityGraphResult['graphSource'] | { id: string; name: string }

/** The full, framework-agnostic controller state surfaced to subscribers. */
export interface GraphControllerState {
  mode: GraphSourceMode
  graph: CommunityGraph | null
  graphSource?: GraphSourceRef
  communitySource?: CommunitySourceDescriptor
  embeddingSetSelector?: EmbeddingSetSelector
  filters?: CommunityFilterDefinition
  layout: GraphLayoutState
  status: GraphControllerStatus
  transition?: GraphTransitionState
}

export interface GraphControllerOptions {
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

export type GraphControllerListener = (state: GraphControllerState) => void

/**
 * Drives graph-source selection and loading independent of any UI framework.
 *
 * Construct with pre-built repositories (handy for tests) or via
 * {@link GraphController.fromDb}. Subscribe with {@link subscribe} and read the
 * current state with {@link getState}; call {@link start} once to trigger the
 * initial load. Setters update state and schedule a refresh, mirroring the
 * effect-driven behavior of the original React hook.
 */
export class GraphController {
  private readonly graphRepo: GraphRepository
  private readonly communityRepo: CommunitiesRepository
  private readonly listeners = new Set<GraphControllerListener>()
  private communitySourceId: string | null
  private state: GraphControllerState

  /** Build a controller from a database handle (production path). */
  static fromDb(db: GraphControllerDb, options: GraphControllerOptions = {}): GraphController {
    return new GraphController(new GraphRepository(db), new CommunitiesRepository(db), options)
  }

  constructor(
    graphRepo: GraphRepository,
    communityRepo: CommunitiesRepository,
    options: GraphControllerOptions = {},
  ) {
    this.graphRepo = graphRepo
    this.communityRepo = communityRepo
    this.communitySourceId = options.initialCommunitySourceId ?? null
    this.state = {
      mode: options.initialMode ?? 'citations',
      graph: null,
      graphSource: undefined,
      communitySource: undefined,
      embeddingSetSelector: options.initialEmbeddingSetSelector,
      filters: options.initialFilters,
      layout: { ...DEFAULT_LAYOUT, ...options.layout },
      status: { loading: false, error: null, freshness: null, cache: null },
      transition: undefined,
    }
  }

  getState(): GraphControllerState {
    return this.state
  }

  subscribe(listener: GraphControllerListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Run the initial load. Call once after construction (the hook calls this on mount). */
  async start(): Promise<void> {
    await this.refresh()
  }

  private setState(patch: Partial<GraphControllerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private beginTransition(
    toMode: GraphSourceMode,
    reason: GraphTransitionState['reason'],
    fromMode: GraphSourceMode = this.state.mode,
  ): void {
    this.setState({ transition: { fromMode, toMode, reason, startedAt: new Date().toISOString() } })
  }

  async refresh(): Promise<void> {
    try {
      this.setState({ status: { ...this.state.status, loading: true, error: null } })
      const sources = await this.communityRepo.listCommunitySources()
      const activeCommunity = this.communitySourceId
        ? sources.find((source) => source.id === this.communitySourceId)
        : undefined
      this.setState({ communitySource: activeCommunity })

      const mode = this.state.mode

      if (mode === 'citations') {
        const nextGraph = await this.graphRepo.buildLinkGraph()
        this.setState({
          graph: nextGraph,
          graphSource: { id: 'citations', name: 'Citation graph' },
          status: { loading: false, error: null, freshness: 'fresh', cache: null },
        })
        return
      }

      if (mode === 'topics') {
        const selector = this.state.embeddingSetSelector
        if (!selector) throw new Error('topics mode requires an embedding-set selector')
        const result = await this.graphRepo.buildOrLoadSimilarityGraph({ selector })
        this.setState({
          graph: result.graph,
          graphSource: result.graphSource,
          status: { loading: false, error: null, freshness: result.freshness, cache: result.cache },
        })
        return
      }

      if (mode === 'precomputed') {
        if (!activeCommunity?.graphSourceId) {
          throw new Error('precomputed mode requires a community source with graphSourceId')
        }
        const assignments = await this.communityRepo.getCommunityAssignments(activeCommunity.id)
        const nextGraph = await this.graphRepo.loadGraphArtifact(
          activeCommunity.graphSourceId,
          assignments.map((assignment) => assignment.noteId),
        )
        this.setState({
          graph: nextGraph,
          graphSource: { id: activeCommunity.graphSourceId, name: activeCommunity.name },
          status: { loading: false, error: null, freshness: activeCommunity.freshness ?? 'unknown', cache: null },
        })
        return
      }

      if (mode === 'dynamic-search') {
        const assignments = await this.communityRepo.previewDynamicCommunity(this.state.filters ?? {})
        this.setState({
          graph: {
            nodes: assignments.map((assignment) => ({ id: assignment.noteId })),
            edges: [],
            communities: [{ id: 'dynamic-preview', nodes: assignments.map((assignment) => assignment.noteId) }],
          },
          graphSource: { id: 'dynamic-preview', name: 'Dynamic preview' },
          status: { loading: false, error: null, freshness: 'unknown', cache: null },
        })
        return
      }

      if (mode === 'user-authored') {
        if (!activeCommunity) throw new Error('user-authored mode requires an active community source')
        const assignments = await this.communityRepo.getCommunityAssignments(activeCommunity.id)
        this.setState({
          graph: {
            nodes: assignments.map((assignment) => ({ id: assignment.noteId })),
            edges: [],
            communities: [{ id: activeCommunity.id, nodes: assignments.map((assignment) => assignment.noteId) }],
          },
          graphSource: { id: activeCommunity.graphSourceId ?? activeCommunity.id, name: activeCommunity.name },
          status: { loading: false, error: null, freshness: activeCommunity.freshness ?? 'unknown', cache: null },
        })
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      this.setState({ status: { ...this.state.status, loading: false, error: e } })
      throw e
    }
  }

  setMode(nextMode: GraphSourceMode): void {
    this.beginTransition(nextMode, 'mode-change')
    this.setState({ mode: nextMode })
    void this.refresh()
  }

  setEmbeddingSetSelector(selector: EmbeddingSetSelector): void {
    this.beginTransition('topics', 'embedding-set-change')
    this.setState({ embeddingSetSelector: selector, mode: 'topics' })
    void this.refresh()
  }

  setCommunitySource(sourceId: string | null): void {
    this.communitySourceId = sourceId
    this.beginTransition(this.state.mode, 'community-source-change')
    void this.refresh()
  }

  /** Apply dynamic-search filters and switch into that mode (state only). */
  private applyFilters(nextFilters: CommunityFilterDefinition): void {
    this.beginTransition('dynamic-search', 'filter-change')
    this.setState({ filters: nextFilters, mode: 'dynamic-search' })
  }

  setFilters(nextFilters: CommunityFilterDefinition): void {
    this.applyFilters(nextFilters)
    void this.refresh()
  }

  async recompute(): Promise<void> {
    this.beginTransition(this.state.mode, 'recompute')
    if (this.state.mode === 'topics' && this.state.embeddingSetSelector) {
      const result = await this.graphRepo.buildOrLoadSimilarityGraph({
        selector: this.state.embeddingSetSelector,
        source: 'live-only',
      })
      this.setState({
        graph: result.graph,
        graphSource: result.graphSource,
        status: { loading: false, error: null, freshness: result.freshness, cache: result.cache },
      })
      return
    }
    await this.refresh()
  }

  async previewDynamicCommunity(nextFilters: CommunityFilterDefinition): Promise<void> {
    this.applyFilters(nextFilters)
    await this.refresh()
  }

  async saveCurrentCommunity(input: CommunityCreateInput): Promise<CommunitySourceDescriptor> {
    const source = await this.communityRepo.saveCommunity(input)
    this.communitySourceId = source.id
    this.setState({ communitySource: source })
    return source
  }
}
