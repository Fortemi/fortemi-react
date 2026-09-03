import { computeHash } from './hash.js'
import { generateId } from './uuid.js'

export const DATASET_INGEST_CONTRACT = 'fortemi.dataset-ingest/v1' as const
export const DATASET_INGEST_SCHEMA_VERSION = '1.0.0' as const

export type DatasetIngestMode = 'full' | 'snapshot' | 'incremental'
export type DatasetRunState = 'running' | 'committed' | 'cancelled' | 'failed' | 'degraded'
export type DatasetVerificationState = 'pending' | 'verified' | 'failed'

export interface DatasetDestinationScope {
  tenant: string
  dataset: string
  sourceBinding: string
  stream: string
  partition?: string
}

export interface DatasetProcessingPlan {
  contract: typeof DATASET_INGEST_CONTRACT
  schemaVersion: string
  planId: string
  planDigest: string
  sourceRevision: string
  configurationDigest: string
  transformationDigest: string
  destination: DatasetDestinationScope
  mode: DatasetIngestMode
  rejectionPolicy: {
    mode: 'fail-fast' | 'bounded-reject' | 'dlq'
    maxRejectedRecords: number
  }
  reconciliation: {
    enabled: boolean
    maxTombstones: number
  }
}

export interface DatasetCheckpoint {
  contract: typeof DATASET_INGEST_CONTRACT
  schemaVersion: string
  scope: DatasetDestinationScope
  opaque: string
  sequence: number
}

export interface DatasetUpsertMutation {
  operation: 'upsert'
  logicalId: string
  revision: string
  digest: string
  value: unknown
  locator?: string
}

export interface DatasetTombstoneMutation {
  operation: 'tombstone'
  logicalId: string
  revision: string
  digest: string
  locator?: string
}

export type DatasetMutation = DatasetUpsertMutation | DatasetTombstoneMutation

export interface DatasetMutationBatch {
  contract: typeof DATASET_INGEST_CONTRACT
  schemaVersion: string
  sequence: number
  idempotencyKey?: string
  mutations: DatasetMutation[]
  checkpointBefore?: DatasetCheckpoint
  checkpointAfter: DatasetCheckpoint
  enumeration?: {
    complete: boolean
    approvalId?: string
  }
}

export interface DatasetRecordRejection {
  logicalIdDigest: string
  locator?: string
  code: string
  message: string
}

export interface DatasetRunReceipt {
  contract: typeof DATASET_INGEST_CONTRACT
  schemaVersion: string
  runId: string
  idempotencyKey: string
  requestDigest: string
  planId: string
  planDigest: string
  sourceRevision: string
  destination: DatasetDestinationScope
  mode: DatasetIngestMode
  state: 'committed' | 'degraded'
  effects: Array<{ operation: DatasetMutation['operation']; logicalId: string; revision: string; digest: string }>
  acceptedRecords: number
  rejectedRecords: number
  rejections: DatasetRecordRejection[]
  outputDigest: string
  checkpointBefore?: DatasetCheckpoint
  checkpointAfter: DatasetCheckpoint
  verification: 'verified'
}

export interface DatasetRunAttempt {
  runId: string
  state: DatasetRunState
  verification: DatasetVerificationState
  idempotencyKey: string
  errorCode?: DatasetIngestErrorCode
}

export interface DatasetRunStatus {
  scope: DatasetDestinationScope
  lastAttempt?: DatasetRunAttempt
  lastSuccessful?: DatasetRunReceipt
  freshness: 'never' | 'current' | 'stale'
}

export type DatasetIngestErrorCode =
  | 'INGEST_CONTRACT_UNSUPPORTED' | 'INGEST_SCHEMA_UNSUPPORTED'
  | 'IDEMPOTENCY_CONFLICT' | 'CHECKPOINT_SCOPE_MISMATCH'
  | 'CHECKPOINT_VERSION_UNSUPPORTED' | 'CHECKPOINT_REGRESSION'
  | 'CHECKPOINT_MISMATCH' | 'BATCH_OUT_OF_ORDER' | 'RECORD_REJECTED'
  | 'REJECTION_LIMIT_EXCEEDED' | 'RECONCILIATION_NOT_ENABLED'
  | 'RECONCILIATION_INCOMPLETE' | 'RECONCILIATION_APPROVAL_REQUIRED'
  | 'INGEST_CANCELLED'

export class DatasetIngestError extends Error {
  constructor(public readonly code: DatasetIngestErrorCode, message: string) {
    super(message)
    this.name = 'DatasetIngestError'
  }
}

export interface DatasetStoredRecord {
  logicalId: string
  revision: string
  digest: string
  value?: unknown
  tombstoned: boolean
}

interface DatasetIngestState {
  records: Map<string, DatasetStoredRecord>
  receipts: Map<string, DatasetRunReceipt>
  checkpoint?: DatasetCheckpoint
}

export interface DatasetIngestTransaction {
  getRecord(logicalId: string): DatasetStoredRecord | undefined
  setRecord(record: DatasetStoredRecord): void
  getReceipt(idempotencyKey: string): DatasetRunReceipt | undefined
  setReceipt(receipt: DatasetRunReceipt): void
  getCheckpoint(): DatasetCheckpoint | undefined
  setCheckpoint(checkpoint: DatasetCheckpoint): void
}

export interface DatasetIngestStore {
  transact<T>(scopeKey: string, operation: (transaction: DatasetIngestTransaction) => Promise<T> | T): Promise<T>
  getReceipt(scopeKey: string, idempotencyKey: string): Promise<DatasetRunReceipt | undefined>
  getCheckpoint(scopeKey: string): Promise<DatasetCheckpoint | undefined>
  getRecords(scopeKey: string): Promise<DatasetStoredRecord[]>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class MemoryDatasetIngestStore implements DatasetIngestStore {
  private readonly scopes = new Map<string, DatasetIngestState>()
  private readonly queues = new Map<string, Promise<void>>()

  async transact<T>(scopeKey: string, operation: (transaction: DatasetIngestTransaction) => Promise<T> | T): Promise<T> {
    const predecessor = this.queues.get(scopeKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const queued = predecessor.then(() => current)
    this.queues.set(scopeKey, queued)
    await predecessor
    try {
      const existing: DatasetIngestState = this.scopes.get(scopeKey) ?? {
        records: new Map<string, DatasetStoredRecord>(),
        receipts: new Map<string, DatasetRunReceipt>(),
      }
      const draft: DatasetIngestState = {
        records: new Map([...existing.records].map(([key, value]) => [key, clone(value)])),
        receipts: new Map([...existing.receipts].map(([key, value]) => [key, clone(value)])),
        ...(existing.checkpoint ? { checkpoint: clone(existing.checkpoint) } : {}),
      }
      const transaction: DatasetIngestTransaction = {
        getRecord: id => draft.records.get(id),
        setRecord: record => draft.records.set(record.logicalId, clone(record)),
        getReceipt: key => draft.receipts.get(key),
        setReceipt: receipt => draft.receipts.set(receipt.idempotencyKey, clone(receipt)),
        getCheckpoint: () => draft.checkpoint,
        setCheckpoint: checkpoint => { draft.checkpoint = clone(checkpoint) },
      }
      const result = await operation(transaction)
      this.scopes.set(scopeKey, draft)
      return result
    } finally {
      release()
      if (this.queues.get(scopeKey) === queued) this.queues.delete(scopeKey)
    }
  }

  async getReceipt(scopeKey: string, idempotencyKey: string): Promise<DatasetRunReceipt | undefined> {
    return clone(this.scopes.get(scopeKey)?.receipts.get(idempotencyKey))
  }

  async getCheckpoint(scopeKey: string): Promise<DatasetCheckpoint | undefined> {
    return clone(this.scopes.get(scopeKey)?.checkpoint)
  }

  async getRecords(scopeKey: string): Promise<DatasetStoredRecord[]> {
    return [...(this.scopes.get(scopeKey)?.records.values() ?? [])].map(clone).sort((a, b) => a.logicalId.localeCompare(b.logicalId))
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

function digest(value: unknown): string {
  return computeHash(new TextEncoder().encode(canonicalJson(value)))
}

export function datasetDestinationScopeKey(scope: DatasetDestinationScope): string {
  return [scope.tenant, scope.dataset, scope.sourceBinding, scope.stream, scope.partition ?? ''].map(encodeURIComponent).join('/')
}

export function deriveDatasetIngestIdempotencyKey(plan: DatasetProcessingPlan, batch: DatasetMutationBatch): string {
  if (batch.idempotencyKey) return batch.idempotencyKey
  return digest({
    contract: DATASET_INGEST_CONTRACT,
    planId: plan.planId,
    planDigest: plan.planDigest,
    sourceRevision: plan.sourceRevision,
    configurationDigest: plan.configurationDigest,
    transformationDigest: plan.transformationDigest,
    destination: plan.destination,
    mode: plan.mode,
    sequence: batch.sequence,
    checkpointBefore: batch.checkpointBefore,
    checkpointAfter: batch.checkpointAfter,
    mutations: batch.mutations,
  })
}

export interface DatasetIngestHooks {
  beforeCommit?: () => void | Promise<void>
  afterCommit?: (receipt: DatasetRunReceipt) => void | Promise<void>
}

export interface ExecuteDatasetBatchOptions {
  signal?: AbortSignal
  hooks?: DatasetIngestHooks
  validateRecord?: (mutation: DatasetMutation) => { code: string; message: string } | undefined
}

function assertContract(plan: DatasetProcessingPlan, batch: DatasetMutationBatch): void {
  if (plan.contract !== DATASET_INGEST_CONTRACT || batch.contract !== DATASET_INGEST_CONTRACT) {
    throw new DatasetIngestError('INGEST_CONTRACT_UNSUPPORTED', 'Unsupported dataset ingest contract')
  }
  if (!plan.schemaVersion.startsWith('1.') || !batch.schemaVersion.startsWith('1.')) {
    throw new DatasetIngestError('INGEST_SCHEMA_UNSUPPORTED', 'Unsupported dataset ingest schema version')
  }
}

function assertCheckpointScope(checkpoint: DatasetCheckpoint, scope: DatasetDestinationScope): void {
  if (checkpoint.contract !== DATASET_INGEST_CONTRACT) throw new DatasetIngestError('INGEST_CONTRACT_UNSUPPORTED', 'Unsupported checkpoint contract')
  if (!checkpoint.schemaVersion.startsWith('1.')) throw new DatasetIngestError('CHECKPOINT_VERSION_UNSUPPORTED', `Unsupported checkpoint schema ${checkpoint.schemaVersion}`)
  if (datasetDestinationScopeKey(checkpoint.scope) !== datasetDestinationScopeKey(scope)) {
    throw new DatasetIngestError('CHECKPOINT_SCOPE_MISMATCH', 'Checkpoint belongs to another destination scope')
  }
}

export class DatasetIngestExecutor {
  private readonly attempts = new Map<string, DatasetRunAttempt>()
  private readonly successes = new Map<string, DatasetRunReceipt>()

  constructor(private readonly store: DatasetIngestStore) {}

  preview(plan: DatasetProcessingPlan, batch: DatasetMutationBatch): { idempotencyKey: string; upserts: number; tombstones: number } {
    assertContract(plan, batch)
    return {
      idempotencyKey: deriveDatasetIngestIdempotencyKey(plan, batch),
      upserts: batch.mutations.filter(item => item.operation === 'upsert').length,
      tombstones: batch.mutations.filter(item => item.operation === 'tombstone').length,
    }
  }

  connectionCheck(plan: DatasetProcessingPlan, batch: DatasetMutationBatch): { idempotencyKey: string; scopeKey: string; compatible: true } {
    assertContract(plan, batch)
    assertCheckpointScope(batch.checkpointAfter, plan.destination)
    if (batch.checkpointBefore) assertCheckpointScope(batch.checkpointBefore, plan.destination)
    return {
      idempotencyKey: deriveDatasetIngestIdempotencyKey(plan, batch),
      scopeKey: datasetDestinationScopeKey(plan.destination),
      compatible: true,
    }
  }

  async executeBatch(plan: DatasetProcessingPlan, batch: DatasetMutationBatch, options: ExecuteDatasetBatchOptions = {}): Promise<DatasetRunReceipt> {
    assertContract(plan, batch)
    const scopeKey = datasetDestinationScopeKey(plan.destination)
    const idempotencyKey = deriveDatasetIngestIdempotencyKey(plan, batch)
    const requestDigest = digest({ plan, batch })
    const runId = generateId()
    this.attempts.set(scopeKey, { runId, state: 'running', verification: 'pending', idempotencyKey })

    const cancel = () => {
      if (options.signal?.aborted) throw new DatasetIngestError('INGEST_CANCELLED', 'Dataset ingest was cancelled before commit')
    }
    try {
      cancel()
      const receipt = await this.store.transact(scopeKey, async transaction => {
        const prior = transaction.getReceipt(idempotencyKey)
        if (prior) {
          if (prior.requestDigest !== requestDigest) throw new DatasetIngestError('IDEMPOTENCY_CONFLICT', 'Idempotency key was previously used with different canonical content')
          return prior
        }
        const currentCheckpoint = transaction.getCheckpoint()
        if (batch.checkpointBefore) {
          assertCheckpointScope(batch.checkpointBefore, plan.destination)
          if (!currentCheckpoint || canonicalJson(currentCheckpoint) !== canonicalJson(batch.checkpointBefore)) {
            throw new DatasetIngestError('CHECKPOINT_MISMATCH', 'checkpointBefore does not match committed state')
          }
        } else if (currentCheckpoint) {
          throw new DatasetIngestError('CHECKPOINT_MISMATCH', 'A committed checkpoint exists but checkpointBefore was omitted')
        }
        assertCheckpointScope(batch.checkpointAfter, plan.destination)
        if (batch.checkpointAfter.sequence !== batch.sequence) throw new DatasetIngestError('BATCH_OUT_OF_ORDER', 'Checkpoint sequence must equal batch sequence')
        if (currentCheckpoint && batch.checkpointAfter.sequence <= currentCheckpoint.sequence) throw new DatasetIngestError('CHECKPOINT_REGRESSION', 'Checkpoint sequence must advance')
        const expectedSequence = (currentCheckpoint?.sequence ?? 0) + 1
        if (batch.sequence !== expectedSequence) throw new DatasetIngestError('BATCH_OUT_OF_ORDER', `Expected batch sequence ${expectedSequence}, received ${batch.sequence}`)

        const tombstones = batch.mutations.filter(item => item.operation === 'tombstone').length
        if (tombstones > 0) {
          if (!plan.reconciliation.enabled) throw new DatasetIngestError('RECONCILIATION_NOT_ENABLED', 'Tombstones require reconciliation policy')
          if (!batch.enumeration?.complete) throw new DatasetIngestError('RECONCILIATION_INCOMPLETE', 'Tombstones require complete source enumeration')
          if (tombstones > plan.reconciliation.maxTombstones && !batch.enumeration.approvalId) {
            throw new DatasetIngestError('RECONCILIATION_APPROVAL_REQUIRED', `Tombstone count ${tombstones} exceeds approved threshold`)
          }
        }

        const rejections: DatasetRecordRejection[] = []
        const accepted: DatasetMutation[] = []
        for (const mutation of batch.mutations) {
          cancel()
          const failure = options.validateRecord?.(mutation)
          if (!failure) {
            accepted.push(mutation)
            continue
          }
          const rejection = {
            logicalIdDigest: digest(mutation.logicalId),
            ...(mutation.locator ? { locator: mutation.locator } : {}),
            code: failure.code,
            message: 'Record rejected by validation policy',
          }
          if (plan.rejectionPolicy.mode === 'fail-fast') throw new DatasetIngestError('RECORD_REJECTED', `${failure.code}: record rejected`)
          rejections.push(rejection)
          if (rejections.length > plan.rejectionPolicy.maxRejectedRecords) throw new DatasetIngestError('REJECTION_LIMIT_EXCEEDED', 'Rejected-record limit exceeded')
        }
        cancel()
        for (const mutation of accepted) {
          transaction.setRecord(mutation.operation === 'upsert'
            ? { logicalId: mutation.logicalId, revision: mutation.revision, digest: mutation.digest, value: clone(mutation.value), tombstoned: false }
            : { logicalId: mutation.logicalId, revision: mutation.revision, digest: mutation.digest, tombstoned: true })
        }
        const effects = accepted.map(({ operation, logicalId, revision, digest: itemDigest }) => ({ operation, logicalId, revision, digest: itemDigest }))
        const receipt: DatasetRunReceipt = {
          contract: DATASET_INGEST_CONTRACT,
          schemaVersion: DATASET_INGEST_SCHEMA_VERSION,
          runId,
          idempotencyKey,
          requestDigest,
          planId: plan.planId,
          planDigest: plan.planDigest,
          sourceRevision: plan.sourceRevision,
          destination: clone(plan.destination),
          mode: plan.mode,
          state: rejections.length ? 'degraded' : 'committed',
          effects,
          acceptedRecords: accepted.length,
          rejectedRecords: rejections.length,
          rejections,
          outputDigest: digest(effects),
          ...(batch.checkpointBefore ? { checkpointBefore: clone(batch.checkpointBefore) } : {}),
          checkpointAfter: clone(batch.checkpointAfter),
          verification: 'verified',
        }
        await options.hooks?.beforeCommit?.()
        cancel()
        transaction.setReceipt(receipt)
        transaction.setCheckpoint(batch.checkpointAfter)
        return receipt
      })
      this.successes.set(scopeKey, clone(receipt))
      this.attempts.set(scopeKey, { runId: receipt.runId, state: receipt.state, verification: 'verified', idempotencyKey })
      await options.hooks?.afterCommit?.(clone(receipt))
      return receipt
    } catch (error) {
      const code = error instanceof DatasetIngestError ? error.code : undefined
      this.attempts.set(scopeKey, { runId, state: code === 'INGEST_CANCELLED' ? 'cancelled' : 'failed', verification: 'failed', idempotencyKey, ...(code ? { errorCode: code } : {}) })
      throw error
    }
  }

  async resolveAmbiguousCommit(plan: DatasetProcessingPlan, batch: DatasetMutationBatch): Promise<DatasetRunReceipt | undefined> {
    return this.store.getReceipt(datasetDestinationScopeKey(plan.destination), deriveDatasetIngestIdempotencyKey(plan, batch))
  }

  status(scope: DatasetDestinationScope, expectedSourceRevision?: string): DatasetRunStatus {
    const key = datasetDestinationScopeKey(scope)
    const lastSuccessful = this.successes.get(key)
    return {
      scope: clone(scope),
      ...(this.attempts.get(key) ? { lastAttempt: clone(this.attempts.get(key)!) } : {}),
      ...(lastSuccessful ? { lastSuccessful: clone(lastSuccessful) } : {}),
      freshness: lastSuccessful
        ? expectedSourceRevision && expectedSourceRevision !== lastSuccessful.sourceRevision ? 'stale' : 'current'
        : 'never',
    }
  }
}
