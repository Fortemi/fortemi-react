/**
 * Typed event bus with IDisposable subscriptions (Monaco-style).
 * SSE-style pub/sub across all layers.
 *
 * Features:
 * - Exact event subscriptions via on() and once()
 * - Wildcard prefix subscriptions: on('note.*', handler)
 * - Cross-context bridging via bridge(port: MessagePort)
 */

export interface IDisposable {
  dispose(): void
}

export interface EventMap {
  'note.created': { id: string }
  'note.updated': { id: string }
  'note.deleted': { id: string }
  'note.restored': { id: string }
  'note.revised': { id: string; revisionNumber: number }
  'search.reindexed': Record<string, never>
  'embedding.ready': { noteId: string }
  'capability.ready': { name: string }
  'capability.disabled': { name: string }
  'capability.loading': { name: string; progress?: number }
  'job.completed': { id: string; noteId: string; type: string }
  'job.failed': { id: string; noteId: string; type: string; error: string }
  'archive.switched': { name: string }
  'migration.applied': { version: number }
}

type EventHandler<T> = (payload: T) => void

/** Wildcard pattern: a string literal ending with '.*' */
type WildcardPattern = `${string}.*`

/** Bridge message envelope sent over a MessagePort */
interface BridgeMessage {
  type: 'event'
  event: string
  payload: unknown
}

export class TypedEventBus {
  private listeners = new Map<string, Set<EventHandler<unknown>>>()
  private wildcardListeners = new Map<string, Set<EventHandler<unknown>>>()

  // ---------------------------------------------------------------------------
  // on() — exact subscription
  // ---------------------------------------------------------------------------

  on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): IDisposable

  on(
    pattern: WildcardPattern,
    handler: EventHandler<unknown>,
  ): IDisposable

  on(
    eventOrPattern: string,
    handler: EventHandler<unknown>,
  ): IDisposable {
    if (eventOrPattern.endsWith('.*')) {
      return this._onWildcard(eventOrPattern as WildcardPattern, handler)
    }
    return this._onExact(eventOrPattern, handler)
  }

  private _onExact(event: string, handler: EventHandler<unknown>): IDisposable {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)

    return {
      dispose: () => {
        set!.delete(handler)
        if (set!.size === 0) {
          this.listeners.delete(event)
        }
      },
    }
  }

  private _onWildcard(pattern: WildcardPattern, handler: EventHandler<unknown>): IDisposable {
    // Store under the prefix (everything before '.*')
    const prefix = pattern.slice(0, -2)
    let set = this.wildcardListeners.get(prefix)
    if (!set) {
      set = new Set()
      this.wildcardListeners.set(prefix, set)
    }
    set.add(handler)

    return {
      dispose: () => {
        set!.delete(handler)
        if (set!.size === 0) {
          this.wildcardListeners.delete(prefix)
        }
      },
    }
  }

  // ---------------------------------------------------------------------------
  // once() — auto-disposing subscription
  // ---------------------------------------------------------------------------

  once<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): IDisposable {
    // eslint-disable-next-line prefer-const
    let sub: IDisposable | undefined

    const wrapper: EventHandler<EventMap[K]> = (payload) => {
      sub?.dispose()
      handler(payload)
    }

    sub = this._onExact(event as string, wrapper as EventHandler<unknown>)
    return sub
  }

  // ---------------------------------------------------------------------------
  // emit() — fire event to exact + wildcard listeners
  // ---------------------------------------------------------------------------

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    // Exact listeners
    const exactSet = this.listeners.get(event as string)
    if (exactSet) {
      for (const handler of exactSet) {
        handler(payload)
      }
    }

    // Wildcard listeners — match prefix before the first '.'
    // e.g. 'note.created' matches prefix 'note'
    const dotIndex = (event as string).indexOf('.')
    if (dotIndex !== -1) {
      const prefix = (event as string).slice(0, dotIndex)
      const wildcardSet = this.wildcardListeners.get(prefix)
      if (wildcardSet) {
        for (const handler of wildcardSet) {
          handler(payload)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // bridge() — cross-context forwarding via MessagePort
  // ---------------------------------------------------------------------------

  bridge(port: MessagePort): IDisposable {
    // Forward all locally emitted events to the port.
    // We intercept emit by wrapping it — instead, subscribe to every possible
    // event via a broadcast interceptor added around emit.
    const forwardingInterceptor = (event: string, payload: unknown): void => {
      port.postMessage({ type: 'event', event, payload } satisfies BridgeMessage)
    }

    // Track bridging state so dispose can stop forwarding.
    let active = true

    // Patch emit to forward when bridge is active.
    const originalEmit = this.emit.bind(this)
    this.emit = <K extends keyof EventMap>(event: K, payload: EventMap[K]): void => {
      originalEmit(event, payload)
      if (active) {
        forwardingInterceptor(event as string, payload)
      }
    }

    // Listen on the port for incoming events and re-emit locally.
    const messageHandler = (e: MessageEvent): void => {
      const data = e.data as BridgeMessage
      if (data?.type === 'event' && typeof data.event === 'string') {
        // Re-emit without triggering the bridge forward (would cause loops).
        // Use the original emit to avoid forwarding back.
        originalEmit(data.event as keyof EventMap, data.payload as never)
      }
    }

    port.addEventListener('message', messageHandler)

    return {
      dispose: () => {
        active = false
        this.emit = originalEmit
        port.removeEventListener('message', messageHandler)
      },
    }
  }

  // ---------------------------------------------------------------------------
  // removeAllListeners()
  // ---------------------------------------------------------------------------

  removeAllListeners(): void {
    this.listeners.clear()
    this.wildcardListeners.clear()
  }
}
