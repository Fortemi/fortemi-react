import { useEffect, useMemo, useState } from 'react'
import { useFortemiContext } from '@fortemi/react'
import {
  activateProvider,
  clearProviderApiKey,
  hasSecureStorage,
  loadProviderConfigs,
  probeProvider,
  saveProviderConfigs,
  setProviderApiKey,
  type ProviderPresetId,
  type StoredProviderConfig,
} from '../capabilities/provider-config'

const LOCAL_PRESETS = new Set<ProviderPresetId>(['ollama', 'lm-studio', 'llama-cpp', 'vllm', 'jan'])

function ProviderBadge({ config, secureStorage }: { config: StoredProviderConfig; secureStorage: boolean }) {
  const text = config.id === 'browser'
    ? 'in-browser'
    : config.requiresApiKey
      ? secureStorage ? 'secure key' : 'locked'
      : LOCAL_PRESETS.has(config.presetId) ? 'local' : 'no key'
  const color = config.requiresApiKey && !secureStorage ? '#c5221f' : config.active ? '#1e7e34' : '#666'
  return (
    <span style={{ color, fontSize: 11, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px' }}>
      {text}
    </span>
  )
}

export function ProviderSettings() {
  const { capabilityManager, events } = useFortemiContext()
  const [configs, setConfigs] = useState<StoredProviderConfig[]>(() => loadProviderConfigs())
  const [secureStorage, setSecureStorage] = useState(false)
  const [status, setStatus] = useState<Record<string, string>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const activeConfig = useMemo(() => configs.find((config) => config.active), [configs])

  useEffect(() => {
    hasSecureStorage().then(setSecureStorage).catch(() => setSecureStorage(false))
  }, [])

  const persist = (next: StoredProviderConfig[]) => {
    setConfigs(next)
    saveProviderConfigs(next)
  }

  const updateConfig = (id: string, patch: Partial<StoredProviderConfig>) => {
    persist(configs.map((config) => config.id === id ? { ...config, ...patch } : config))
  }

  const activate = async (config: StoredProviderConfig) => {
    const next = configs.map((item) => ({ ...item, active: item.id === config.id }))
    persist(next)
    const updated = next.find((item) => item.id === config.id) ?? config
    const result = await activateProvider(updated, capabilityManager, events)
    setStatus((prev) => ({ ...prev, [config.id]: result.message }))
  }

  const saveKey = async (config: StoredProviderConfig) => {
    const value = apiKeys[config.id]?.trim()
    if (!value) return
    try {
      await setProviderApiKey(config.id, value)
      setApiKeys((prev) => ({ ...prev, [config.id]: '' }))
      setStatus((prev) => ({ ...prev, [config.id]: 'API key saved to secure storage.' }))
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
  }

  const probe = async (config: StoredProviderConfig) => {
    setStatus((prev) => ({ ...prev, [config.id]: 'Probing...' }))
    const result = await probeProvider(config)
    setStatus((prev) => ({ ...prev, [config.id]: result.message }))
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Inference Providers</h3>
        <span style={{ fontSize: 11, color: secureStorage ? '#1e7e34' : '#c5221f' }}>
          Secure storage: {secureStorage ? 'available' : 'not available'}
        </span>
      </div>

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

              {status[config.id] && (
                <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>{status[config.id]}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
