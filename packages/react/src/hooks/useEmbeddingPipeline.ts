import { useState, useCallback, useRef } from 'react'
import { setEmbedFunction, type EmbedFunction } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export type EmbeddingPipelineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UseEmbeddingPipelineReturn {
  embedFunction: EmbedFunction | null
  status: EmbeddingPipelineStatus
  progress: string
  error: Error | null
  load: () => void
  unload: () => void
}

/** Factory that creates an EmbedFunction, reporting progress during model download. */
export type EmbedFunctionLoader = (onProgress: (msg: string) => void) => Promise<EmbedFunction>

/**
 * Manages the embedding pipeline lifecycle.
 * Lazily loads the embedding model on load() — not on mount.
 * Auto-registers with the core embed function when ready.
 *
 * The consumer provides the loader function that creates the EmbedFunction,
 * keeping ML dependencies (e.g. @huggingface/transformers) in the consumer app.
 *
 * @example
 * ```tsx
 * import { loadTransformersEmbedFunction } from './capabilities/setup'
 *
 * function EmbeddingControl() {
 *   const { status, progress, load, unload } = useEmbeddingPipeline(loadTransformersEmbedFunction)
 *   return <button onClick={load}>{status}: {progress}</button>
 * }
 * ```
 */
export function useEmbeddingPipeline(loader: EmbedFunctionLoader): UseEmbeddingPipelineReturn {
  const { capabilityManager } = useFortemiContext()
  const [embedFunction, setEmbed] = useState<EmbedFunction | null>(null)
  const [status, setStatus] = useState<EmbeddingPipelineStatus>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const loadingRef = useRef(false)

  const load = useCallback(() => {
    if (loadingRef.current || status === 'ready') return
    loadingRef.current = true
    setStatus('loading')
    setError(null)
    setProgress('Initializing...')

    loader((msg) => {
      setProgress(msg)
      capabilityManager.setProgress('semantic', msg)
    })
      .then((fn) => {
        setEmbedFunction(fn)
        setEmbed(() => fn)
        setStatus('ready')
        setProgress('Embedding model ready')
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setStatus('error')
        setProgress('')
      })
      .finally(() => {
        loadingRef.current = false
      })
  }, [status, loader, capabilityManager])

  const unload = useCallback(() => {
    setEmbedFunction(null)
    setEmbed(null)
    setStatus('idle')
    setProgress('')
    setError(null)
    loadingRef.current = false
  }, [])

  return { embedFunction, status, progress, error, load, unload }
}
