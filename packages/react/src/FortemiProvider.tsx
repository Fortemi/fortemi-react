import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { ArchiveManager, CapabilityManager, TypedEventBus, type PersistenceMode } from '@fortemi/core'

type PGliteInstance = Awaited<ReturnType<ArchiveManager['open']>>

export interface FortemiContextValue {
  db: PGliteInstance
  events: TypedEventBus
  archiveManager: ArchiveManager
  capabilityManager: CapabilityManager
}

const FortemiContext = createContext<FortemiContextValue | null>(null)

export interface FortemiProviderProps {
  persistence: PersistenceMode
  archiveName?: string
  children: ReactNode
}

// Module-level singleton to prevent double-init from React StrictMode.
// PGlite WASM can only be instantiated once per Response — a second call
// to WebAssembly.instantiateStreaming() with the same cached Response fails
// with "Response already consumed".
let globalInitPromise: Promise<{ db: PGliteInstance; events: TypedEventBus; manager: ArchiveManager; capManager: CapabilityManager }> | null = null

function initFortemi(persistence: PersistenceMode, archiveName: string) {
  if (!globalInitPromise) {
    globalInitPromise = (async () => {
      const events = new TypedEventBus()
      const manager = new ArchiveManager(persistence, events)
      const capManager = new CapabilityManager(events)
      const db = await manager.open(archiveName)
      return { db, events, manager, capManager }
    })()
  }
  return globalInitPromise
}

export function FortemiProvider({ persistence, archiveName = 'default', children }: FortemiProviderProps) {
  const [ctx, setCtx] = useState<FortemiContextValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    // Guard against StrictMode double-mount calling init twice
    if (initRef.current) return
    initRef.current = true

    initFortemi(persistence, archiveName).then(({ db, events, manager, capManager }) => {
      setCtx({ db, events, archiveManager: manager, capabilityManager: capManager })
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [persistence, archiveName])

  if (error) throw new Error(`FortemiProvider init failed: ${error}`)
  if (!ctx) return null // Loading state handled by parent Suspense or loading screen

  return (
    <FortemiContext value={ctx}>
      {children}
    </FortemiContext>
  )
}

export function useFortemiContext(): FortemiContextValue {
  const ctx = useContext(FortemiContext)
  if (!ctx) throw new Error('useFortemiContext must be used within FortemiProvider')
  return ctx
}
