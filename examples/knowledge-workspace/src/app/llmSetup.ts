// src/components/fortemi/llmSetup.ts
//
// On-demand LLM enablement for the /fortemi app. The deploy ships search-only
// (no LLM); enrichment jobs that need one (concept tagging, summaries) defer
// until the user opts in here. Two paths:
//
//   1. Local in-browser model via @mlc-ai/web-llm (WebGPU). Auto-sized to the
//      device by @fortemi's selectLlmModel(tier). The web-llm library AND the
//      model are downloaded ONLY when the user explicitly chooses to — the
//      import below is dynamic, so the library is a lazy chunk that never loads
//      until enableLocalLlm() runs.
//   2. A remote OpenAI-compatible endpoint: OpenAI, OpenRouter, Hugging Face,
//      Groq, Together, a local Ollama server, or any custom OpenAI-shaped API.
//
// Both register the 'llm' capability so Fortémi's deferred enrichment runs.
// The choice persists in localStorage and is re-applied on launch.

import {
  CapabilityManager,
  setLlmFunction,
  unregisterLlmCapability,
  detectGpuCapabilities,
  estimateVramTier,
  selectLlmModel,
  OpenAICompatibleProvider,
  classifyModel,
  type LlmCompleteFn,
} from '@fortemi/core';

const STORAGE_KEY = 'fortemi-llm-config';

// ── Remote provider presets (all OpenAI-compatible) ───────────────────────────
export type ProviderPreset = {
  id: string;
  label: string;
  baseURL: string;
  defaultModel: string;
  keyHint?: string;
  keyless?: boolean;
  note?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', keyHint: 'sk-or-…' },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyHint: 'sk-…' },
  { id: 'huggingface', label: 'Hugging Face', baseURL: 'https://router.huggingface.co/v1', defaultModel: 'meta-llama/Llama-3.1-8B-Instruct', keyHint: 'hf_…' },
  { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.1-8b-instant', keyHint: 'gsk_…' },
  { id: 'together', label: 'Together AI', baseURL: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyHint: '…' },
  { id: 'ollama', label: 'Ollama (local server)', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama3.2', keyless: true, note: 'Runs against a local Ollama server on this machine.' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseURL: '', defaultModel: '' },
];

// ── Persisted choice ──────────────────────────────────────────────────────────
export type LlmConfig =
  | { kind: 'local' }
  | { kind: 'remote'; preset: string; baseURL: string; model: string; apiKey?: string; label?: string };

export function loadLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LlmConfig) : null;
  } catch {
    return null;
  }
}
export function saveLlmConfig(cfg: LlmConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
export function clearLlmConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Mark the 'llm' capability ready with the given completion fn, WITHOUT the
// WebGPU gate that registerLlmCapability() enforces (we want the remote/endpoint
// path to work on any device, and we do our own WebGPU check for the local one).
async function install(manager: CapabilityManager, complete: LlmCompleteFn): Promise<void> {
  setLlmFunction(complete);
  manager.registerLoader('llm', async () => {
    setLlmFunction(complete);
  });
  await manager.enable('llm');
}

// ── Local (WebGPU, web-llm) ────────────────────────────────────────────────────
// Download sizes (approx, from web-llm's vram_required_MB) so the prompt can warn
// the user WITHOUT importing the heavy library. Slightly conservative on purpose.
const MODEL_SIZE_MB: Record<string, number> = {
  'Qwen3-0.6B-q4f16_1-MLC': 1400,
  'Qwen3-1.7B-q4f16_1-MLC': 2040,
  'Hermes-3-Llama-3.2-3B-q4f16_1-MLC': 2264,
  'Qwen3-0.6B-q4f32_1-MLC': 1925,
  'Qwen3-1.7B-q4f32_1-MLC': 2635,
  'Hermes-3-Llama-3.2-3B-q4f32_1-MLC': 2952,
};

export type LocalModelInfo = { webgpu: boolean; modelId: string; sizeMB: number };

/** Detect WebGPU + pick the device-appropriate model — does NOT load web-llm. */
export async function probeLocalModel(): Promise<LocalModelInfo> {
  const gpu = await detectGpuCapabilities();
  if (!gpu.webgpuAvailable) return { webgpu: false, modelId: '', sizeMB: 0 };
  const modelId = selectLlmModel(estimateVramTier(gpu), gpu.supportsF16);
  return { webgpu: true, modelId, sizeMB: MODEL_SIZE_MB[modelId] ?? 2000 };
}

/** Download + enable a local model. Loads @mlc-ai/web-llm lazily (only here). */
export async function enableLocalLlm(
  manager: CapabilityManager,
  onProgress: (pct: number, text: string) => void,
): Promise<void> {
  const gpu = await detectGpuCapabilities();
  if (!gpu.webgpuAvailable) {
    throw new Error('WebGPU is not available. A local model needs Chrome 113+ or Firefox 141+. Use a provider endpoint instead.');
  }
  const modelId = selectLlmModel(estimateVramTier(gpu), gpu.supportsF16);
  // Dynamic import: the web-llm library chunk is fetched only at this point.
  const webllm = await import('@mlc-ai/web-llm');
  const engine = await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (r: { progress?: number; text?: string }) =>
      onProgress(Math.round((r.progress ?? 0) * 100), r.text ?? ''),
  });
  const complete: LlmCompleteFn = async (prompt, opts) => {
    const res = await engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: opts?.maxTokens ?? 512,
      temperature: opts?.temperature ?? 0.7,
    });
    return res.choices?.[0]?.message?.content ?? '';
  };
  await install(manager, complete);
  saveLlmConfig({ kind: 'local' });
}

// ── Model lookup (reactive picker) ──────────────────────────────────────────────
export type ProviderModel = { id: string; label: string; chat: boolean };

/**
 * List a provider's available models via its OpenAI-compatible `/models`
 * endpoint. Chat-capable models are flagged (and sorted first) so the picker can
 * surface them over embedding-only models; `classifyModel` is a heuristic on the
 * id, since `/models` responses rarely carry capability metadata. Throws on a
 * bad key / unreachable endpoint / no-CORS / no-`/models` — the caller falls
 * back to a free-text model field.
 */
export async function listProviderModels(cfg: {
  baseURL: string;
  apiKey?: string;
  defaultModel?: string;
}): Promise<ProviderModel[]> {
  const provider = new OpenAICompatibleProvider({
    id: 'model-lookup',
    name: 'model-lookup',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    defaultModel: cfg.defaultModel,
    tier: 'remote',
  });
  const models = await provider.listModels();
  const mapped: ProviderModel[] = models.map((m) => ({
    id: m.id,
    label: m.name && m.name !== m.id ? `${m.id} — ${m.name}` : m.id,
    chat: classifyModel(m.id) !== 'embedding', // keep chat + vision, drop embedding-only
  }));
  // chat/vision first, then the rest; alphabetical within each group
  mapped.sort((a, b) => (a.chat === b.chat ? a.id.localeCompare(b.id) : a.chat ? -1 : 1));
  return mapped;
}

// ── Remote (OpenAI-compatible endpoint) ────────────────────────────────────────
export async function enableRemoteLlm(
  manager: CapabilityManager,
  cfg: { preset: string; baseURL: string; model: string; apiKey?: string; label?: string },
): Promise<void> {
  const provider = new OpenAICompatibleProvider({
    id: 'user-remote-llm',
    name: cfg.label ?? cfg.preset ?? 'OpenAI-compatible',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    defaultModel: cfg.model,
    tier: 'remote',
  });
  const probe = await provider.probe();
  if (probe.status === 'down') {
    throw new Error(probe.message || 'Could not reach the endpoint. Check the base URL, model, and key.');
  }
  const complete: LlmCompleteFn = async (prompt, opts) => {
    const res = await provider.complete({
      prompt,
      model: cfg.model,
      maxTokens: opts?.maxTokens,
      temperature: opts?.temperature,
    });
    return res.text ?? '';
  };
  await install(manager, complete);
  saveLlmConfig({ kind: 'remote', ...cfg });
}

/** Turn the LLM back off and forget the saved choice. */
export function disableLlm(manager: CapabilityManager): void {
  try {
    unregisterLlmCapability();
  } catch {
    /* not registered — fine */
  }
  setLlmFunction(null);
  if (manager.isReady('llm')) {
    try {
      manager.disable('llm');
    } catch {
      /* not in a disablable state — fine */
    }
  }
  clearLlmConfig();
}

/** Re-apply a previously-chosen LLM on launch (the user already opted in). */
export async function restoreLlm(
  manager: CapabilityManager,
  onProgress?: (pct: number, text: string) => void,
): Promise<LlmConfig | null> {
  const cfg = loadLlmConfig();
  if (!cfg) return null;
  if (cfg.kind === 'remote') {
    await enableRemoteLlm(manager, cfg);
    return cfg;
  }
  // kind === 'local' — the model is cached in the browser after first download,
  // so this re-import + re-init is fast and uses no network for the weights.
  await enableLocalLlm(manager, onProgress ?? (() => {}));
  return cfg;
}
