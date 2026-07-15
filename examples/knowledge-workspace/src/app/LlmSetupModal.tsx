// src/components/fortemi/LlmSetupModal.tsx
//
// On-demand "turn on AI features" modal for the /fortemi app. Opened only when
// the user does something that wants a language model (or from the Capabilities
// tab). Two stupid-simple paths:
//
//   1. On this device — a yes/no download of an in-browser model. We warn with
//      the size and a rough time estimate BEFORE anything is fetched; the heavy
//      @mlc-ai/web-llm library is only loaded once the user clicks the button
//      (the import lives in llmSetup.enableLocalLlm).
//   2. Use a provider — paste an OpenAI-compatible endpoint + key. Presets for
//      OpenRouter, OpenAI, Hugging Face, Groq, Together, and Ollama.
//
// Nothing is downloaded or contacted until the user explicitly acts.

import { useEffect, useState } from 'react';
import type { CapabilityManager } from '@fortemi/core';
import {
  PROVIDER_PRESETS,
  probeLocalModel,
  enableLocalLlm,
  enableRemoteLlm,
  listProviderModels,
  type LlmConfig,
  type LocalModelInfo,
  type ProviderModel,
} from './llmSetup';
import { ModelCombobox } from './ModelCombobox';

const mono = 'var(--font-family-lit-mono)';
const serif = 'var(--font-family-lit-serif)';
const sans = 'var(--font-family-lit-sans)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';
const bg = 'var(--color-lit-bg)';
const bgDeep = 'var(--color-lit-bg-deep)';

function Spinner({ size = 14, color = live }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={rule} strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 4, background: rule, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: live, transition: 'width 0.2s linear' }} />
    </div>
  );
}

// Rough one-time download estimate. Fast ≈ 50 Mbps (6.25 MB/s), slow ≈ 10 Mbps
// (1.25 MB/s). Returned in minutes, clamped to whole minutes ≥ 1.
function estimateMinutes(sizeMB: number): { fast: number; slow: number } {
  const fast = Math.max(1, Math.round(sizeMB / 6.25 / 60));
  const slow = Math.max(fast + 1, Math.round(sizeMB / 1.25 / 60));
  return { fast, slow };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  fontFamily: mono,
  fontSize: 13,
  color: ink,
  background: bgDeep,
  border: `1px solid ${rule}`,
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: mono,
  fontSize: 11,
  color: mute,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  margin: '0 0 5px',
};

type Props = {
  open: boolean;
  onClose: () => void;
  manager: CapabilityManager;
  /** A saved 'local' choice exists — show "Resume" wording (weights are cached). */
  savedLocal?: boolean;
  onEnabled: (cfg: LlmConfig) => void;
};

export function LlmSetupModal({ open, onClose, manager, savedLocal, onEnabled }: Props) {
  // local-model path
  const [probe, setProbe] = useState<LocalModelInfo | null>(null);
  const [probing, setProbing] = useState(true);
  const [localPhase, setLocalPhase] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [localPct, setLocalPct] = useState(0);
  const [localText, setLocalText] = useState('');
  const [localErr, setLocalErr] = useState('');

  // provider path
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0].id);
  const [baseURL, setBaseURL] = useState(PROVIDER_PRESETS[0].baseURL);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [remotePhase, setRemotePhase] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [remoteErr, setRemoteErr] = useState('');
  // reactive model lookup: once the provider + key are sufficient, fetch the
  // provider's /models so the model field autocompletes instead of being typed.
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [modelsErr, setModelsErr] = useState('');

  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0];
  const busy = localPhase === 'downloading' || remotePhase === 'connecting';
  // Enough to attempt a lookup: a base URL, and either a keyless provider or a
  // plausibly-complete key (avoids firing 401s on every keystroke).
  const canLookup = baseURL.trim().length > 0 && (preset.keyless || apiKey.trim().length >= 8);

  // Reactive lookup, debounced. Re-runs when provider / URL / key change.
  useEffect(() => {
    if (!open) return;
    setModels(null);
    setModelsErr('');
    if (!canLookup) {
      setModelsState('idle');
      return;
    }
    let alive = true;
    setModelsState('loading');
    const t = setTimeout(() => {
      void listProviderModels({ baseURL: baseURL.trim(), apiKey: apiKey.trim() || undefined, defaultModel: model.trim() })
        .then((list) => {
          if (!alive) return;
          setModels(list);
          setModelsState('loaded');
          // if the current model isn't in the list, default to the first chat model
          setModel((cur) => (list.some((m) => m.id === cur) ? cur : list.find((m) => m.chat)?.id ?? cur));
        })
        .catch((e) => {
          if (!alive) return;
          setModelsErr((e as Error).message);
          setModelsState('error');
        });
    }, 700);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // model is intentionally excluded — we don't want to re-fetch on every model keystroke
  }, [open, presetId, baseURL, apiKey, canLookup]);

  // Probe WebGPU + pick a device model when the modal opens (no heavy import).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setProbing(true);
    void probeLocalModel()
      .then((info) => {
        if (alive) setProbe(info);
      })
      .catch(() => {
        if (alive) setProbe({ webgpu: false, modelId: '', sizeMB: 0 });
      })
      .finally(() => {
        if (alive) setProbing(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  function onPreset(id: string) {
    setPresetId(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (p) {
      setBaseURL(p.baseURL);
      setModel(p.defaultModel);
    }
    setRemotePhase('idle');
    setRemoteErr('');
  }

  async function startLocal() {
    setLocalErr('');
    setLocalPhase('downloading');
    setLocalPct(0);
    setLocalText(savedLocal ? 'Loading cached model…' : 'Starting download…');
    try {
      await enableLocalLlm(manager, (pct, text) => {
        setLocalPct(pct);
        if (text) setLocalText(text);
      });
      onEnabled({ kind: 'local' });
    } catch (e) {
      setLocalErr((e as Error).message);
      setLocalPhase('error');
    }
  }

  async function connectRemote(e: React.FormEvent) {
    e.preventDefault();
    setRemoteErr('');
    setRemotePhase('connecting');
    try {
      const cfg = {
        preset: presetId,
        baseURL: baseURL.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        label: preset.label,
      };
      await enableRemoteLlm(manager, cfg);
      onEnabled({ kind: 'remote', ...cfg });
    } catch (e2) {
      setRemoteErr((e2 as Error).message);
      setRemotePhase('error');
    }
  }

  if (!open) return null;

  const est = probe?.webgpu ? estimateMinutes(probe.sizeMB) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enable AI features"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '7vh 16px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: bg,
          border: `1px solid ${rule}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          padding: '28px 28px 32px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <p style={{ fontFamily: mono, fontSize: 11, color: mute, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
              AI features
            </p>
            <h2 style={{ fontFamily: sans, fontWeight: 600, fontSize: 22, color: ink, margin: 0, letterSpacing: '-0.01em' }}>
              Turn on a language model
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: busy ? rule : mute,
              fontSize: 22,
              lineHeight: 1,
              cursor: busy ? 'default' : 'pointer',
              padding: 4,
              marginTop: -4,
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontFamily: serif, fontSize: 15, color: mute, lineHeight: 1.6, margin: '14px 0 24px', maxWidth: '54ch' }}>
          Search works without this. A language model adds the extras — auto-tagging note concepts,
          generating titles, summaries. Pick a path; nothing downloads or connects until you click.
        </p>

        {/* ── 1. On this device ───────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${rule}`, paddingTop: 20 }}>
          <h3 style={{ fontFamily: sans, fontSize: 16, color: ink, margin: '0 0 6px' }}>On this device</h3>
          <p style={{ fontFamily: serif, fontSize: 14, color: mute, lineHeight: 1.55, margin: '0 0 14px', maxWidth: '54ch' }}>
            Runs entirely in your browser on the GPU. Private — nothing leaves the page. The model is a
            one-time download, cached afterward.
          </p>

          {probing && (
            <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}>
              <Spinner color={mute} /> checking your hardware…
            </p>
          )}

          {!probing && probe && !probe.webgpu && (
            <p style={{ fontFamily: mono, fontSize: 13, color: mute, lineHeight: 1.6, background: bgDeep, border: `1px solid ${rule}`, padding: '10px 12px' }}>
              This browser/device can’t run an in-browser model (needs WebGPU — Chrome 113+ or
              Firefox 141+). Use a provider below instead.
            </p>
          )}

          {!probing && probe?.webgpu && localPhase === 'idle' && (
            <>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 13,
                  color: ink,
                  lineHeight: 1.7,
                  background: bgDeep,
                  border: `1px solid ${rule}`,
                  borderLeft: `2px solid ${live}`,
                  padding: '12px 14px',
                  margin: '0 0 14px',
                }}
              >
                <div>
                  <span style={{ color: mute }}>Model:</span> {probe.modelId.replace(/-MLC$/, '').replace(/-q4f\d+_\d+$/, '')}
                </div>
                <div>
                  <span style={{ color: mute }}>Download:</span>{' '}
                  <strong>≈{(probe.sizeMB / 1024).toFixed(1)} GB</strong> ({probe.sizeMB} MB)
                  {est && <> · ~{est.fast}–{est.slow} min on a typical connection</>}
                </div>
                <div style={{ color: mute, fontSize: 12, marginTop: 2 }}>One-time — cached in your browser after the first run.</div>
              </div>
              <button
                type="button"
                onClick={startLocal}
                style={{
                  padding: '10px 18px',
                  fontFamily: mono,
                  fontSize: 14,
                  background: ink,
                  color: bg,
                  border: `1px solid ${ink}`,
                  cursor: 'pointer',
                }}
              >
                {savedLocal ? 'Resume local model' : `Yes — download (${(probe.sizeMB / 1024).toFixed(1)} GB) & enable`}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{ marginLeft: 10, padding: '10px 18px', fontFamily: mono, fontSize: 14, background: 'transparent', color: mute, border: `1px solid ${rule}`, cursor: 'pointer' }}
              >
                Not now
              </button>
            </>
          )}

          {localPhase === 'downloading' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: live }}>
                <Spinner />
                <span>
                  {localText || 'Downloading…'} · {localPct}%
                </span>
              </div>
              <Bar pct={localPct} />
              <p style={{ fontFamily: mono, fontSize: 11, color: mute, margin: '8px 0 0' }}>
                Keep this tab open. First run downloads the weights; later visits load from cache.
              </p>
            </div>
          )}

          {localPhase === 'error' && (
            <div>
              <p style={{ fontFamily: mono, fontSize: 13, color: mute, lineHeight: 1.6, margin: '0 0 10px' }}>
                Couldn’t enable the local model: {localErr}
              </p>
              <button
                type="button"
                onClick={startLocal}
                style={{ padding: '8px 16px', fontFamily: mono, fontSize: 13, background: 'transparent', color: ink, border: `1px solid ${ink}`, cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          )}
        </section>

        {/* ── 2. Use a provider ───────────────────────────────────── */}
        <section style={{ borderTop: `1px solid ${rule}`, paddingTop: 20, marginTop: 24, opacity: localPhase === 'downloading' ? 0.45 : 1, pointerEvents: localPhase === 'downloading' ? 'none' : 'auto' }}>
          <h3 style={{ fontFamily: sans, fontSize: 16, color: ink, margin: '0 0 6px' }}>Use a provider</h3>
          <p style={{ fontFamily: serif, fontSize: 14, color: mute, lineHeight: 1.55, margin: '0 0 14px', maxWidth: '54ch' }}>
            Connect any OpenAI-compatible endpoint. No download — requests go from your browser to the
            provider you choose.
          </p>

          <form onSubmit={connectRemote}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor="llm-preset">Provider</label>
              <select
                id="llm-preset"
                value={presetId}
                onChange={(e) => onPreset(e.target.value)}
                style={{ ...inputStyle, appearance: 'auto' }}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {preset.note && (
                <p style={{ fontFamily: mono, fontSize: 11, color: mute, margin: '5px 0 0' }}>{preset.note}</p>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor="llm-base">Base URL</label>
              <input
                id="llm-base"
                type="text"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://…/v1"
                spellCheck={false}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor="llm-model">Model</label>
              {/* Searchable combobox (not a native datalist): the full provider
                  catalog, chat models first, with its own search — so a default
                  model id no longer narrows the list, and OpenRouter's hundreds
                  of models stay manageable. Any id can still be typed + used. */}
              <ModelCombobox
                value={model}
                onChange={setModel}
                models={models}
                state={modelsState}
                error={modelsErr || (modelsState === 'error' ? 'no /models endpoint' : undefined)}
                disabled={busy}
              />
            </div>

            {!preset.keyless && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle} htmlFor="llm-key">API key</label>
                <input
                  id="llm-key"
                  // Not a login credential — tell password managers (1Password,
                  // LastPass, Bitwarden) to ignore it so their autofill overlay
                  // doesn't cover the model picker. Still masked via type=password.
                  name="fortemi-provider-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={preset.keyHint ?? 'sk-…'}
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  spellCheck={false}
                  style={inputStyle}
                />
                <p style={{ fontFamily: mono, fontSize: 11, color: mute, margin: '5px 0 0', lineHeight: 1.5 }}>
                  Stored only in this browser (localStorage) so it persists across visits. It’s sent
                  to the endpoint you chose and nowhere else. Clear it any time from Capabilities.
                </p>
              </div>
            )}

            {remotePhase === 'error' && (
              <p style={{ fontFamily: mono, fontSize: 12, color: mute, lineHeight: 1.6, margin: '0 0 12px' }}>
                {remoteErr}
              </p>
            )}

            <button
              type="submit"
              disabled={remotePhase === 'connecting' || !baseURL.trim() || !model.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '1ch',
                padding: '9px 18px',
                fontFamily: mono,
                fontSize: 14,
                background: 'transparent',
                color: !baseURL.trim() || !model.trim() ? rule : ink,
                border: `1px solid ${!baseURL.trim() || !model.trim() ? rule : ink}`,
                cursor: remotePhase === 'connecting' || !baseURL.trim() || !model.trim() ? 'default' : 'pointer',
              }}
            >
              {remotePhase === 'connecting' && <Spinner />}
              {remotePhase === 'connecting' ? 'Connecting…' : 'Connect & enable'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default LlmSetupModal;
