import { useState, useEffect, useRef, useCallback } from 'react'
import {
  openShard,
  type ShardReader,
  type ShardReaderSource,
  type ShardReaderNote,
  type OpenShardOptions,
  type ShardManifest,
  type ShardListOptions,
  type ShardSearchOptions,
  type ShardSearchResult,
  type ShardNoteFull,
  type ShardLink,
  type ShardSkosConcept,
  type ShardSkosRelation,
  type ShardProvenanceEdge,
} from '@fortemi/core'

export interface UseShardReturn {
  /** The opened reader, or null while loading / on error. */
  reader: ShardReader | null
  manifest: ShardManifest | null
  loading: boolean
  error: Error | null
  listNotes: (options?: ShardListOptions) => Promise<{ items: ShardReaderNote[]; total: number }>
  getNote: (id: string) => Promise<ShardReaderNote | null>
  search: (query: string, options?: ShardSearchOptions) => Promise<ShardSearchResult>
  linksOf: (id: string) => Promise<ShardLink[]>
  conceptsOf: (id: string) => Promise<ShardSkosConcept[]>
  relationsOf: (conceptId: string) => Promise<ShardSkosRelation[]>
  provenanceOf: (id: string) => Promise<ShardProvenanceEdge[]>
  getNoteFull: (id: string) => Promise<ShardNoteFull | null>
  semantic: (query: string, k?: number) => Promise<Array<{ note: ShardReaderNote; score: number }>>
}

/**
 * Open a Knowledge Shard for in-place, read-only query — with NO PGlite (#189).
 * Mirrors `useAiwgIndex()`: it manages the async-opened {@link ShardReader} and
 * exposes its read surface (browse/get, full-text + facet search, lazy full
 * record, and opt-in semantic when a provider is configured).
 *
 * The reader re-opens when `source` changes, so memoize `source` (and an
 * `options.semantic` provider) to avoid churn. The previous reader is closed on
 * change/unmount.
 *
 * @example
 * ```tsx
 * const source = useMemo(() => ({ baseUrl: '/shards/notes' }), [])
 * const { search, loading } = useShard(source)
 * // const result = await search('founder breakfast', { rank: true, snippets: true })
 * ```
 */
export function useShard(source: ShardReaderSource, options?: OpenShardOptions): UseShardReturn {
  const [reader, setReader] = useState<ShardReader | null>(null)
  const [manifest, setManifest] = useState<ShardManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const readerRef = useRef<ShardReader | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    openShard(source, optionsRef.current).then((opened) => {
      if (cancelled) {
        opened.close()
        return
      }
      readerRef.current = opened
      setReader(opened)
      setManifest(opened.manifest)
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err : new Error(String(err)))
      setLoading(false)
    })
    return () => {
      cancelled = true
      readerRef.current?.close()
      readerRef.current = null
    }
  }, [source])

  const requireReader = useCallback((): ShardReader => {
    const current = readerRef.current
    if (!current) throw new Error('Shard reader is not ready yet')
    return current
  }, [])

  const listNotes = useCallback((opts?: ShardListOptions) => requireReader().listNotes(opts), [requireReader])
  const getNote = useCallback((id: string) => requireReader().getNote(id), [requireReader])
  const search = useCallback((query: string, opts?: ShardSearchOptions) => requireReader().search(query, opts), [requireReader])
  const linksOf = useCallback((id: string) => requireReader().linksOf(id), [requireReader])
  const conceptsOf = useCallback((id: string) => requireReader().conceptsOf(id), [requireReader])
  const relationsOf = useCallback((conceptId: string) => requireReader().relationsOf(conceptId), [requireReader])
  const provenanceOf = useCallback((id: string) => requireReader().provenanceOf(id), [requireReader])
  const getNoteFull = useCallback((id: string) => requireReader().getNoteFull(id), [requireReader])
  const semantic = useCallback((query: string, k?: number) => requireReader().semantic(query, k), [requireReader])

  return {
    reader,
    manifest,
    loading,
    error,
    listNotes,
    getNote,
    search,
    linksOf,
    conceptsOf,
    relationsOf,
    provenanceOf,
    getNoteFull,
    semantic,
  }
}
