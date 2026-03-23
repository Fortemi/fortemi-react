/**
 * Type-safe client for the PGlite Worker.
 *
 * PGliteWorkerClient wraps a Worker instance and exposes the same surface as
 * PGlite (query / exec / transaction) but serialises every call to a typed
 * postMessage exchange. Each outgoing request is tagged with a UUIDv7 `id`;
 * the worker echoes that id in its reply so the client can resolve or reject
 * the matching Promise.
 *
 * TransactionProxy is a lightweight wrapper handed to the callback in
 * transaction(), forwarding TX_QUERY / TX_EXEC messages with the active txId.
 */

import { generateId } from '../uuid.js'
import type { WorkerResponse } from './protocol.js'

export class PGliteWorkerClient {
  private pending = new Map<string, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>()
  private readyPromise: Promise<void>
  private resolveReady!: () => void

  constructor(private worker: Worker) {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })

    this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data

      if (msg.type === 'READY') {
        this.resolveReady()
        return
      }

      if (!('id' in msg)) return

      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)

      if (msg.type === 'ERROR') {
        pending.reject(new Error(msg.error))
      } else {
        pending.resolve(msg)
      }
    })
  }

  /** Resolves when the worker broadcasts READY after database initialisation. */
  async waitReady(): Promise<void> {
    return this.readyPromise
  }

  private send<T extends WorkerResponse>(request: { type: string } & Record<string, unknown>): Promise<T> {
    const id = generateId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: WorkerResponse) => void,
        reject,
      })
      this.worker.postMessage({ ...request, id })
    })
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; fields?: Array<{ name: string; dataTypeID: number }> }> {
    const resp = await this.send<Extract<WorkerResponse, { type: 'RESULT' }>>({ type: 'QUERY', sql, params })
    return { rows: resp.rows as T[], fields: resp.fields }
  }

  async exec(sql: string): Promise<void> {
    await this.send({ type: 'EXEC', sql })
  }

  async transaction<T>(fn: (tx: TransactionProxy) => Promise<T>): Promise<T> {
    const resp = await this.send<Extract<WorkerResponse, { type: 'TX_STARTED' }>>({ type: 'BEGIN' })
    const txId = resp.txId
    const proxy = new TransactionProxy(this, txId)
    try {
      const result = await fn(proxy)
      await this.send({ type: 'COMMIT', txId })
      return result
    } catch (err) {
      // Best-effort rollback — ignore secondary errors so the original throws.
      await this.send({ type: 'ROLLBACK', txId }).catch(() => {})
      throw err
    }
  }

  /** Forward TX_QUERY for TransactionProxy — not part of the public surface. */
  async _txQuery<T>(txId: string, sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const resp = await this.send<Extract<WorkerResponse, { type: 'RESULT' }>>({
      type: 'TX_QUERY',
      txId,
      sql,
      params,
    })
    return { rows: resp.rows as T[] }
  }

  /** Forward TX_EXEC for TransactionProxy — not part of the public surface. */
  async _txExec(txId: string, sql: string): Promise<void> {
    await this.send({ type: 'TX_EXEC', txId, sql })
  }

  async ping(): Promise<void> {
    await this.send({ type: 'PING' })
  }

  async close(): Promise<void> {
    await this.send({ type: 'CLOSE' })
    this.worker.terminate()
  }
}

/** Proxy passed to the transaction callback — scopes queries to the active txId. */
export class TransactionProxy {
  constructor(
    private client: PGliteWorkerClient,
    private txId: string,
  ) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    return this.client._txQuery<T>(this.txId, sql, params)
  }

  async exec(sql: string): Promise<void> {
    return this.client._txExec(this.txId, sql)
  }
}
