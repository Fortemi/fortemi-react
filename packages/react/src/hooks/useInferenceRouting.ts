import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  InferenceProvider,
  InferenceTask,
  ProviderCapabilities,
  ProviderRegistry,
  ProviderRoutePolicy,
  ProviderRouteProbeResult,
  ProviderRouteSelection,
  ProviderRouteValidation,
  ProviderRouteValidationIssue,
} from '@fortemi/core'
import { inferInferenceTaskCapability } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface UseInferenceRoutingOptions {
  /** Optional task list to validate even before a route is configured. */
  tasks?: InferenceTask[]
}

export interface UseInferenceRoutingReturn {
  providers: InferenceProvider[]
  activeProvider: InferenceProvider | null
  routeValidation: ProviderRouteValidation[]
  routeIssues: ProviderRouteValidationIssue[]
  refresh: () => void
  setActiveProvider: (id: string) => void
  setRoute: (task: InferenceTask, policy: ProviderRoutePolicy) => void
  clearRoute: (task: InferenceTask) => void
  clearRoutes: () => void
  getRoute: (task: InferenceTask) => ProviderRoutePolicy | undefined
  previewRoute: (
    task: InferenceTask | undefined,
    capability?: keyof ProviderCapabilities,
    requestModel?: string,
  ) => ProviderRouteSelection
  probeRoute: (
    task: InferenceTask | undefined,
    capability?: keyof ProviderCapabilities,
    requestModel?: string,
  ) => Promise<ProviderRouteProbeResult>
}

export function useInferenceRouting(
  options: UseInferenceRoutingOptions = {},
): UseInferenceRoutingReturn {
  const { events, providerRegistry } = useFortemiContext()
  const tasksKey = JSON.stringify(options.tasks ?? [])
  const tasksRef = useRef(options.tasks)
  tasksRef.current = options.tasks
  const [snapshot, setSnapshot] = useState(() => getRoutingSnapshot(providerRegistry, options.tasks))

  const refresh = useCallback(() => {
    setSnapshot(getRoutingSnapshot(providerRegistry, tasksRef.current))
  }, [providerRegistry, tasksKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const subscriptions = [
      events.on('provider.added', refresh),
      events.on('provider.removed', refresh),
      events.on('provider.active', refresh),
      events.on('provider.route.configured', refresh),
      events.on('provider.route.cleared', refresh),
    ]
    return () => {
      for (const subscription of subscriptions) {
        subscription.dispose()
      }
    }
  }, [events, refresh])

  const setActiveProvider = useCallback((id: string) => {
    providerRegistry.setActive(id)
    refresh()
  }, [providerRegistry, refresh])

  const setRoute = useCallback((task: InferenceTask, policy: ProviderRoutePolicy) => {
    providerRegistry.setRoute(task, policy)
    refresh()
  }, [providerRegistry, refresh])

  const clearRoute = useCallback((task: InferenceTask) => {
    providerRegistry.clearRoute(task)
    refresh()
  }, [providerRegistry, refresh])

  const clearRoutes = useCallback(() => {
    providerRegistry.clearRoutes()
    refresh()
  }, [providerRegistry, refresh])

  const getRoute = useCallback((task: InferenceTask) => {
    return providerRegistry.getRoute(task)
  }, [providerRegistry])

  const previewRoute = useCallback((
    task: InferenceTask | undefined,
    capability?: keyof ProviderCapabilities,
    requestModel?: string,
  ) => {
    return providerRegistry.previewRoute(
      task,
      capability ?? inferCapability(task),
      requestModel,
    )
  }, [providerRegistry])

  const probeRoute = useCallback((
    task: InferenceTask | undefined,
    capability?: keyof ProviderCapabilities,
    requestModel?: string,
  ) => {
    return providerRegistry.probeRoute(
      task,
      capability ?? inferCapability(task),
      requestModel,
    )
  }, [providerRegistry])

  return {
    ...snapshot,
    refresh,
    setActiveProvider,
    setRoute,
    clearRoute,
    clearRoutes,
    getRoute,
    previewRoute,
    probeRoute,
  }
}

function getRoutingSnapshot(
  providerRegistry: ProviderRegistry,
  tasks: InferenceTask[] | undefined,
) {
  const providers = providerRegistry.list()
  const activeProvider = providerRegistry.getActive()
  const routeValidation = tasks?.length
    ? tasks.map(task => providerRegistry.validateRoute(task))
    : providerRegistry.validateRoutes()

  return {
    providers,
    activeProvider,
    routeValidation,
    routeIssues: routeValidation.flatMap(route => route.issues),
  }
}

function inferCapability(task: InferenceTask | undefined): keyof ProviderCapabilities {
  return task ? inferInferenceTaskCapability(task) : 'chat'
}
