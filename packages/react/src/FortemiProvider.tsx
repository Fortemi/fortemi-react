import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { ArchiveManager, TypedEventBus, type PersistenceMode } from '@fortemi/core'

type PGliteInstance = Awaited<ReturnType<ArchiveManager['open']>>

export interface FortemiContextValue {
  db: PGliteInstance
  events: TypedEventBus
  archiveManager: ArchiveManager
}

const FortemiContext = createContext<FortemiContextValue | null>(null)

export interface FortemiProviderProps {
  persistence: PersistenceMode
  archiveName?: string
  children: ReactNode
}

export function FortemiProvider({ persistence, archiveName = 'default', children }: FortemiProviderProps) {
  const [ctx, setCtx] = useState<FortemiContextValue | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const events = new TypedEventBus()
    const manager = new ArchiveManager(persistence, events)

    manager.open(archiveName).then((db) => {
      if (!cancelled) {
        setCtx({ db, events, archiveManager: manager })
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      cancelled = true
      manager.close()
    }
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
