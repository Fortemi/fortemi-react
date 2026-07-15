/// <reference lib="webworker" />
//
// Query-embedding Web Worker — keeps the MiniLM model load AND every per-query
// embed off the main thread. Uses the official @fortemi/core embed transport
// (Fortemi/fortemi-react#180, shipped in @fortemi 2026.6.4): the worker answers
// the standard embed request/response protocol via handleEmbedRequests; the main
// thread wires it with registerSemanticCapabilityWorker.
//
// Params MUST match the build-time corpus embeddings exactly (see
// scripts/prepare-fortemi-corpus.ts): feature-extraction · Xenova/all-MiniLM-L6-v2
// · fp32 · { pooling:'mean', normalize:true } · 384-d.
//
// On top of the standard protocol we keep a small `{type:'load'}` side-channel:
// it eagerly loads the model and streams download progress back, so the
// "Enable semantic" flow can show a progress bar instead of the model silently
// loading on the first query.

import { handleEmbedRequests, type EmbedTransportPort } from '@fortemi/core';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

type Extractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;

// Lazy-load the pipeline once; dynamic import keeps transformers.js out of the
// worker's initial parse until a 'load' (or first embed) needs it.
function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      ctx.postMessage({ type: 'progress', label: 'Downloading embedding model (~23 MB)', pct: null });
      const { pipeline } = await import('@huggingface/transformers');
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'fp32',
        progress_callback: (p: { status: string; progress?: number }) => {
          if (p.status === 'progress' && p.progress != null) {
            ctx.postMessage({ type: 'progress', label: 'Downloading embedding model', pct: Math.round(p.progress) });
          }
        },
      });
      return extractor as unknown as Extractor;
    })();
  }
  return extractorPromise;
}

// Standard embed protocol (#180). handleEmbedRequests ignores any non-embed
// message, so it coexists with the `{type:'load'}` side-channel below.
handleEmbedRequests(ctx as unknown as EmbedTransportPort, async (texts) => {
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (const t of texts) {
    const r = await extractor(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
});

// Eager warm-up with download progress (so enable shows a bar, not a silent
// first-query stall). The standard embed handler reuses the same getExtractor().
ctx.addEventListener('message', (ev: MessageEvent) => {
  if ((ev.data as { type?: string })?.type !== 'load') return;
  getExtractor().then(
    () => ctx.postMessage({ type: 'ready' }),
    (e: unknown) => ctx.postMessage({ type: 'load-error', message: (e as Error).message }),
  );
});
