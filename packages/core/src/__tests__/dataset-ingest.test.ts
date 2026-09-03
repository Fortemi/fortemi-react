import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  DATASET_INGEST_CONTRACT,
  DATASET_INGEST_SCHEMA_VERSION,
  DatasetIngestExecutor,
  MemoryDatasetIngestStore,
  datasetDestinationScopeKey,
  type DatasetCheckpoint,
  type DatasetMutationBatch,
  type DatasetProcessingPlan,
} from '../dataset-ingest.js'

const hash = (value: string) => `sha256:${value.padEnd(64, '0')}`
const scope = { tenant: 'tenant-a', dataset: 'customers', sourceBinding: 'crm', stream: 'users' }
const checkpoint = (sequence: number): DatasetCheckpoint => ({
  contract: DATASET_INGEST_CONTRACT,
  schemaVersion: DATASET_INGEST_SCHEMA_VERSION,
  scope,
  opaque: `cursor-${sequence}`,
  sequence,
})
const plan = (overrides: Partial<DatasetProcessingPlan> = {}): DatasetProcessingPlan => ({
  contract: DATASET_INGEST_CONTRACT,
  schemaVersion: DATASET_INGEST_SCHEMA_VERSION,
  planId: 'plan-1',
  planDigest: hash('a'),
  sourceRevision: 'source-rev-1',
  configurationDigest: hash('b'),
  transformationDigest: hash('c'),
  destination: scope,
  mode: 'incremental',
  rejectionPolicy: { mode: 'fail-fast', maxRejectedRecords: 0 },
  reconciliation: { enabled: false, maxTombstones: 0 },
  ...overrides,
})
const batch = (sequence: number, count = 1): DatasetMutationBatch => ({
  contract: DATASET_INGEST_CONTRACT,
  schemaVersion: DATASET_INGEST_SCHEMA_VERSION,
  sequence,
  mutations: Array.from({ length: count }, (_, index) => ({
    operation: 'upsert' as const,
    logicalId: `record-${sequence}-${index}`,
    revision: `revision-${sequence}`,
    digest: hash(`${sequence}${index}`),
    value: { secret: `value-${index}` },
  })),
  ...(sequence > 1 ? { checkpointBefore: checkpoint(sequence - 1) } : {}),
  checkpointAfter: checkpoint(sequence),
})

describe('dataset ingest contract', () => {
  it('meta-validates and validates plan, batch, checkpoint, and receipt', async () => {
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schemas/dataset-ingest/v1.schema.json'), 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    expect(ajv.validateSchema(schema)).toBe(true)
    const validate = ajv.compile(schema)
    const executor = new DatasetIngestExecutor(new MemoryDatasetIngestStore())
    const inputPlan = plan()
    const inputBatch = batch(1)
    const receipt = await executor.executeBatch(inputPlan, inputBatch)
    for (const value of [inputPlan, inputBatch, inputBatch.checkpointAfter, receipt]) {
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true)
    }
  })

  it.each([
    ['empty', 0], ['single', 1], ['multi-record', 3],
  ])('commits %s batches atomically with verified receipts', async (_name, count) => {
    const store = new MemoryDatasetIngestStore()
    const receipt = await new DatasetIngestExecutor(store).executeBatch(plan(), batch(1, count))
    expect(receipt).toMatchObject({ acceptedRecords: count, rejectedRecords: 0, verification: 'verified', state: 'committed' })
    expect((await store.getRecords(datasetDestinationScopeKey(scope))).length).toBe(count)
    expect(await store.getCheckpoint(datasetDestinationScopeKey(scope))).toEqual(checkpoint(1))
  })

  it.each(['full', 'snapshot', 'incremental'] as const)('records %s execution mode', async mode => {
    const receipt = await new DatasetIngestExecutor(new MemoryDatasetIngestStore()).executeBatch(plan({ mode }), batch(1))
    expect(receipt).toMatchObject({ mode, sourceRevision: 'source-rev-1', verification: 'verified' })
  })

  it('supports ordered multi-batch, partition-scoped incremental execution', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    await executor.executeBatch(plan(), batch(1, 2))
    const second = await executor.executeBatch(plan(), batch(2, 2))
    expect(second.checkpointBefore).toEqual(checkpoint(1))
    expect(second.checkpointAfter).toEqual(checkpoint(2))
    expect((await store.getRecords(datasetDestinationScopeKey(scope))).length).toBe(4)
  })

  it('returns the exact receipt on replay and serializes concurrent duplicate delivery', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    const input = batch(1)
    const [first, duplicate] = await Promise.all([
      executor.executeBatch(plan(), input),
      executor.executeBatch(plan(), input),
    ])
    expect(duplicate).toEqual(first)
    expect(await executor.executeBatch(plan(), input)).toEqual(first)
    expect((await store.getRecords(datasetDestinationScopeKey(scope))).length).toBe(1)
  })

  it('allows concurrent writes to disjoint destination scopes', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    const otherScope = { ...scope, partition: 'other' }
    const otherPlan = plan({ destination: otherScope })
    const otherBatch = {
      ...batch(1),
      checkpointAfter: { ...checkpoint(1), scope: otherScope },
    }
    const [first, second] = await Promise.all([
      executor.executeBatch(plan(), batch(1)),
      executor.executeBatch(otherPlan, otherBatch),
    ])
    expect(first.destination).toEqual(scope)
    expect(second.destination).toEqual(otherScope)
  })

  it('rejects conflicting caller idempotency reuse and out-of-order checkpoints', async () => {
    const executor = new DatasetIngestExecutor(new MemoryDatasetIngestStore())
    const first = { ...batch(1), idempotencyKey: 'caller-key' }
    await executor.executeBatch(plan(), first)
    const conflicting = { ...batch(1), idempotencyKey: 'caller-key', mutations: [{ ...first.mutations[0]!, digest: hash('different') }] }
    await expect(executor.executeBatch(plan(), conflicting)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(executor.executeBatch(plan(), { ...batch(3), checkpointBefore: checkpoint(1) })).rejects.toMatchObject({ code: 'BATCH_OUT_OF_ORDER' })
    await expect(new DatasetIngestExecutor(new MemoryDatasetIngestStore()).executeBatch(plan(), {
      ...batch(1),
      checkpointAfter: { ...checkpoint(1), schemaVersion: '2.0.0' },
    })).rejects.toMatchObject({ code: 'CHECKPOINT_VERSION_UNSUPPORTED' })
  })

  it('rolls back crash-before-commit and resolves crash-after-commit ambiguity by receipt', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    const input = batch(1)
    await expect(executor.executeBatch(plan(), input, { hooks: { beforeCommit: () => { throw new Error('crash before') } } })).rejects.toThrow('crash before')
    expect(await store.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    expect(await executor.resolveAmbiguousCommit(plan(), input)).toBeUndefined()

    await expect(executor.executeBatch(plan(), input, { hooks: { afterCommit: () => { throw new Error('response lost') } } })).rejects.toThrow('response lost')
    const resolved = await executor.resolveAmbiguousCommit(plan(), input)
    expect(resolved).toMatchObject({ verification: 'verified', acceptedRecords: 1 })
    expect(executor.status(scope)).toMatchObject({
      lastAttempt: { state: 'failed' },
      lastSuccessful: { runId: resolved!.runId },
      freshness: 'current',
    })
  })

  it('cancels without partial effects and resumes from the verified checkpoint', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    await executor.executeBatch(plan(), batch(1))
    const controller = new AbortController()
    controller.abort()
    await expect(executor.executeBatch(plan(), batch(2), { signal: controller.signal })).rejects.toMatchObject({ code: 'INGEST_CANCELLED' })
    expect(await store.getCheckpoint(datasetDestinationScopeKey(scope))).toEqual(checkpoint(1))
    expect(executor.status(scope).lastAttempt).toMatchObject({ state: 'cancelled', verification: 'failed' })
    expect((await executor.executeBatch(plan(), batch(2))).checkpointBefore).toEqual(checkpoint(1))
  })

  it('rolls back bounded cancellation during batch preparation', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    const controller = new AbortController()
    await expect(executor.executeBatch(plan(), batch(1, 3), {
      signal: controller.signal,
      validateRecord: mutation => {
        if (mutation.logicalId.endsWith('-0')) controller.abort()
        return undefined
      },
    })).rejects.toMatchObject({ code: 'INGEST_CANCELLED' })
    expect(await store.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    expect(await store.getCheckpoint(datasetDestinationScopeKey(scope))).toBeUndefined()
  })

  it('supports bounded rejection without leaking record values', async () => {
    const executor = new DatasetIngestExecutor(new MemoryDatasetIngestStore())
    const boundedPlan = plan({ rejectionPolicy: { mode: 'bounded-reject', maxRejectedRecords: 1 } })
    const receipt = await executor.executeBatch(boundedPlan, batch(1, 2), {
      validateRecord: mutation => mutation.logicalId.endsWith('-0') ? { code: 'INVALID_EMAIL', message: `email failed validation: ${JSON.stringify(mutation)}` } : undefined,
    })
    expect(receipt).toMatchObject({ state: 'degraded', acceptedRecords: 1, rejectedRecords: 1 })
    expect(JSON.stringify(receipt.rejections)).not.toContain('value-0')
    expect(executor.status(scope).lastAttempt).toMatchObject({ state: 'degraded', verification: 'verified' })
    await expect(new DatasetIngestExecutor(new MemoryDatasetIngestStore()).executeBatch(
      plan({ rejectionPolicy: { mode: 'bounded-reject', maxRejectedRecords: 0 } }), batch(1),
      { validateRecord: () => ({ code: 'INVALID', message: 'invalid' }) },
    )).rejects.toMatchObject({ code: 'REJECTION_LIMIT_EXCEEDED' })
  })

  it('supports DLQ accounting and fail-fast rollback without raw values', async () => {
    const store = new MemoryDatasetIngestStore()
    const dlqReceipt = await new DatasetIngestExecutor(store).executeBatch(
      plan({ rejectionPolicy: { mode: 'dlq', maxRejectedRecords: 1 } }),
      batch(1),
      { validateRecord: mutation => ({ code: 'DLQ_REQUIRED', message: JSON.stringify(mutation) }) },
    )
    expect(dlqReceipt).toMatchObject({ state: 'degraded', acceptedRecords: 0, rejectedRecords: 1 })
    expect(JSON.stringify(dlqReceipt)).not.toContain('value-0')

    const failFastStore = new MemoryDatasetIngestStore()
    await expect(new DatasetIngestExecutor(failFastStore).executeBatch(
      plan(), batch(1), { validateRecord: () => ({ code: 'INVALID', message: 'rejected' }) },
    )).rejects.toMatchObject({ code: 'RECORD_REJECTED' })
    expect(await failFastStore.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    expect(await failFastStore.getCheckpoint(datasetDestinationScopeKey(scope))).toBeUndefined()
  })

  it('survives retry exhaustion before commit and later commits exactly once', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    const input = batch(1)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(executor.executeBatch(plan(), input, {
        hooks: { beforeCommit: () => { throw new Error('transient backend failure') } },
      })).rejects.toThrow('transient backend failure')
    }
    expect(await store.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    const receipt = await executor.executeBatch(plan(), input)
    expect(receipt.acceptedRecords).toBe(1)
    expect((await store.getRecords(datasetDestinationScopeKey(scope))).length).toBe(1)
  })

  it('requires complete enumeration and approval for excessive tombstones, then permits restoration', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    await executor.executeBatch(plan(), batch(1))
    const deletion = {
      ...batch(2, 0),
      mutations: [{ operation: 'tombstone' as const, logicalId: 'record-1-0', revision: 'revision-2', digest: hash('deleted') }],
    }
    await expect(executor.executeBatch(plan(), deletion)).rejects.toMatchObject({ code: 'RECONCILIATION_NOT_ENABLED' })
    const reconcilePlan = plan({ reconciliation: { enabled: true, maxTombstones: 0 } })
    await expect(executor.executeBatch(reconcilePlan, deletion)).rejects.toMatchObject({ code: 'RECONCILIATION_INCOMPLETE' })
    await expect(executor.executeBatch(reconcilePlan, { ...deletion, enumeration: { complete: true } })).rejects.toMatchObject({ code: 'RECONCILIATION_APPROVAL_REQUIRED' })
    await executor.executeBatch(reconcilePlan, { ...deletion, enumeration: { complete: true, approvalId: 'approval-1' } })
    expect((await store.getRecords(datasetDestinationScopeKey(scope)))[0]?.tombstoned).toBe(true)
    const restore = { ...batch(3, 0), mutations: [{ operation: 'upsert' as const, logicalId: 'record-1-0', revision: 'revision-3', digest: hash('restored'), value: { restored: true } }] }
    await executor.executeBatch(reconcilePlan, restore)
    expect((await store.getRecords(datasetDestinationScopeKey(scope)))[0]).toMatchObject({ tombstoned: false, revision: 'revision-3' })
  })

  it('keeps preview side-effect free', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    expect(executor.preview(plan(), batch(1))).toMatchObject({ upserts: 1, tombstones: 0 })
    expect(await store.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    expect(await store.getCheckpoint(datasetDestinationScopeKey(scope))).toBeUndefined()
  })

  it('keeps connection checks side-effect free and reports freshness by source revision', async () => {
    const store = new MemoryDatasetIngestStore()
    const executor = new DatasetIngestExecutor(store)
    expect(executor.connectionCheck(plan(), batch(1))).toMatchObject({ compatible: true })
    expect(await store.getRecords(datasetDestinationScopeKey(scope))).toEqual([])
    expect(await store.getCheckpoint(datasetDestinationScopeKey(scope))).toBeUndefined()
    await executor.executeBatch(plan(), batch(1))
    expect(executor.status(scope, 'source-rev-1').freshness).toBe('current')
    expect(executor.status(scope, 'source-rev-2').freshness).toBe('stale')
  })
})
