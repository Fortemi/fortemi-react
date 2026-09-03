import { useEffect, useMemo, useState } from 'react'
import { useFortemiContext } from '@fortemi/react'
import type { InferenceProvider, ProviderDataClass, ProviderProfile } from '@fortemi/core'
import { getProviderRouteRequirementIssue } from '@fortemi/core'
import {
  activateProvider,
  applyProviderRouteConfigs,
  clearProviderApiKey,
  createSuggestedProviderRouteConfigs,
  discoverAndMergeLocalProviderConfigs,
  hasSecureStorage,
  loadProviderConfigs,
  loadProviderRouteConfigs,
  ROUTE_TASKS,
  refreshProviderModels,
  saveProviderConfigs,
  saveProviderRouteConfigs,
  setProviderApiKey,
  syncConfiguredProviders,
  type ProviderPresetId,
  type StoredProviderRouteConfig,
  type StoredProviderConfig,
} from '../capabilities/provider-config'

const LOCAL_PRESETS = new Set<ProviderPresetId>(['ollama', 'lm-studio', 'llama-cpp', 'vllm', 'jan'])
const DATA_CLASSES: ProviderDataClass[] = ['public', 'private', 'sensitive', 'regulated']

function ProviderBadge({ config, secureStorage }: { config: StoredProviderConfig; secureStorage: boolean }) {
  const text = config.id === 'browser'
    ? 'in-browser'
    : config.requiresApiKey
      ? secureStorage ? 'secure key' : 'locked'
      : config.tier === 'local-server' || LOCAL_PRESETS.has(config.presetId) ? 'local' : 'no key'
  const color = config.requiresApiKey && !secureStorage ? '#c5221f' : config.active ? '#1e7e34' : '#666'
  return (
    <span style={{ color, fontSize: 11, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px' }}>
      {text}
    </span>
  )
}

export function ProviderSettings() {
  const { capabilityManager, events, providerRegistry } = useFortemiContext()
  const [configs, setConfigs] = useState<StoredProviderConfig[]>(() => loadProviderConfigs())
  const [secureStorage, setSecureStorage] = useState(false)
  const [status, setStatus] = useState<Record<string, string>>({})
  const [discoveryStatus, setDiscoveryStatus] = useState<string>('')
  const [discovering, setDiscovering] = useState(false)
  const [routeConfigStatus, setRouteConfigStatus] = useState('')
  const [routeStatus, setRouteStatus] = useState<Record<string, string>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [routes, setRoutes] = useState<StoredProviderRouteConfig[]>(() => loadProviderRouteConfigs())
  const activeConfig = useMemo(() => configs.find((config) => config.active), [configs])
  const providerOptions = useMemo(() => configs.filter((config) => {
    if (!config.requiresApiKey) return true
    return secureStorage
  }), [configs, secureStorage])
  const routeValidationIssues = useMemo(() => {
    return providerRegistry.validateRoutes().flatMap((validation) =>
      validation.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message),
    )
  }, [providerRegistry, routes, configs])

  useEffect(() => {
    hasSecureStorage().then(setSecureStorage).catch(() => setSecureStorage(false))
  }, [])

  const persist = (next: StoredProviderConfig[]) => {
    setConfigs(next)
    saveProviderConfigs(next)
  }

  const syncProviders = async (next: StoredProviderConfig[], statusId?: string) => {
    const result = await syncConfiguredProviders(next, capabilityManager, events, providerRegistry)
    if (statusId) {
      setStatus((prev) => ({ ...prev, [statusId]: result.message }))
    }
  }

  const persistRoutes = (next: StoredProviderRouteConfig[]) => {
    setRoutes(next)
    saveProviderRouteConfigs(next)
    applyProviderRouteConfigs(next, providerRegistry)
  }

  const updateConfig = (id: string, patch: Partial<StoredProviderConfig>) => {
    const next = configs.map((config) => config.id === id ? { ...config, ...patch } : config)
    persist(next)
    syncProviders(next, id).catch((err) => {
      setStatus((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }))
    })
  }

  const updateProfile = (id: string, patch: ProviderProfile) => {
    const config = configs.find((item) => item.id === id)
    updateConfig(id, {
      profile: {
        ...(config?.profile ?? {}),
        ...patch,
      },
    })
  }

  const updateRoute = (task: StoredProviderRouteConfig['task'], patch: Partial<StoredProviderRouteConfig>) => {
    persistRoutes(routes.map((route) => route.task === task ? { ...route, ...patch } : route))
  }

  const updateRouteProviderId = (task: StoredProviderRouteConfig['task'], index: number, providerId: string) => {
    const route = routes.find((item) => item.task === task)
    const providerIds = routeProviderIds(route)
    providerIds[index] = providerId
    const nextProviderIds = providerIds
      .map((id) => id.trim())
      .filter((id, position, all) => id.length > 0 && all.indexOf(id) === position)

    updateRoute(task, {
      providerId: nextProviderIds[0] ?? '',
      providerIds: nextProviderIds,
    })
  }

  const activate = async (config: StoredProviderConfig) => {
    const next = configs.map((item) => ({ ...item, active: item.id === config.id }))
    persist(next)
    const updated = next.find((item) => item.id === config.id) ?? config
    const result = providerRegistry
      ? await syncConfiguredProviders(next, capabilityManager, events, providerRegistry)
      : await activateProvider(updated, capabilityManager, events)
    setStatus((prev) => ({ ...prev, [config.id]: result.message }))
  }

  const saveKey = async (config: StoredProviderConfig) => {
    const value = apiKeys[config.id]?.trim()
    if (!value) return
    try {
      await setProviderApiKey(config.id, value)
      setApiKeys((prev) => ({ ...prev, [config.id]: '' }))
      setStatus((prev) => ({ ...prev, [config.id]: 'API key saved to secure storage.' }))
      await syncProviders(configs, config.id)
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        [config.id]: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const clearKey = async (config: StoredProviderConfig) => {
    await clearProviderApiKey(config.id)
    setStatus((prev) => ({ ...prev, [config.id]: 'API key removed from secure storage.' }))
    await syncProviders(configs, config.id)
  }

  const probe = async (config: StoredProviderConfig) => {
    setStatus((prev) => ({ ...prev, [config.id]: 'Probing...' }))
    const result = await refreshProviderModels(config)
    if (result.ok && result.config !== config) {
      const next = configs.map((item) => item.id === config.id ? result.config : item)
      persist(next)
      await syncProviders(next, config.id)
    }
    setStatus((prev) => ({ ...prev, [config.id]: result.message }))
  }

  const discoverLocal = async () => {
    setDiscovering(true)
    setDiscoveryStatus('Discovering local providers...')
    try {
      const result = await discoverAndMergeLocalProviderConfigs(configs, { timeoutMs: 1500 })
      persist(result.configs)
      await syncProviders(result.configs)
      applyProviderRouteConfigs(routes, providerRegistry)
      setDiscoveryStatus(result.message)
    } catch (err) {
      setDiscoveryStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscovering(false)
    }
  }

  const probeRoute = async (
    route: StoredProviderRouteConfig | undefined,
    task: typeof ROUTE_TASKS[number],
  ) => {
    setRouteStatus((prev) => ({ ...prev, [task.task]: 'Probing...' }))
    try {
      const result = await providerRegistry.probeRoute(task.task, task.capability, route?.model)
      setRouteStatus((prev) => ({
        ...prev,
        [task.task]: `${result.providerName}: ${result.probe.message ?? result.probe.status} (${result.probe.latencyMs}ms)`,
      }))
    } catch (err) {
      setRouteStatus((prev) => ({
        ...prev,
        [task.task]: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const suggestRoutes = () => {
    const next = createSuggestedProviderRouteConfigs(providerOptions)
    persistRoutes(next)
    const configured = next.filter((route) => route.providerIds?.length || route.providerId)
    setRouteConfigStatus(`Suggested ${configured.length} local-first task route${configured.length === 1 ? '' : 's'}.`)
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Inference Providers</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={discoverLocal}
            disabled={discovering}
            style={{ fontSize: 11, padding: '3px 8px', cursor: discovering ? 'wait' : 'pointer' }}
          >
            {discovering ? 'Discovering...' : 'Discover local'}
          </button>
          <span style={{ fontSize: 11, color: secureStorage ? '#1e7e34' : '#c5221f' }}>
            Secure storage: {secureStorage ? 'available' : 'not available'}
          </span>
        </div>
      </div>

      {discoveryStatus && (
        <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
          {discoveryStatus}
        </div>
      )}

      {!secureStorage && (
        <div style={{ fontSize: 12, color: '#8a5a00', background: '#fff8e1', padding: 8, borderRadius: 4, marginBottom: 10 }}>
          Keyed remote services are disabled because this browser host has no secure secret storage bridge. API keys are never stored in localStorage or IndexedDB.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {configs.map((config) => {
          const keyedUnavailable = config.requiresApiKey && !secureStorage
          const isBrowser = config.id === 'browser'
          return (
            <div key={config.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="active-provider"
                    checked={activeConfig?.id === config.id}
                    disabled={keyedUnavailable}
                    onChange={() => activate(config)}
                  />
                  <strong style={{ fontSize: 13 }}>{config.name}</strong>
                  <ProviderBadge config={config} secureStorage={secureStorage} />
                </div>
                {!isBrowser && (
                  <button
                    onClick={() => probe(config)}
                    disabled={keyedUnavailable}
                    style={{ fontSize: 11, padding: '3px 8px', cursor: keyedUnavailable ? 'not-allowed' : 'pointer' }}
                  >
                    Probe
                  </button>
                )}
              </div>

              {!isBrowser && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                  <input
                    value={config.baseURL}
                    onChange={(e) => updateConfig(config.id, { baseURL: e.target.value })}
                    placeholder="Base URL"
                    style={{ fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                  />
                  <input
                    value={config.defaultModel}
                    onChange={(e) => updateConfig(config.id, { defaultModel: e.target.value })}
                    placeholder="Chat model"
                    style={{ fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                  />
                  <input
                    value={config.defaultEmbeddingModel ?? ''}
                    onChange={(e) => updateConfig(config.id, { defaultEmbeddingModel: e.target.value || undefined })}
                    placeholder="Embedding model"
                    style={{ fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                  />
                  {config.requiresApiKey ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="password"
                        value={apiKeys[config.id] ?? ''}
                        onChange={(e) => setApiKeys((prev) => ({ ...prev, [config.id]: e.target.value }))}
                        disabled={!secureStorage}
                        placeholder="API key"
                        style={{ minWidth: 0, flex: 1, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                      />
                      <button
                        onClick={() => saveKey(config)}
                        disabled={!secureStorage || !apiKeys[config.id]?.trim()}
                        style={{ fontSize: 11, padding: '3px 6px' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => clearKey(config)}
                        disabled={!secureStorage}
                        style={{ fontSize: 11, padding: '3px 6px' }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: '#777', fontSize: 11, alignSelf: 'center' }}>No API key required</span>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, marginTop: 8 }}>
                <select
                  value={config.profile?.privacyTier ?? ''}
                  onChange={(e) => updateProfile(config.id, {
                    privacyTier: e.target.value ? e.target.value as ProviderProfile['privacyTier'] : undefined,
                  })}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Privacy</option>
                  <option value="local">Local</option>
                  <option value="host-managed">Host-managed</option>
                  <option value="external">External</option>
                </select>
                <select
                  value={config.profile?.costTier ?? ''}
                  onChange={(e) => updateProfile(config.id, {
                    costTier: e.target.value ? e.target.value as ProviderProfile['costTier'] : undefined,
                  })}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Cost</option>
                  <option value="free">Free</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input
                  value={formatNumberList(config.profile?.embeddingDimensions)}
                  onChange={(e) => updateProfile(config.id, { embeddingDimensions: parseNumberList(e.target.value) })}
                  placeholder="Embedding dims"
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <input
                  type="number"
                  min={1}
                  value={config.profile?.maxInputChars ?? ''}
                  onChange={(e) => updateProfile(config.id, { maxInputChars: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Max input chars"
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <input
                  value={formatDataClasses(config.profile?.dataClasses)}
                  onChange={(e) => updateProfile(config.id, { dataClasses: parseDataClasses(e.target.value) })}
                  placeholder="Data classes"
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                />
              </div>

              {status[config.id] && (
                <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>{status[config.id]}</div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: '1px solid #eee', marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>Task routes</h4>
          <button
            onClick={suggestRoutes}
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            Suggest routes
          </button>
        </div>
        {routeConfigStatus && (
          <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
            {routeConfigStatus}
          </div>
        )}
        {routeValidationIssues.length > 0 && (
          <div style={{ fontSize: 12, color: '#8a5a00', background: '#fff8e1', padding: 8, borderRadius: 4, marginBottom: 10 }}>
            {routeValidationIssues.length} route issue{routeValidationIssues.length === 1 ? '' : 's'} need attention.
          </div>
        )}
        <div style={{ display: 'grid', gap: 8 }}>
          {ROUTE_TASKS.map((task) => {
            const route = routes.find((item) => item.task === task.task)
            const isEmbedding = task.capability === 'embeddings'
            const routeIssue = getRouteIssue(route, task.capability, providerRegistry)
            const providerIds = routeProviderIds(route)
            return (
              <div
                key={task.task}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                <label style={{ fontSize: 11, color: '#444' }}>{task.label}</label>
                <select
                  value={providerIds[0] ?? ''}
                  onChange={(event) => updateRouteProviderId(task.task, 0, event.target.value)}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Active provider</option>
                  {providerOptions.map((config) => (
                    <option key={config.id} value={config.id}>{config.name}</option>
                  ))}
                </select>
                <select
                  value={providerIds[1] ?? ''}
                  onChange={(event) => updateRouteProviderId(task.task, 1, event.target.value)}
                  disabled={!route?.fallback}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Fallback 1</option>
                  {providerOptions.map((config) => (
                    <option key={config.id} value={config.id}>{config.name}</option>
                  ))}
                </select>
                <select
                  value={providerIds[2] ?? ''}
                  onChange={(event) => updateRouteProviderId(task.task, 2, event.target.value)}
                  disabled={!route?.fallback}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Fallback 2</option>
                  {providerOptions.map((config) => (
                    <option key={config.id} value={config.id}>{config.name}</option>
                  ))}
                </select>
                <input
                  value={route?.model ?? ''}
                  onChange={(event) => updateRoute(task.task, { model: event.target.value || undefined })}
                  placeholder="Model override"
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <select
                  value={route?.maxCostTier ?? ''}
                  onChange={(event) => updateRoute(task.task, { maxCostTier: event.target.value as StoredProviderRouteConfig['maxCostTier'] })}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Any cost</option>
                  <option value="free">Free</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <select
                  value={route?.privacyTier ?? ''}
                  onChange={(event) => updateRoute(task.task, { privacyTier: event.target.value as StoredProviderRouteConfig['privacyTier'] })}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Any privacy</option>
                  <option value="local">Local</option>
                  <option value="host-managed">Host-managed</option>
                  <option value="external">External</option>
                </select>
                {isEmbedding && (
                  <input
                    type="number"
                    min={1}
                    value={route?.minEmbeddingDimensions ?? ''}
                    onChange={(event) => updateRoute(task.task, {
                      minEmbeddingDimensions: event.target.value ? Number(event.target.value) : undefined,
                    })}
                    placeholder="Min dims"
                    style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                  />
                )}
                <select
                  value={route?.dataClass ?? ''}
                  onChange={(event) => updateRoute(task.task, { dataClass: event.target.value as StoredProviderRouteConfig['dataClass'] })}
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="">Any data</option>
                  {DATA_CLASSES.map((dataClass) => (
                    <option key={dataClass} value={dataClass}>{dataClass}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={route?.maxInputChars ?? ''}
                  onChange={(event) => updateRoute(task.task, {
                    maxInputChars: event.target.value ? Number(event.target.value) : undefined,
                  })}
                  placeholder="Input chars"
                  style={{ minWidth: 0, fontSize: 11, padding: 5, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#444' }}>
                  <input
                    type="checkbox"
                    checked={route?.fallback ?? true}
                    onChange={(event) => updateRoute(task.task, { fallback: event.target.checked })}
                  />
                  Fallback
                </label>
                <button
                  onClick={() => probeRoute(route, task)}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Probe route
                </button>
                {routeIssue && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#8a5a00' }}>
                    {routeIssue}
                  </div>
                )}
                {routeStatus[task.task] && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#666' }}>
                    {routeStatus[task.task]}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatNumberList(values: number[] | undefined): string {
  return values?.join(', ') ?? ''
}

function parseNumberList(value: string): number[] | undefined {
  const parsed = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number) && number > 0)
  return parsed.length ? parsed : undefined
}

function formatDataClasses(values: ProviderDataClass[] | undefined): string {
  return values?.join(', ') ?? ''
}

function parseDataClasses(value: string): ProviderDataClass[] | undefined {
  const parsed = value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is ProviderDataClass => DATA_CLASSES.includes(part as ProviderDataClass))
  return parsed.length ? parsed : undefined
}

function routeProviderIds(route: StoredProviderRouteConfig | undefined): string[] {
  if (!route) return []
  const ids = route.providerIds?.length ? route.providerIds : [route.providerId]
  return ids.filter(Boolean)
}

function getRouteIssue(
  route: StoredProviderRouteConfig | undefined,
  capability: 'embeddings' | 'chat',
  providerRegistry: { get(id: string): InferenceProvider | undefined },
): string | undefined {
  const providerIds = routeProviderIds(route)
  if (!route || !providerIds.length) return undefined

  for (const providerId of providerIds) {
    const provider = providerRegistry.get(providerId)
    const label = providerIds.length > 1 ? `${providerId}: ` : ''
    if (!provider) return `${label}Selected provider is not currently registered.`
    if (!provider.capabilities[capability]) return `${label}Selected provider does not support ${capability}.`
    const issue = getProviderRouteRequirementIssue(provider, {
      privacyTiers: route.privacyTier ? [route.privacyTier] : undefined,
      maxCostTier: route.maxCostTier || undefined,
      dataClass: route.dataClass || undefined,
      minEmbeddingDimensions: route.minEmbeddingDimensions,
      maxInputChars: route.maxInputChars,
    }, capability)
    if (!issue) continue
    if (route.privacyTier && issue.includes('privacy')) return `${label}Selected provider does not match ${route.privacyTier} privacy.`
    if (route.maxCostTier && issue.includes('cost')) return `${label}Selected provider does not match ${route.maxCostTier} cost.`
    if (route.dataClass && issue.includes('data class')) return `${label}Selected provider does not allow ${route.dataClass} data.`
    if (route.minEmbeddingDimensions && issue.includes('embedding dimensions')) {
      return `${label}Selected provider does not advertise ${route.minEmbeddingDimensions}+ embedding dimensions.`
    }
    if (route.maxInputChars && issue.includes('input capacity')) {
      return `${label}Selected provider does not advertise ${route.maxInputChars}+ input characters.`
    }
    return `${label}${issue}`
  }

  return undefined
}
