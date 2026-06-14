import { useCallback, useMemo, useState } from 'react'
import {
  aiwgFortemiIndexToCommunityGraph,
  assertAiwgFortemiIndexExport,
  createAiwgReviewDecisionExport,
  queryAiwgFortemiIndex,
  type AiwgFortemiIndexExport,
  type AiwgIndexGraphOptions,
  type AiwgIndexQueryOptions,
  type AiwgIndexQueryResult,
  type AiwgReviewAction,
  type AiwgReviewDecision,
  type AiwgReviewDecisionExport,
} from '@fortemi/core'

export interface AiwgReviewInput {
  item_id: string
  action: AiwgReviewAction
  reason?: string
}

export function useAiwgIndex(initialIndex?: AiwgFortemiIndexExport) {
  const [index, setIndex] = useState<AiwgFortemiIndexExport | null>(initialIndex ?? null)
  const [data, setData] = useState<AiwgIndexQueryResult | null>(null)
  const [reviewDecisions, setReviewDecisions] = useState<AiwgReviewDecision[]>([])
  const [error, setError] = useState<Error | null>(null)

  const loadIndex = useCallback((value: unknown): AiwgFortemiIndexExport => {
    try {
      const parsed = assertAiwgFortemiIndexExport(value)
      setIndex(parsed)
      setData(null)
      setReviewDecisions([])
      setError(null)
      return parsed
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    }
  }, [])

  const search = useCallback((query = '', options?: AiwgIndexQueryOptions): AiwgIndexQueryResult => {
    if (!index) throw new Error('No AIWG index export loaded')
    const result = queryAiwgFortemiIndex(index, query, options)
    setData(result)
    setError(null)
    return result
  }, [index])

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
    if (!index) throw new Error('No AIWG index export loaded')
    return createAiwgReviewDecisionExport(index, reviewDecisions)
  }, [index, reviewDecisions])

  const toCommunityGraph = useCallback((options?: AiwgIndexGraphOptions) => {
    if (!index) throw new Error('No AIWG index export loaded')
    return aiwgFortemiIndexToCommunityGraph(index, options)
  }, [index])

  const counts = useMemo(() => {
    if (!index) return {}
    return index.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1
      return acc
    }, {})
  }, [index])

  return {
    index,
    counts,
    data,
    error,
    reviewDecisions,
    loadIndex,
    search,
    setReviewDecision,
    clearReviewDecision,
    exportReviewDecisions,
    toCommunityGraph,
  }
}
