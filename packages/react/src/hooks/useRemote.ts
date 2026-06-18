import { useMemo, useState, useCallback } from 'react'
import {
  createRemoteBackend,
  type BackendListOptions,
  type BackendNote,
  type BackendNoteFull,
  type BackendSearchQueryOptions,
  type BackendSearchResult,
  type BackendSearchHit,
  type BackendLink,
  type BackendConcept,
  type BackendProvenanceEdge,
  type DataBackend,
  type RemoteBackendConfig,
} from '@fortemi/core'

export interface UseRemoteReturn {
  backend: DataBackend
  loading: boolean
  error: Error | null
  listNotes: (options?: BackendListOptions) => Promise<{ items: BackendNote[]; total: number }>
  getNote: (id: string) => Promise<BackendNote | null>
  search: (query: string, options?: BackendSearchQueryOptions) => Promise<BackendSearchResult>
  getNoteFull: (id: string) => Promise<BackendNoteFull | null>
  linksOf: (id: string) => Promise<BackendLink[]>
  conceptsOf: (id: string) => Promise<BackendConcept[]>
  provenanceOf: (id: string) => Promise<BackendProvenanceEdge[]>
  semantic: (query: string, k?: number) => Promise<BackendSearchHit[]>
  manageNote: (input: unknown) => Promise<unknown>
}

export function useRemote(config: RemoteBackendConfig): UseRemoteReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const backend = useMemo(() => createRemoteBackend(config), [config])

  const call = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const listNotes = useCallback((options?: BackendListOptions) => call(() => backend.listNotes(options)), [backend, call])
  const getNote = useCallback((id: string) => call(() => backend.getNote(id)), [backend, call])
  const search = useCallback(
    (query: string, options?: BackendSearchQueryOptions) => call(() => backend.search(query, options)),
    [backend, call],
  )
  const getNoteFull = useCallback((id: string) => call(() => backend.getNoteFull!(id)), [backend, call])
  const linksOf = useCallback((id: string) => call(() => backend.linksOf!(id)), [backend, call])
  const conceptsOf = useCallback((id: string) => call(() => backend.conceptsOf!(id)), [backend, call])
  const provenanceOf = useCallback((id: string) => call(() => backend.provenanceOf!(id)), [backend, call])
  const semantic = useCallback((query: string, k?: number) => call(() => backend.semantic!(query, k)), [backend, call])
  const manageNote = useCallback((input: unknown) => call(() => backend.manageNote!(input)), [backend, call])

  return {
    backend,
    loading,
    error,
    listNotes,
    getNote,
    search,
    getNoteFull,
    linksOf,
    conceptsOf,
    provenanceOf,
    semantic,
    manageNote,
  }
}
