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

interface CapabilityCardProps {
  name: CapabilityName
  label: string
  description: string
  size: string
  requires: string
  state: CapabilityState
  error?: string
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
          }}
        >
          {error}
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
  const { capabilityManager } = useFortemiContext()

  const [gpuCaps, setGpuCaps] = useState<GpuCapabilities | null>(null)
  const [vramTier, setVramTier] = useState<VramTier>('unknown')
  const [capabilities, setCapabilities] = useState(capabilityManager.listAll())

  useEffect(() => {
    detectGpuCapabilities().then(caps => {
      setGpuCaps(caps)
      setVramTier(estimateVramTier(caps))
    })
  }, [])

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
            <span style={{ color: '#666' }}>Recommended LLM:</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{selectLlmModel(vramTier)}</span>
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
        onEnable={() => handleEnable('semantic')}
        onDisable={() => handleDisable('semantic')}
      />

      <CapabilityCard
        name="llm"
        label="Local LLM"
        description="Title generation, summarization (Llama-3.2-1B or SmolLM2-360M)"
        size="~376-879 MB"
        requires="WebGPU"
        state={capabilities.find(c => c.name === 'llm')?.state ?? 'unloaded'}
        error={capabilityManager.getError('llm')}
        onEnable={() => handleEnable('llm')}
        onDisable={() => handleDisable('llm')}
      />
    </div>
  )
}
