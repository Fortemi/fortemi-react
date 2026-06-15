import { describe, it, expect, vi } from 'vitest'
import type { CommunitiesRepository, CommunityGraph, GraphRepository } from '@fortemi/core'
import { GraphController, type GraphControllerState } from '../controller.js'

// Drives GraphController against fully faked repositories — no React, no PGlite.
// This exercises the mode state machine, transition tracking, and observable
// surface in isolation.

const LINK_GRAPH: CommunityGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ source: 'a', target: 'b', weight: 1 }],
  communities: [{ id: 'c1', nodes: ['a', 'b'] }],
}

const SIM_GRAPH: CommunityGraph = {
  nodes: [{ id: 'x' }],
  edges: [],
  communities: [{ id: 'topic-1', nodes: ['x'] }],
}

function makeRepos(overrides: {
  sources?: Array<Record<string, unknown>>
  assignments?: Array<{ noteId: string }>
} = {}) {
  const graphRepo = {
    buildLinkGraph: vi.fn().mockResolvedValue(LINK_GRAPH),
    buildOrLoadSimilarityGraph: vi.fn().mockResolvedValue({
      graph: SIM_GRAPH,
      graphSource: { id: 'sim-1', name: 'Similarity graph' },
      freshness: 'fresh',
      cache: null,
    }),
    loadGraphArtifact: vi.fn().mockResolvedValue(LINK_GRAPH),
  } as unknown as GraphRepository

  const communityRepo = {
    listCommunitySources: vi.fn().mockResolvedValue(overrides.sources ?? []),
    getCommunityAssignments: vi.fn().mockResolvedValue(overrides.assignments ?? [{ noteId: 'a' }, { noteId: 'b' }]),
    previewDynamicCommunity: vi.fn().mockResolvedValue([{ noteId: 'a' }]),
    saveCommunity: vi.fn().mockResolvedValue({ id: 'saved-1', name: 'Saved' }),
  } as unknown as CommunitiesRepository

  return { graphRepo, communityRepo }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('GraphController', () => {
  it('defaults to citations mode and loads the link graph on start()', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo)

    expect(controller.getState().mode).toBe('citations')
    await controller.start()

    const state = controller.getState()
    expect(graphRepo.buildLinkGraph).toHaveBeenCalledOnce()
    expect(state.graph).toEqual(LINK_GRAPH)
    expect(state.graphSource).toEqual({ id: 'citations', name: 'Citation graph' })
    expect(state.status).toMatchObject({ loading: false, error: null, freshness: 'fresh' })
  })

  it('notifies subscribers and supports unsubscribe', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo)
    const seen: GraphControllerState[] = []
    const unsubscribe = controller.subscribe((s) => seen.push(s))

    await controller.start()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)?.graph).toEqual(LINK_GRAPH)

    const countAfterStart = seen.length
    unsubscribe()
    await controller.refresh()
    expect(seen.length).toBe(countAfterStart) // no further notifications after unsubscribe
  })

  it('switches to topics mode via setEmbeddingSetSelector and records the transition', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo)

    controller.setEmbeddingSetSelector({ kind: 'active' } as never)
    await flush()

    const state = controller.getState()
    expect(state.mode).toBe('topics')
    expect(graphRepo.buildOrLoadSimilarityGraph).toHaveBeenCalledWith({ selector: { kind: 'active' } })
    expect(state.graph).toEqual(SIM_GRAPH)
    expect(state.transition).toMatchObject({ toMode: 'topics', reason: 'embedding-set-change' })
  })

  it('errors in topics mode when no selector is set', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo, { initialMode: 'topics' })

    await expect(controller.refresh()).rejects.toThrow(/embedding-set selector/)
    expect(controller.getState().status.error).toBeInstanceOf(Error)
  })

  it('previewDynamicCommunity switches to dynamic-search and builds a preview community', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo)

    await controller.previewDynamicCommunity({ query: 'foo' } as never)

    const state = controller.getState()
    expect(state.mode).toBe('dynamic-search')
    expect(communityRepo.previewDynamicCommunity).toHaveBeenCalledWith({ query: 'foo' })
    expect(state.graph?.communities).toEqual([{ id: 'dynamic-preview', nodes: ['a'] }])
    expect(state.transition).toMatchObject({ toMode: 'dynamic-search', reason: 'filter-change' })
  })

  it('loads a precomputed artifact when a community source with graphSourceId is active', async () => {
    const { graphRepo, communityRepo } = makeRepos({
      sources: [{ id: 'src-1', name: 'Precomputed', graphSourceId: 'artifact-1', freshness: 'stale' }],
    })
    const controller = new GraphController(graphRepo, communityRepo, {
      initialMode: 'precomputed',
      initialCommunitySourceId: 'src-1',
    })

    await controller.refresh()

    expect(graphRepo.loadGraphArtifact).toHaveBeenCalledWith('artifact-1', ['a', 'b'])
    const state = controller.getState()
    expect(state.graphSource).toEqual({ id: 'artifact-1', name: 'Precomputed' })
    expect(state.status.freshness).toBe('stale')
  })

  it('saveCurrentCommunity persists and adopts the saved source', async () => {
    const { graphRepo, communityRepo } = makeRepos()
    const controller = new GraphController(graphRepo, communityRepo)

    const saved = await controller.saveCurrentCommunity({ name: 'My community' } as never)

    expect(communityRepo.saveCommunity).toHaveBeenCalledWith({ name: 'My community' })
    expect(saved).toEqual({ id: 'saved-1', name: 'Saved' })
    expect(controller.getState().communitySource).toEqual({ id: 'saved-1', name: 'Saved' })
  })

  it('fromDb builds repositories from a db handle', async () => {
    // Minimal db stub good enough for the repositories' constructors; the
    // factory must not throw and must return a working controller instance.
    const db = {} as never
    const controller = GraphController.fromDb(db)
    expect(controller).toBeInstanceOf(GraphController)
    expect(controller.getState().mode).toBe('citations')
  })
})
