/**
 * Shared postMessage protocol types for the PGlite worker.
 *
 * WorkerRequest — messages sent from the client to the worker.
 * WorkerResponse — messages sent from the worker back to the client.
 *
 * Every request carries a unique `id` that the worker echoes in its response,
 * allowing the client to correlate replies with pending promises.
 * The READY broadcast is the only message without an `id` — it is sent once
 * on startup before any requests are processed.
 */

/** Messages from client to worker */
export type WorkerRequest =
  | { id: string; type: 'QUERY'; sql: string; params?: unknown[] }
  | { id: string; type: 'EXEC'; sql: string }
  | { id: string; type: 'BEGIN'; isolationLevel?: string }
  | { id: string; type: 'COMMIT'; txId: string }
  | { id: string; type: 'ROLLBACK'; txId: string }
  | { id: string; type: 'TX_QUERY'; txId: string; sql: string; params?: unknown[] }
  | { id: string; type: 'TX_EXEC'; txId: string; sql: string }
  | { id: string; type: 'CLOSE' }
  | { id: string; type: 'PING' }

/** Messages from worker to client */
export type WorkerResponse =
  | { id: string; type: 'RESULT'; rows: unknown[]; fields?: Array<{ name: string; dataTypeID: number }> }
  | { id: string; type: 'EXEC_DONE'; affectedRows?: number }
  | { id: string; type: 'TX_STARTED'; txId: string }
  | { id: string; type: 'TX_DONE' }
  | { id: string; type: 'ERROR'; error: string }
  | { id: string; type: 'PONG' }
  | { type: 'READY' } // No id — broadcast on startup
