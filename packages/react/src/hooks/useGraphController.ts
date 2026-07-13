import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type {
  CommunityCreateInput,
  CommunityFilterDefinition,
  EmbeddingSetSelector,
} from '@fortemi/core'
import {
  GraphController,
  type GraphControllerOptions,
  type GraphSourceMode,
} from '@fortemi/graph/controller'
import { useFortemiContext } from '../FortemiProvider.js'

// Thin React adapter over @fortemi/graph's framework-agnostic GraphController.
// All graph-source state-machine logic (mode dispatch, transition tracking,
// load orchestration) lives in the controller; this hook only wires the
// controller's observable state into React via useSyncExternalStore and forwards
// the setter methods. The returned shape is unchanged from the previous
// hook-local implementation.

/** Options accepted by {@link useGraphController}. */
export type UseGraphControllerOptions = GraphControllerOptions

export function useGraphController(options: UseGraphControllerOptions = {}) {
  const { db } = useFortemiContext()

  // Initial options are captured once at controller construction (matching the
  // previous `useState(initial)` semantics). A ref avoids re-creating the
  // controller when the caller passes a fresh options object each render.
  const optionsRef = useRef(options)

  const controller = useMemo(
    () => GraphController.fromDb(db, optionsRef.current),
    [db],
  )

  const state = useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.getState(),
    () => controller.getState(),
  )

  // Initial load on mount / when the controller (db) changes.
  useEffect(() => {
    void controller.start()
  }, [controller])

  const actions = useMemo(
    () => ({
      setMode: (mode: GraphSourceMode) => controller.setMode(mode),
      setEmbeddingSetSelector: (selector: EmbeddingSetSelector) => controller.setEmbeddingSetSelector(selector),
      setCommunitySource: (sourceId: string | null) => controller.setCommunitySource(sourceId),
      setFilters: (filters: CommunityFilterDefinition) => controller.setFilters(filters),
      refresh: () => controller.refresh(),
      recompute: () => controller.recompute(),
      previewDynamicCommunity: (filters: CommunityFilterDefinition) => controller.previewDynamicCommunity(filters),
      saveCurrentCommunity: (input: CommunityCreateInput) => controller.saveCurrentCommunity(input),
    }),
    [controller],
  )

  return { ...state, ...actions }
}
