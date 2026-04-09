import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { ArchiveManager, CapabilityManager, TypedEventBus, createBlobStore, type PersistenceMode, type BlobStore } from '@fortemi/core'

type PGliteInstance = Awaited<ReturnType<ArchiveManager['open']>>

export interface FortemiContextValue {
  db: PGliteInstance
  events: TypedEventBus
  archiveManager: ArchiveManager
  capabilityManager: CapabilityManager
  blobStore: BlobStore
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
let globalInitPromise: Promise<{ db: PGliteInstance; events: TypedEventBus; manager: ArchiveManager; capManager: CapabilityManager; blobStore: BlobStore }> | null = null

function initFortemi(persistence: PersistenceMode, archiveName: string) {
  if (!globalInitPromise) {
    globalInitPromise = (async () => {
      const events = new TypedEventBus()
      const manager = new ArchiveManager(persistence, events)
      const capManager = new CapabilityManager(events)
      const blobStore = createBlobStore(archiveName)
      const db = await manager.open(archiveName)
      return { db, events, manager, capManager, blobStore }
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

    initFortemi(persistence, archiveName).then(({ db, events, manager, capManager, blobStore }) => {
      setCtx({ db, events, archiveManager: manager, capabilityManager: capManager, blobStore })
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

/**
 * "No-host" context — returned when `useFortemiContext()` is called without
 * a `<FortemiProvider>` ancestor. Lets Fortemi-React (and any white-label
 * brand built on it, including MNEMOS) render in arbitrary host shells per
 * the BT6 frame contract direction (BT6-ARSENAL#39).
 *
 * Each field is a JS Proxy that intercepts every property access and
 * returns a sensible default — typically a no-op function. The shape of
 * the return value is tuned per common method name: `on()` returns an
 * unsubscribe function, query/exec returns `Promise<{ rows: [] }>`,
 * everything else returns `Promise<undefined>` for async-looking calls
 * and `undefined` for sync-looking ones.
 *
 * Hooks that consume the context don't need null checks. They get a
 * working object that does nothing useful, and any UI built on the data
 * naturally renders empty/placeholder states. This is the right contract
 * for a portable library: never throw on missing host configuration.
 */
function makeNoHostStub<T>(label: string): T {
  // Build a single self-referencing proxy whose every property access AND
  // every function call returns the SAME proxy. This makes any chain of
  // .foo().bar.baz().catch(...).then(...) etc. resolve to the same harmless
  // stub. Special-cased methods return more useful values:
  //
  //   .on / .addListener / .subscribe → returns an unsubscribe function
  //   .query / .exec / .sql → returns a Promise<{ rows: [] }>
  //   .then(onF, onR)       → calls onF(undefined) so awaits resolve to undefined
  //   .catch / .finally     → returns the same proxy (so chains continue)
  //
  // Everything else returns the proxy itself, which is both callable and
  // looks like an object — eliminating "X is not a function" and
  // "Cannot read .foo of undefined" entirely.

  let proxy: T

  // events.on() returns either a plain unsubscribe fn OR a Subscription
  // object with .dispose()/.unsubscribe(). Return something that satisfies
  // both shapes: a callable function with dispose/unsubscribe properties.
  function makeSubscription() {
    const fn = function () {} as unknown as { dispose: () => void; unsubscribe: () => void; (): void }
    fn.dispose = () => {}
    fn.unsubscribe = () => {}
    return fn
  }
  const noopSub = () => makeSubscription()
  const noopExec = () => Promise.resolve({ rows: [] })

  const target = function () {} as unknown as object

  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => `[fortemi no-host:${label}]`
      if (prop === Symbol.toStringTag) return `FortemiNoHost(${label})`
      if (prop === 'then') {
        // Make awaiting the proxy resolve to undefined without recursing
        return (onFulfilled?: (v: unknown) => unknown) => {
          try { onFulfilled?.(undefined) } catch {}
          return proxy
        }
      }
      if (prop === 'catch' || prop === 'finally') {
        return () => proxy
      }
      if (typeof prop === 'string') {
        if (prop === 'on' || prop === 'addListener' || prop === 'subscribe') {
          return noopSub
        }
        if (prop === 'query' || prop === 'exec' || prop === 'sql') {
          return noopExec
        }
      }
      // Default: return self so .foo.bar.baz() all chain harmlessly
      return proxy
    },
    apply() {
      // Default: return self so .foo() and .foo().bar() both work
      return proxy
    },
    has() { return true },
    set() { return true },
  }

  proxy = new Proxy(target, handler) as T
  return proxy
}

const _NO_HOST_FORTEMI: FortemiContextValue = {
  db: makeNoHostStub<PGliteInstance>('db'),
  events: makeNoHostStub<TypedEventBus>('events'),
  archiveManager: makeNoHostStub<ArchiveManager>('archiveManager'),
  capabilityManager: makeNoHostStub<CapabilityManager>('capabilityManager'),
  blobStore: makeNoHostStub<BlobStore>('blobStore'),
}

let _warned = false

/**
 * Access the Fortemi context. Returns a "no-host" stub when no
 * `<FortemiProvider>` is mounted, so the React tree renders without
 * throwing. Hooks that depend on a real db / events / managers should
 * check for null and degrade gracefully (show "not configured" UI).
 */
export function useFortemiContext(): FortemiContextValue {
  const ctx = useContext(FortemiContext)
  if (!ctx) {
    if (!_warned && typeof console !== 'undefined') {
      _warned = true
      console.info(
        '[fortemi-react] no FortemiProvider mounted — using no-host stub (degraded mode for non-portal hosts). Consumers should detect null fields and render a "not configured" UI.',
      )
    }
    return _NO_HOST_FORTEMI
  }
  return ctx
}
