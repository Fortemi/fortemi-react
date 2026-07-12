import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance, type PersistenceMode } from './db.js'
import { PGliteWorkerClient } from './worker/worker-client.js'

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  fields?: Array<{ name: string; dataTypeID: number }>
}

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  exec(sql: string): Promise<unknown>
}

export interface DatabaseClient extends QueryExecutor {
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>
}

export interface StorageBackend extends DatabaseClient {
  readonly id: string
  readonly mode: 'readwrite' | 'readonly'
  close(): Promise<void>
}

export interface StorageOpenRequest {
  archiveName: string
  persistence: PersistenceMode
}

export interface StorageBackendFactory {
  open(input: StorageOpenRequest): Promise<StorageBackend>
}

export interface StorageTopology {
  primary: StorageBackend
  secondary?: StorageBackend
  policy: 'primary-only' | 'read-through-secondary' | 'explicit-replication'
}

export class PGliteStorageBackend implements StorageBackend {
  readonly mode = 'readwrite'

  constructor(
    readonly id: string,
    private db: PGlite,
  ) {}

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.db.query<T>(sql, params)
  }

  exec(sql: string): Promise<unknown> {
    return this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx))
  }

  close(): Promise<void> {
    return this.db.close()
  }
}

export class PGliteStorageBackendFactory implements StorageBackendFactory {
  async open(input: StorageOpenRequest): Promise<StorageBackend> {
    const db = await createPGliteInstance(input.persistence, input.archiveName)
    return new PGliteStorageBackend(`pglite:${input.persistence}:${input.archiveName}`, db)
  }
}

/**
 * Built-in PGlite backend factory — the opt-in default (issue #261). PGlite is
 * loaded lazily by `createPGliteInstance` on first `open()`, so referencing
 * this constant does not force the WASM engine into a consumer's static graph.
 * Hosts wanting a different store pass their own `StorageBackendFactory` to
 * `ArchiveManager` instead.
 */
export const defaultStorageBackendFactory = new PGliteStorageBackendFactory()

export class PGliteWorkerStorageBackend implements StorageBackend {
  readonly mode = 'readwrite'

  constructor(
    readonly id: string,
    private client: PGliteWorkerClient,
  ) {}

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.client.query<T>(sql, params)
  }

  exec(sql: string): Promise<unknown> {
    return this.client.exec(sql)
  }

  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return this.client.transaction(fn)
  }

  close(): Promise<void> {
    return this.client.close()
  }
}

export interface PGliteWorkerStorageBackendFactoryOptions {
  createWorker: () => Worker
}

export class PGliteWorkerStorageBackendFactory implements StorageBackendFactory {
  constructor(private options: PGliteWorkerStorageBackendFactoryOptions) {}

  async open(input: StorageOpenRequest): Promise<StorageBackend> {
    const worker = this.options.createWorker()
    const client = new PGliteWorkerClient(worker)
    worker.postMessage({
      type: 'INIT',
      persistence: input.persistence,
      archiveName: input.archiveName,
    })
    await client.waitReady()
    return new PGliteWorkerStorageBackend(`pglite-worker:${input.persistence}:${input.archiveName}`, client)
  }
}
