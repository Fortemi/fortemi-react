/// <reference lib="webworker" />
/**
 * PGlite Worker script.
 *
 * Runs inside a Web Worker context. Initialises a PGlite instance on receipt
 * of an INIT message, then dispatches typed postMessage requests to the
 * matching PGlite API call and replies with a typed WorkerResponse.
 *
 * Transaction state is tracked in a local Map keyed by txId. Since PGlite
 * is single-threaded within the worker there is no concurrency hazard — only
 * one transaction can be active at a time over raw SQL BEGIN/COMMIT.
 */

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import type { WorkerRequest, WorkerResponse } from './protocol.js'
import type { PersistenceMode } from '../db.js'

let db: PGlite | null = null
// Track open raw-SQL transactions by txId so COMMIT/ROLLBACK are gated.
const transactions = new Map<string, true>()

function respond(msg: WorkerResponse): void {
  self.postMessage(msg)
}

async function initDb(persistence: PersistenceMode, archiveName: string): Promise<void> {
  const dataDir =
    persistence === 'memory'
      ? undefined
      : persistence === 'opfs'
        ? `opfs-ahp://fortemi-${archiveName}`
        : `idb://fortemi-${archiveName}`

  const options: Record<string, unknown> = {
    database: 'postgres',
    extensions: { vector },
  }

  if (dataDir) {
    options.dataDir = dataDir
  }

  db = await PGlite.create(options)
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  respond({ type: 'READY' })
}

type InitMessage = {
  type: 'INIT'
  persistence: PersistenceMode
  archiveName?: string
}

self.addEventListener(
  'message',
  async (e: MessageEvent<WorkerRequest | InitMessage>) => {
    const msg = e.data

    if (msg.type === 'INIT') {
      try {
        await initDb(msg.persistence, msg.archiveName ?? 'default')
      } catch (err) {
        respond({
          id: '',
          type: 'ERROR',
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    if (!db) {
      respond({
        id: (msg as WorkerRequest).id,
        type: 'ERROR',
        error: 'Database not initialized',
      })
      return
    }

    const req = msg as WorkerRequest

    try {
      switch (req.type) {
        case 'PING':
          respond({ id: req.id, type: 'PONG' })
          break

        case 'QUERY': {
          const result = await db.query(req.sql, req.params)
          respond({
            id: req.id,
            type: 'RESULT',
            rows: result.rows,
            fields: result.fields as Array<{ name: string; dataTypeID: number }>,
          })
          break
        }

        case 'EXEC':
          await db.exec(req.sql)
          respond({ id: req.id, type: 'EXEC_DONE' })
          break

        case 'BEGIN': {
          const txId = crypto.randomUUID()
          await db.exec('BEGIN')
          transactions.set(txId, true)
          respond({ id: req.id, type: 'TX_STARTED', txId })
          break
        }

        case 'COMMIT':
          if (transactions.has(req.txId)) {
            await db.exec('COMMIT')
            transactions.delete(req.txId)
          }
          respond({ id: req.id, type: 'TX_DONE' })
          break

        case 'ROLLBACK':
          if (transactions.has(req.txId)) {
            await db.exec('ROLLBACK')
            transactions.delete(req.txId)
          }
          respond({ id: req.id, type: 'TX_DONE' })
          break

        case 'TX_QUERY': {
          const result = await db.query(req.sql, req.params)
          respond({
            id: req.id,
            type: 'RESULT',
            rows: result.rows,
            fields: result.fields as Array<{ name: string; dataTypeID: number }>,
          })
          break
        }

        case 'TX_EXEC':
          await db.exec(req.sql)
          respond({ id: req.id, type: 'EXEC_DONE' })
          break

        case 'CLOSE':
          await db.close()
          db = null
          respond({ id: req.id, type: 'EXEC_DONE' })
          break

        default:
          respond({
            id: (req as { id: string }).id,
            type: 'ERROR',
            error: `Unknown request type: ${(req as { type: string }).type}`,
          })
      }
    } catch (err) {
      respond({
        id: req.id,
        type: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
)
