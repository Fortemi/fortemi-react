import { useCallback, useMemo, useState } from 'react'
import {
  aiwgFortemiIndexToCommunityGraph,
  assertAiwgFortemiIndexExport,
  createAiwgIndexController,
  createAiwgReviewDecisionExport,
  queryAiwgFortemiIndex,
  type AiwgChunkedIndexLoadOptions,
  type AiwgChunkedIndexLoader,
  type AiwgChunkedIndexQueryOptions,
  type AiwgChunkedIndexQueryResult,
  type AiwgFortemiChunkManifest,
  type AiwgFortemiIndexExport,
  type AiwgFortemiRecord,
  type AiwgIndexGraphOptions,
  type AiwgIndexQueryOptions,
  type AiwgIndexQueryResult,
  type AiwgReviewInput,
  type AiwgReviewDecision,
  type AiwgReviewDecisionExport,
} from '@fortemi/core/aiwg-index'

export type { AiwgReviewInput }

/**
 * Per-type record counts that behave identically in whole-index and chunked modes.
 *
 * - Whole-index: tally `index.items` by `type`.
 * - Chunked: read the manifest's pre-computed `type` facet — exact global counts
 *   derived from the full records at build time, available from the ~2 KB manifest
 *   with no part fetch. Falls back to `{}` when a manifest carries no facets.
 *
 * @see https://git.integrolabs.net/Fortemi/fortemi-react/issues/173
 */
export function deriveTypeCounts(
  index: AiwgFortemiIndexExport | null,
  chunkedManifest: AiwgFortemiChunkManifest | null,
): Record<string, number> {
  if (chunkedManifest) {
    return chunkedManifest.facets?.type ?? {}
  }
  if (!index) return {}
  return index.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1
    return acc
  }, {})
}

export function useAiwgIndex(initialIndex?: AiwgFortemiIndexExport) {
  const [chunkedController] = useState(() => createAiwgIndexController())
  const [index, setIndex] = useState<AiwgFortemiIndexExport | null>(initialIndex ?? null)
  const [chunkedManifest, setChunkedManifest] = useState<AiwgFortemiChunkManifest | null>(null)
  const [data, setData] = useState<AiwgIndexQueryResult | null>(null)
  const [reviewDecisions, setReviewDecisions] = useState<AiwgReviewDecision[]>([])
  const [error, setError] = useState<Error | null>(null)

  const loadIndex = useCallback((value: unknown): AiwgFortemiIndexExport => {
    try {
      const parsed = assertAiwgFortemiIndexExport(value)
      setIndex(parsed)
      setChunkedManifest(null)
      chunkedController.clearChunkCache()
      setData(null)
      setReviewDecisions([])
      setError(null)
      return parsed
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    }
  }, [chunkedController])

  const loadChunkedIndex = useCallback((
    manifest: unknown,
    loader: AiwgChunkedIndexLoader,
    options?: AiwgChunkedIndexLoadOptions,
  ): AiwgFortemiChunkManifest => {
    try {
      const parsed = chunkedController.loadChunkedIndex(manifest, loader, options)
      setIndex(null)
      setChunkedManifest(parsed)
      setData(null)
      setReviewDecisions([])
      setError(null)
      return parsed
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    }
  }, [chunkedController])

  const search = useCallback((query = '', options?: AiwgIndexQueryOptions): AiwgIndexQueryResult => {
    if (!index) throw new Error('No AIWG index export loaded')
    const result = queryAiwgFortemiIndex(index, query, options)
    setData(result)
    setError(null)
    return result
  }, [index])

  const searchChunked = useCallback(async (
    query = '',
    options?: AiwgChunkedIndexQueryOptions,
  ): Promise<AiwgChunkedIndexQueryResult> => {
    try {
      const result = await chunkedController.queryChunked(query, options)
      setData(result)
      setError(null)
      return result
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    }
  }, [chunkedController])

  // Resolve a full record by id — fetches detail for a projected chunked index
  // (via the detailLoader passed to loadChunkedIndex), or looks up the loaded
  // whole index. Use this to populate a detail panel without holding detail in the list.
  const getRecord = useCallback(async (id: string): Promise<AiwgFortemiRecord> => {
    if (chunkedManifest) {
      try {
        return await chunkedController.getRecord(id)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        throw e
      }
    }
    const found = index?.items.find((item) => item.id === id)
    if (!found) throw new Error('Record not found: ' + id)
    return found
  }, [chunkedManifest, chunkedController, index])

  const clearChunkCache = useCallback(() => {
    chunkedController.clearChunkCache()
  }, [chunkedController])

  const setReviewDecision = useCallback((input: AiwgReviewInput): AiwgReviewDecision => {
    const decision: AiwgReviewDecision = {
      ...input,
      updated_at: new Date().toISOString(),
    }
    setReviewDecisions((current) => [
      ...current.filter((item) => item.item_id !== decision.item_id),
      decision,
    ].sort((left, right) => left.item_id.localeCompare(right.item_id)))
    return decision
  }, [])

  const clearReviewDecision = useCallback((itemId: string) => {
    setReviewDecisions((current) => current.filter((item) => item.item_id !== itemId))
  }, [])

  const exportReviewDecisions = useCallback((): AiwgReviewDecisionExport => {
    // The review-decisions export only needs the export schema_version, not the
    // items — so it works in chunked mode (index null, manifest loaded) by
    // synthesizing a minimal source (#178).
    const source = index ?? (chunkedManifest ? { schema_version: 'aiwg.fortemi.index.export.v1' as const } : null)
    if (!source) throw new Error('No AIWG index export or chunked manifest loaded')
    return createAiwgReviewDecisionExport(source, reviewDecisions)
  }, [index, chunkedManifest, reviewDecisions])

  const toCommunityGraph = useCallback((options?: AiwgIndexGraphOptions) => {
    if (!index) throw new Error('No AIWG index export loaded')
    return aiwgFortemiIndexToCommunityGraph(index, options)
  }, [index])

  const counts = useMemo(
    () => deriveTypeCounts(index, chunkedManifest),
    [index, chunkedManifest],
  )

  return {
    index,
    chunkedManifest,
    counts,
    data,
    error,
    reviewDecisions,
    loadIndex,
    loadChunkedIndex,
    search,
    searchChunked,
    getRecord,
    clearChunkCache,
    setReviewDecision,
    clearReviewDecision,
    exportReviewDecisions,
    toCommunityGraph,
  }
}
