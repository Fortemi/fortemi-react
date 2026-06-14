import { describe, expect, it } from 'vitest'
import {
  ArchiveManager,
  PGliteWorkerStorageBackendFactory,
  TagsRepository,
  type QueryExecutor,
  type QueryResult,
  type StorageBackend,
  type StorageBackendFactory,
  type StorageOpenRequest,
} from '../index.js'

class MockWorker {
  private handlers: Array<(e: MessageEvent) => void> = []
  readonly sent: unknown[] = []
  terminated = false

  postMessage(data: Record<string, unknown>): void {
    this.sent.push(data)
    if (data.type === 'INIT') {
      queueMicrotask(() => this.broadcast({ type: 'READY' }))
      return
    }
    if (data.type === 'CLOSE') {
      queueMicrotask(() => this.broadcast({ id: data.id as string, type: 'EXEC_DONE' }))
      return
    }
    if (data.type === 'QUERY') {
      queueMicrotask(() => this.broadcast({ id: data.id as string, type: 'RESULT', rows: [{ ok: true }] }))
      return
    }
    queueMicrotask(() => this.broadcast({ id: data.id as string, type: 'EXEC_DONE' }))
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    if (type === 'message') this.handlers.push(handler)
  }

  terminate(): void {
    this.terminated = true
  }

  private broadcast(data: unknown): void {
    for (const handler of this.handlers) {
      handler(new MessageEvent('message', { data }))
    }
  }
}

class FakeStorageBackend implements StorageBackend {
  readonly mode = 'readwrite' as const
  readonly queries: Array<{ sql: string; params?: unknown[] }> = []
  readonly execs: string[] = []
  closed = false

  constructor(readonly id: string) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ sql, params })

    if (sql.includes('COALESCE(MAX(version)')) {
      return { rows: [{ version: 5 }] as T[] }
    }

    return { rows: [] }
  }

  async exec(sql: string): Promise<void> {
    this.execs.push(sql)
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class FakeStorageBackendFactory implements StorageBackendFactory {
  readonly requests: StorageOpenRequest[] = []
  readonly backends: FakeStorageBackend[] = []

  async open(input: StorageOpenRequest): Promise<StorageBackend> {
    this.requests.push(input)
    const backend = new FakeStorageBackend(`fake:${input.archiveName}`)
    this.backends.push(backend)
    return backend
  }
}

describe('storage backend abstraction', () => {
  it('lets ArchiveManager open archives through an injected backend factory', async () => {
    const factory = new FakeStorageBackendFactory()
    const manager = new ArchiveManager(factory)

    const db = await manager.open('desktop')

    expect(db.id).toBe('fake:desktop')
    expect(manager.getDb()).toBe(db)
    expect(manager.getCurrentArchiveName()).toBe('desktop')
    expect(factory.requests).toEqual([{ archiveName: 'desktop', persistence: 'memory' }])
    expect(factory.backends[0].execs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS schema_version'))).toBe(true)

    await manager.close()
    expect(factory.backends[0].closed).toBe(true)
  })

  it('closes the previous injected backend when switching archives', async () => {
    const factory = new FakeStorageBackendFactory()
    const manager = new ArchiveManager(factory)

    await manager.open('alpha')
    await manager.open('beta')

    expect(factory.backends[0].closed).toBe(true)
    expect(factory.backends[1].closed).toBe(false)

    await manager.close()
  })

  it('lets repositories use the injected backend contract without depending on PGlite', async () => {
    const backend = new FakeStorageBackend('fake:repo')
    const repo = new TagsRepository(backend)

    await repo.addTag('note-1', 'portable')

    expect(backend.queries[0].params?.slice(1)).toEqual(['note-1', 'portable'])
    expect(backend.queries[0].sql).toContain('INSERT INTO note_tag')
  })

  it('passes persistence through to an injected backend factory when provided', async () => {
    const factory = new FakeStorageBackendFactory()
    const manager = new ArchiveManager(factory, undefined, 'idb')

    await manager.open('worker-archive')

    expect(factory.requests).toEqual([{ archiveName: 'worker-archive', persistence: 'idb' }])
    await manager.close()
  })

  it('opens a PGlite worker backend with INIT and wraps query/close', async () => {
    const worker = new MockWorker()
    const factory = new PGliteWorkerStorageBackendFactory({
      createWorker: () => worker as unknown as Worker,
    })

    const backend = await factory.open({ archiveName: 'docs', persistence: 'opfs' })
    const init = worker.sent[0] as Record<string, unknown>
    expect(init).toMatchObject({ type: 'INIT', archiveName: 'docs', persistence: 'opfs' })
    expect(backend.id).toBe('pglite-worker:opfs:docs')

    const result = await backend.query<{ ok: boolean }>('SELECT true AS ok')
    expect(result.rows[0].ok).toBe(true)

    await backend.close()
    expect(worker.terminated).toBe(true)
  })
})
