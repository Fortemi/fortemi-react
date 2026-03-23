/**
 * Tests for PGliteWorkerClient using a synchronous MockWorker.
 *
 * Web Workers cannot be instantiated in a Node/Vitest environment, so we
 * drive the client with a MockWorker that immediately (via setTimeout(0))
 * replies with the protocol response matching each request type.
 *
 * Coverage:
 *   - PING/PONG round-trip
 *   - QUERY returning rows
 *   - EXEC resolving without error
 *   - Transaction BEGIN → COMMIT flow
 *   - Transaction rollback on callback error
 *   - CLOSE terminates the worker
 *   - ERROR response rejects the pending promise
 *   - waitReady() resolves when READY is broadcast
 *   - TransactionProxy.query and .exec delegates to _txQuery/_txExec
 *   - Unmatched id in response is ignored gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PGliteWorkerClient, TransactionProxy } from '../worker/worker-client.js'
import type { WorkerResponse } from '../worker/protocol.js'

// ---------------------------------------------------------------------------
// MockWorker
// ---------------------------------------------------------------------------

class MockWorker {
  private messageHandlers: Array<(e: MessageEvent) => void> = []
  readonly terminateSpy = vi.fn()

  /** Captured outbound requests so tests can inspect them. */
  readonly sent: unknown[] = []

  /**
   * Simulates the worker echoing a typed response.
   * Each request type maps to a deterministic reply.
   */
  postMessage(data: Record<string, unknown>): void {
    this.sent.push(data)

    let response: WorkerResponse | null = null

    switch (data.type) {
      case 'PING':
        response = { id: data.id as string, type: 'PONG' }
        break
      case 'QUERY':
        response = {
          id: data.id as string,
          type: 'RESULT',
          rows: [{ answer: 42 }],
          fields: [{ name: 'answer', dataTypeID: 23 }],
        }
        break
      case 'EXEC':
        response = { id: data.id as string, type: 'EXEC_DONE' }
        break
      case 'BEGIN':
        response = { id: data.id as string, type: 'TX_STARTED', txId: 'mock-tx-1' }
        break
      case 'COMMIT':
        response = { id: data.id as string, type: 'TX_DONE' }
        break
      case 'ROLLBACK':
        response = { id: data.id as string, type: 'TX_DONE' }
        break
      case 'TX_QUERY':
        response = {
          id: data.id as string,
          type: 'RESULT',
          rows: [{ tx_row: true }],
        }
        break
      case 'TX_EXEC':
        response = { id: data.id as string, type: 'EXEC_DONE' }
        break
      case 'CLOSE':
        response = { id: data.id as string, type: 'EXEC_DONE' }
        break
      default:
        return // unhandled — no response (tests for unknown ids)
    }

    const payload = response
    setTimeout(() => {
      for (const handler of this.messageHandlers) {
        handler(new MessageEvent('message', { data: payload }))
      }
    }, 0)
  }

  addEventListener(type: string, handler: (e: MessageEvent) => void): void {
    if (type === 'message') {
      this.messageHandlers.push(handler)
    }
  }

  terminate(): void {
    this.terminateSpy()
  }
}

/**
 * ErrorWorker — always responds with an ERROR message, used to test rejection.
 */
class ErrorWorker extends MockWorker {
  override postMessage(data: Record<string, unknown>): void {
    this.sent.push(data)
    const response: WorkerResponse = {
      id: data.id as string,
      type: 'ERROR',
      error: 'simulated worker error',
    }
    setTimeout(() => {
      for (const handler of (this as unknown as { messageHandlers: Array<(e: MessageEvent) => void> }).messageHandlers) {
        handler(new MessageEvent('message', { data: response }))
      }
    }, 0)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(worker: MockWorker): PGliteWorkerClient {
  return new PGliteWorkerClient(worker as unknown as Worker)
}

function broadcastReady(worker: MockWorker): void {
  // Simulate the READY broadcast the worker emits on startup.
  // We reach into the private handlers via the MockWorker's registered list.
  const handlers = (worker as unknown as { messageHandlers: Array<(e: MessageEvent) => void> }).messageHandlers
  for (const handler of handlers) {
    handler(new MessageEvent('message', { data: { type: 'READY' } }))
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PGliteWorkerClient', () => {
  let worker: MockWorker
  let client: PGliteWorkerClient

  beforeEach(() => {
    worker = new MockWorker()
    client = makeClient(worker)
  })

  // -------------------------------------------------------------------------
  // waitReady
  // -------------------------------------------------------------------------

  it('waitReady resolves when READY is broadcast', async () => {
    const readyPromise = client.waitReady()
    broadcastReady(worker)
    await expect(readyPromise).resolves.toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // PING / PONG
  // -------------------------------------------------------------------------

  it('ping resolves after PONG response', async () => {
    await expect(client.ping()).resolves.toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // QUERY
  // -------------------------------------------------------------------------

  it('query returns rows and fields from RESULT response', async () => {
    const result = await client.query<{ answer: number }>('SELECT 42 AS answer')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].answer).toBe(42)
    expect(result.fields).toEqual([{ name: 'answer', dataTypeID: 23 }])
  })

  it('query forwards params in the postMessage', async () => {
    await client.query('SELECT $1', [99])
    const lastSent = worker.sent.at(-1) as Record<string, unknown>
    expect(lastSent.type).toBe('QUERY')
    expect(lastSent.params).toEqual([99])
  })

  it('query without params does not send params field as non-array', async () => {
    await client.query('SELECT 1')
    const lastSent = worker.sent.at(-1) as Record<string, unknown>
    expect(lastSent.type).toBe('QUERY')
    // params may be undefined or omitted — either is acceptable
    expect(lastSent.params == null || Array.isArray(lastSent.params)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // EXEC
  // -------------------------------------------------------------------------

  it('exec resolves without error on EXEC_DONE response', async () => {
    await expect(client.exec('CREATE TABLE foo (id TEXT)')).resolves.toBeUndefined()
  })

  it('exec sends the SQL string to the worker', async () => {
    const sql = 'CREATE TABLE bar (val INT)'
    await client.exec(sql)
    const lastSent = worker.sent.at(-1) as Record<string, unknown>
    expect(lastSent.type).toBe('EXEC')
    expect(lastSent.sql).toBe(sql)
  })

  // -------------------------------------------------------------------------
  // Transaction — commit path
  // -------------------------------------------------------------------------

  it('transaction sends BEGIN then COMMIT on successful callback', async () => {
    const result = await client.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (1)')
      return 'done'
    })

    expect(result).toBe('done')

    const types = (worker.sent as Array<Record<string, unknown>>).map((m) => m.type)
    expect(types).toContain('BEGIN')
    expect(types).toContain('TX_EXEC')
    expect(types).toContain('COMMIT')
    expect(types).not.toContain('ROLLBACK')
  })

  it('transaction uses the txId from TX_STARTED in TX_EXEC messages', async () => {
    await client.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (1)')
    })

    const txExec = (worker.sent as Array<Record<string, unknown>>).find((m) => m.type === 'TX_EXEC')
    expect(txExec?.txId).toBe('mock-tx-1')
  })

  it('transaction.query forwards TX_QUERY with txId and returns rows', async () => {
    let rows: Array<{ tx_row: boolean }> = []

    await client.transaction(async (tx) => {
      const result = await tx.query<{ tx_row: boolean }>('SELECT true AS tx_row')
      rows = result.rows
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].tx_row).toBe(true)

    const txQuery = (worker.sent as Array<Record<string, unknown>>).find((m) => m.type === 'TX_QUERY')
    expect(txQuery?.txId).toBe('mock-tx-1')
  })

  // -------------------------------------------------------------------------
  // Transaction — rollback path
  // -------------------------------------------------------------------------

  it('transaction sends ROLLBACK when callback throws', async () => {
    await expect(
      client.transaction(async () => {
        throw new Error('forced failure')
      }),
    ).rejects.toThrow('forced failure')

    const types = (worker.sent as Array<Record<string, unknown>>).map((m) => m.type)
    expect(types).toContain('BEGIN')
    expect(types).toContain('ROLLBACK')
    expect(types).not.toContain('COMMIT')
  })

  it('transaction re-throws the original error after rollback', async () => {
    const err = new Error('original error')
    await expect(
      client.transaction(async () => {
        throw err
      }),
    ).rejects.toBe(err)
  })

  // -------------------------------------------------------------------------
  // CLOSE
  // -------------------------------------------------------------------------

  it('close sends CLOSE message then terminates the worker', async () => {
    await client.close()

    const types = (worker.sent as Array<Record<string, unknown>>).map((m) => m.type)
    expect(types).toContain('CLOSE')
    expect(worker.terminateSpy).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------------
  // ERROR responses
  // -------------------------------------------------------------------------

  it('rejects the pending promise when the worker responds with ERROR', async () => {
    const errorWorker = new ErrorWorker()
    const errorClient = makeClient(errorWorker)

    await expect(errorClient.ping()).rejects.toThrow('simulated worker error')
  })

  it('ERROR response for exec rejects with the error message', async () => {
    const errorWorker = new ErrorWorker()
    const errorClient = makeClient(errorWorker)

    await expect(errorClient.exec('DROP TABLE x')).rejects.toThrow('simulated worker error')
  })

  // -------------------------------------------------------------------------
  // Unmatched id — graceful no-op
  // -------------------------------------------------------------------------

  it('ignores response messages whose id is not pending', async () => {
    const handlers = (worker as unknown as { messageHandlers: Array<(e: MessageEvent) => void> }).messageHandlers

    // Dispatch a response with a totally unknown id — should not throw.
    expect(() => {
      for (const h of handlers) {
        h(
          new MessageEvent('message', {
            data: { id: 'non-existent-id', type: 'PONG' } satisfies WorkerResponse,
          }),
        )
      }
    }).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // Request id uniqueness
  // -------------------------------------------------------------------------

  it('each request gets a unique id', async () => {
    await Promise.all([client.ping(), client.ping(), client.ping()])
    const ids = (worker.sent as Array<Record<string, unknown>>).map((m) => m.id as string)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// TransactionProxy (unit tests independent of PGliteWorkerClient)
// ---------------------------------------------------------------------------

describe('TransactionProxy', () => {
  it('query delegates to client._txQuery with correct txId', async () => {
    const mockClient = {
      _txQuery: vi.fn().mockResolvedValue({ rows: [{ n: 1 }] }),
      _txExec: vi.fn().mockResolvedValue(undefined),
    }
    const proxy = new TransactionProxy(
      mockClient as unknown as PGliteWorkerClient,
      'tx-abc',
    )

    const result = await proxy.query<{ n: number }>('SELECT 1 AS n')
    expect(mockClient._txQuery).toHaveBeenCalledWith('tx-abc', 'SELECT 1 AS n', undefined)
    expect(result.rows[0].n).toBe(1)
  })

  it('query forwards params to _txQuery', async () => {
    const mockClient = {
      _txQuery: vi.fn().mockResolvedValue({ rows: [] }),
      _txExec: vi.fn().mockResolvedValue(undefined),
    }
    const proxy = new TransactionProxy(mockClient as unknown as PGliteWorkerClient, 'tx-def')

    await proxy.query('SELECT $1', [42])
    expect(mockClient._txQuery).toHaveBeenCalledWith('tx-def', 'SELECT $1', [42])
  })

  it('exec delegates to client._txExec with correct txId', async () => {
    const mockClient = {
      _txQuery: vi.fn().mockResolvedValue({ rows: [] }),
      _txExec: vi.fn().mockResolvedValue(undefined),
    }
    const proxy = new TransactionProxy(mockClient as unknown as PGliteWorkerClient, 'tx-xyz')

    await proxy.exec('DELETE FROM t')
    expect(mockClient._txExec).toHaveBeenCalledWith('tx-xyz', 'DELETE FROM t')
  })
})
