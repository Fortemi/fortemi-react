import { useEffect, useRef, useState } from 'react'
import type { CapabilityManager, CapabilityName } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

const ENABLED_CAPS_KEY = 'fortemi:enabled-capabilities'

/** Get previously enabled capabilities from localStorage */
function getEnabledCapabilities(): string[] {
  if (typeof localStorage === 'undefined') return []
  const stored = localStorage.getItem(ENABLED_CAPS_KEY)
  if (stored) {
    try { return JSON.parse(stored) } catch { /* fall through */ }
  }
  return ['semantic', 'llm']
}

export type SetupCapabilitiesFn = (manager: CapabilityManager) => void

export interface UseCapabilitySetupOptions {
  /** Function that registers loaders with the CapabilityManager.
   *  See apps/standalone/src/capabilities/setup.ts for an example. */
  setup: SetupCapabilitiesFn

  /** Which capabilities to auto-enable on mount.
   *  Defaults to previously-enabled capabilities from localStorage. */
  autoEnable?: CapabilityName[]
}

export interface UseCapabilitySetupReturn {
  ready: boolean
  error: Error | null
}

/**
 * Wires capability loaders on mount and auto-enables previously-enabled capabilities.
 *
 * The `setup` function registers loaders (transformers.js, WebLLM, etc.) with
 * the CapabilityManager. This keeps ML dependencies in the consumer app rather
 * than bundling them in @fortemi/react.
 *
 * @example
 * ```tsx
 * import { setupCapabilities } from './capabilities/setup'
 *
 * function App() {
 *   const { ready } = useCapabilitySetup({ setup: setupCapabilities })
 *   if (!ready) return <Loading />
 *   return <MyApp />
 * }
 * ```
 */
export function useCapabilitySetup(options: UseCapabilitySetupOptions): UseCapabilitySetupReturn {
  const { capabilityManager } = useFortemiContext()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    options.setup(capabilityManager)

    const toEnable = options.autoEnable ?? getEnabledCapabilities()
    const validCaps: CapabilityName[] = ['semantic', 'llm', 'audio', 'vision', 'pdf']
    const enablePromises = toEnable
      .filter((name): name is CapabilityName => validCaps.includes(name as CapabilityName))
      .map((name) => capabilityManager.enable(name).catch(() => { /* individual cap failures are non-fatal */ }))

    Promise.all(enablePromises)
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
  }, [capabilityManager, options])

  return { ready, error }
}
