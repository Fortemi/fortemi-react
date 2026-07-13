// Wire the semantic (embedding) capability with a real transformers.js loader.
//
// The loader runs only when `capabilityManager.enable('semantic')` is called —
// i.e. when the user opts in. Nothing here downloads at build time or on mount;
// the model is fetched from the Hugging Face CDN the first time embeddings are
// enabled. ML dependencies stay in the consumer app (this file), not in
// @fortemi/react — see apps/standalone/src/capabilities/setup.ts for the full
// version that also wires a local LLM via WebLLM.

import { setEmbedFunction, type CapabilityManager, type EmbedFunction } from '@fortemi/core'

export function setupCapabilities(
  manager: CapabilityManager,
  onProgress: (msg: string) => void,
): void {
  manager.registerLoader('semantic', async () => {
    onProgress('Loading embedding model…')
    const { pipeline } = await import('@huggingface/transformers')
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === 'progress' && p.progress != null) {
          onProgress(`Downloading ${p.file ?? 'model'}: ${Math.round(p.progress)}%`)
        } else if (p.status === 'ready') {
          onProgress('Model ready')
        }
      },
    })

    const embed: EmbedFunction = async (texts: string[]): Promise<number[][]> => {
      const out: number[][] = []
      for (const text of texts) {
        const r = await extractor(text, { pooling: 'mean', normalize: true })
        out.push(Array.from(r.data as Float32Array))
      }
      return out
    }
    setEmbedFunction(embed)
    onProgress('Embeddings enabled')
  })
}
