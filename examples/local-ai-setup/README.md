# EX-12 · local-ai-setup

Progressive AI enhancement, honestly gated. This is the **only** example that
downloads a model — and only when you opt in. On load it detects the hardware
tier and discovers local model servers (pure probes, no download); embeddings
are wired but disabled until you press the button.

```bash
pnpm install      # once, from the repo root
cd examples/local-ai-setup
pnpm dev
```

## What it shows

- **Detection** (instant, no download):
  - `useInferenceCapabilities` — WebGPU / WASM / WebNN / SharedArrayBuffer /
    Chrome AI, estimated VRAM, and a `recommendedTier`.
  - `useGpuCapabilities` — WebGPU adapter vendor/architecture, f16 support, and
    a VRAM tier.
- **Discovery** — `useLocalDiscovery({ interval: 0 })` probes localhost for
  Ollama / LM Studio and lists their models. Press **Rescan** after starting a
  server. Nothing is downloaded; it only lists what a local server already has.
- **Opt-in embeddings** — `useCapabilitySetup({ setup, autoEnable: [] })`
  registers a transformers.js loader **but enables nothing**, so the model does
  not download on mount. Clicking *Enable embeddings* calls
  `capabilityManager.enable('semantic')`, which fetches
  `Xenova/all-MiniLM-L6-v2` from the Hugging Face CDN (~25 MB) and wires the
  embed function via `setEmbedFunction`.
- **Pipeline watch** — seed a few notes and `useJobQueue` shows the
  server-compatible queue: `ai_revision → title_generation → embedding →
  concept_tagging → linking`. Embedding jobs run once the semantic capability is
  enabled.

## What downloads, and when

| Stage | Network |
|-------|---------|
| Build (`pnpm build`) | nothing — the onnxruntime **engine** WASM is bundled into `dist/`, but no model is fetched |
| Page load | nothing — detection and discovery are local probes |
| *Enable embeddings* click | the embedding **model** (~25 MB) is fetched from the HF CDN, once, and cached by the browser |

ML dependencies stay in the consumer app (`src/setup.ts`), not in
`@fortemi/react`. For the full version that also wires a local LLM via WebLLM
and reads discovered Ollama/LM Studio providers, see
`apps/standalone/src/capabilities/setup.ts`.

## Packages used

- [`@fortemi/react`](../../packages/react) — `useGpuCapabilities`,
  `useInferenceCapabilities`, `useLocalDiscovery`, `useCapabilitySetup`,
  `useJobQueue`, `useNotes`, `useCreateNote`, `useFortemiContext`
- [`@fortemi/core`](../../packages/core) — `setEmbedFunction`, `CapabilityManager`
- [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) — the embedding runtime (opt-in)
