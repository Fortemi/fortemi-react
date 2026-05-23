import type { PGlite } from '@electric-sql/pglite'
import { createPGliteInstance, type PersistenceMode } from './db.js'

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

export const defaultStorageBackendFactory = new PGliteStorageBackendFactory()
