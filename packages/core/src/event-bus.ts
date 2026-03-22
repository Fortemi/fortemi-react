/**
 * Typed event bus with IDisposable subscriptions (Monaco-style).
 * SSE-style pub/sub across all layers.
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

export class TypedEventBus {
  private listeners = new Map<string, Set<EventHandler<unknown>>>()

  on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): IDisposable {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler as EventHandler<unknown>)

    return {
      dispose: () => {
        set!.delete(handler as EventHandler<unknown>)
        if (set!.size === 0) {
          this.listeners.delete(event)
        }
      },
    }
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of set) {
      handler(payload)
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
