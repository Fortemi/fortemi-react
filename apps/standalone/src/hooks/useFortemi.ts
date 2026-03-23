import { useState, useEffect, useRef } from 'react'
import { ArchiveManager, type FortemiConfig } from '@fortemi/core'

export type InitState =
  | { status: 'loading'; message: string }
  | { status: 'ready'; archiveManager: ArchiveManager }
  | { status: 'error'; error: string }

/**
 * React hook that initializes PGlite and runs migrations.
 *
 * Uses a module-level singleton to guard against React StrictMode's
 * double-invocation of effects in development. Without this guard, PGlite's
 * internal WASM Response cache is consumed on the first init attempt and the
 * second attempt fails with "Cannot compile WebAssembly.Module from an
 * already read Response".
 *
 * The singleton also means the ArchiveManager persists across fast-refresh
 * cycles, which is desirable — we don't want to re-open the database on
 * every hot module replacement.
 */

let globalInitPromise: Promise<ArchiveManager> | null = null

function getOrInitArchiveManager(config: FortemiConfig): Promise<ArchiveManager> {
  if (!globalInitPromise) {
    globalInitPromise = (async () => {
      const manager = new ArchiveManager(config.persistence)
      await manager.open(config.archiveName ?? 'default')
      return manager
    })()
  }
  return globalInitPromise
}

export function useFortemi(config: FortemiConfig): InitState {
  const [state, setState] = useState<InitState>({ status: 'loading', message: 'Initializing...' })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    setState({ status: 'loading', message: 'Starting database...' })

    getOrInitArchiveManager(config)
      .then(manager => {
        if (mountedRef.current) {
          setState({ status: 'ready', archiveManager: manager })
        }
      })
      .catch(err => {
        if (mountedRef.current) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })

    return () => {
      mountedRef.current = false
    }
  }, [config.persistence, config.archiveName])

  return state
}
