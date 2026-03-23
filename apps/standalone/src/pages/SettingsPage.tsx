/**
 * Settings page — capability management UI (#70).
 * Displays GPU information and allows enabling/disabling AI capabilities.
 */

import { useState, useEffect } from 'react'
import { useFortemiContext } from '@fortemi/react'
import {
  detectGpuCapabilities,
  estimateVramTier,
  selectLlmModel,
  type GpuCapabilities,
  type VramTier,
  type CapabilityName,
  type CapabilityState,
} from '@fortemi/core'
import { LLM_PRESETS, getSelectedLlmModel, setSelectedLlmModel } from '../capabilities/setup'

interface CapabilityCardProps {
  name: CapabilityName
  label: string
  description: string
  size: string
  requires: string
  state: CapabilityState
  error?: string
  progress?: string
  onEnable: () => void
  onDisable: () => void
}

function CapabilityCard({
  label,
  description,
  size,
  requires,
  state,
  error,
  progress,
  onEnable,
  onDisable,
}: CapabilityCardProps) {
  const stateColors: Record<CapabilityState, string> = {
    unloaded: '#999',
    loading: '#4a9eff',
    ready: '#34a853',
    error: '#ea4335',
    disabled: '#999',
  }
  const stateLabels: Record<CapabilityState, string> = {
    unloaded: 'Available',
    loading: 'Loading...',
    ready: 'Active',
    error: 'Error',
    disabled: 'Disabled',
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong>{label}</strong>
        <span style={{ color: stateColors[state], fontSize: 12, fontWeight: 500 }}>
          {stateLabels[state]}
        </span>
      </div>
      <p style={{ color: '#666', fontSize: 13, margin: '0 0 8px' }}>{description}</p>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#999', marginBottom: 8 }}>
        <span>Size: {size}</span>
        <span>Requires: {requires}</span>
      </div>
      {error && (
        <div
          style={{
            background: '#fce8e6',
            color: '#c5221f',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}
      {state === 'loading' && progress && (
        <div
          style={{
            background: '#e8f0fe',
            color: '#1a73e8',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          {progress}
        </div>
      )}
      <div>
        {state === 'unloaded' || state === 'error' || state === 'disabled' ? (
          <button
            onClick={onEnable}
            style={{
              padding: '4px 12px',
              background: '#4a9eff',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Enable
          </button>
        ) : state === 'ready' ? (
          <button
            onClick={onDisable}
            style={{
              padding: '4px 12px',
              border: '1px solid #ddd',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              background: 'white',
            }}
          >
            Disable
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { capabilityManager, events } = useFortemiContext()

  const [gpuCaps, setGpuCaps] = useState<GpuCapabilities | null>(null)
  const [vramTier, setVramTier] = useState<VramTier>('unknown')
  const [capabilities, setCapabilities] = useState(capabilityManager.listAll())

  useEffect(() => {
    detectGpuCapabilities().then(caps => {
      setGpuCaps(caps)
      setVramTier(estimateVramTier(caps))
    })
  }, [])

  const [progressMsg, setProgressMsg] = useState<Record<string, string>>({})

  useEffect(() => {
    const sub = events.on('capability.loading', (e) => {
      const msg = capabilityManager.getProgress(e.name as CapabilityName)
      if (msg) setProgressMsg(prev => ({ ...prev, [e.name]: msg }))
      refresh()
    })
    return () => sub.dispose()
  }, [events, capabilityManager])

  const refresh = () => setCapabilities([...capabilityManager.listAll()])

  const handleEnable = async (name: CapabilityName) => {
    try {
      await capabilityManager.enable(name)
    } catch {
      // Error captured in capability state
    }
    refresh()
  }

  const handleDisable = (name: CapabilityName) => {
    capabilityManager.disable(name)
    refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <button onClick={onBack} style={{ cursor: 'pointer', padding: '4px 8px' }}>
          &larr; Back
        </button>
        <h2 style={{ margin: 0, fontSize: 18 }}>Settings</h2>
      </div>

      {/* GPU Info */}
      <div
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          background: '#f8f9fa',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>GPU Information</h3>
        {gpuCaps ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '4px 16px',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#666' }}>WebGPU:</span>
            <span
              style={{
                color: gpuCaps.webgpuAvailable ? '#34a853' : '#ea4335',
                fontWeight: 500,
              }}
            >
              {gpuCaps.webgpuAvailable ? 'Available' : 'Not Available'}
            </span>
            <span style={{ color: '#666' }}>Vendor:</span>
            <span>{gpuCaps.vendor}</span>
            <span style={{ color: '#666' }}>Architecture:</span>
            <span>{gpuCaps.architecture}</span>
            <span style={{ color: '#666' }}>VRAM Tier:</span>
            <span style={{ fontWeight: 500 }}>{vramTier}</span>
            <span style={{ color: '#666' }}>Shader f16:</span>
            <span style={{ fontWeight: 500, color: gpuCaps.supportsF16 ? '#34a853' : '#f5a623' }}>
              {gpuCaps.supportsF16 ? 'Supported' : 'Not supported (using f32)'}
            </span>
            <span style={{ color: '#666' }}>Recommended LLM:</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{selectLlmModel(vramTier, gpuCaps.supportsF16)}</span>
          </div>
        ) : (
          <p style={{ color: '#999', fontSize: 12 }}>Detecting GPU capabilities...</p>
        )}
      </div>

      {/* Capabilities */}
      <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>AI Capabilities</h3>

      <CapabilityCard
        name="semantic"
        label="Semantic Search"
        description="Embedding model for similarity search (all-MiniLM-L6-v2)"
        size="~23 MB"
        requires="Any browser (WASM fallback)"
        state={capabilities.find(c => c.name === 'semantic')?.state ?? 'unloaded'}
        error={capabilityManager.getError('semantic')}
        progress={progressMsg['semantic']}
        onEnable={() => handleEnable('semantic')}
        onDisable={() => handleDisable('semantic')}
      />

      <CapabilityCard
        name="llm"
        label="Local LLM"
        description="AI revision, concept tagging, title generation"
        size="varies by model"
        requires="WebGPU"
        state={capabilities.find(c => c.name === 'llm')?.state ?? 'unloaded'}
        error={capabilityManager.getError('llm')}
        progress={progressMsg['llm']}
        onEnable={() => handleEnable('llm')}
        onDisable={() => handleDisable('llm')}
      />

      <LlmModelSelector
        gpuCaps={gpuCaps}
        llmState={capabilities.find(c => c.name === 'llm')?.state ?? 'unloaded'}
      />
    </div>
  )
}

function LlmModelSelector({ gpuCaps, llmState }: { gpuCaps: GpuCapabilities | null; llmState: CapabilityState }) {
  const [selected, setSelected] = useState(getSelectedLlmModel())
  const [customModel, setCustomModel] = useState('')
  const autoModel = gpuCaps
    ? selectLlmModel(estimateVramTier(gpuCaps), gpuCaps.supportsF16)
    : 'auto-detect'

  const handleSelect = (modelId: string) => {
    setSelectedLlmModel(modelId)
    setSelected(modelId)
  }

  const handleCustomApply = () => {
    const trimmed = customModel.trim()
    if (trimmed) {
      handleSelect(trimmed)
      setCustomModel('')
    }
  }

  const isActive = llmState === 'ready' || llmState === 'loading'

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#666' }}>LLM Model Selection</h4>
      {isActive && (
        <p style={{ color: '#f5a623', fontSize: 11, margin: '0 0 8px' }}>
          Disable and re-enable LLM to switch models.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {/* Auto-detect option */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="radio"
            name="llm-model"
            checked={!selected}
            onChange={() => handleSelect('')}
            disabled={isActive}
          />
          <span>
            <strong>Auto-detect</strong>
            <span style={{ color: '#999', marginLeft: 6 }}>({autoModel})</span>
          </span>
        </label>

        {/* Preset models */}
        {LLM_PRESETS.map((preset) => (
          <label key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="radio"
              name="llm-model"
              checked={selected === preset.id}
              onChange={() => handleSelect(preset.id)}
              disabled={isActive}
            />
            <span>
              <strong>{preset.label}</strong>
              <span style={{ color: '#999', marginLeft: 6 }}>{preset.size}</span>
            </span>
          </label>
        ))}

        {/* Custom model entry */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
          <input
            type="radio"
            name="llm-model"
            checked={!!selected && !LLM_PRESETS.some(p => p.id === selected)}
            readOnly
          />
          <span><strong>Custom:</strong></span>
        </label>
        <div style={{ display: 'flex', gap: 4, marginLeft: 24 }}>
          <input
            type="text"
            value={selected && !LLM_PRESETS.some(p => p.id === selected) && selected !== '' ? selected : customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="e.g. Llama-3.1-8B-Instruct-q4f32_1-MLC"
            disabled={isActive}
            style={{ flex: 1, padding: '4px 8px', fontSize: 11, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'monospace' }}
          />
          <button
            onClick={handleCustomApply}
            disabled={isActive || !customModel.trim()}
            style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer', background: '#fff' }}
          >
            Apply
          </button>
        </div>
      </div>

      {selected && (
        <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', background: '#f8f9fa', padding: 6, borderRadius: 4 }}>
          Selected: {selected || `auto (${autoModel})`}
        </div>
      )}
    </div>
  )
}
