import { describe, expect, it, vi } from 'vitest'
import {
  DATASET_EXECUTION_CONTRACT,
  DATASET_INGEST_CONTRACT,
  DATASET_LINEAGE_CONTRACT,
} from '@fortemi/core'
import { DatasetWorkflowError } from '../types.js'
import type { DatasetCheckResult, DatasetFreshnessStatus, DatasetPreview, DatasetWorkflowApi, DatasetPlan, DatasetRunProgress } from '../types.js'
import { DatasetWorkflowMachine, sanitizeDatasetConfiguration, validateDatasetConfiguration, visibleDatasetConfigFields } from '../machine.js'
import { datasetConnectorFixtureSchema } from '../fixtures.js'

const plan: DatasetPlan = {
  id: 'plan-42', digest: 'sha256:plan', sourceRevision: 'rev-1', sourceDigest: 'sha256:source', configurationDigest: 'sha256:config', capabilities: ['ingest.incremental'], transforms: ['normalize'], locality: 'browser', outboundHosts: ['example.test'], privacy: 'restricted', rights: 'approved', retention: '30d', estimatedWrites: 10, estimatedCost: '$0.01', fallbackBehavior: 'fail closed', reconciliation: { destructive: true, estimatedDeletes: 5, confirmationThreshold: 1 },
}

const running: DatasetRunProgress = { runId: 'run-42', lifecycle: 'running', stage: 'ingest', observed: 2, accepted: 2, rejected: 0, retryClass: 'immediate', verification: 'pending', diagnostics: [] }

function api(overrides: Partial<DatasetWorkflowApi> = {}): DatasetWorkflowApi {
  return {
    check: vi.fn(async (): Promise<DatasetCheckResult[]> => ['configuration', 'authorization', 'reachability', 'discovery', 'capability', 'policy'].map(stage => ({ stage: stage as DatasetCheckResult['stage'], status: 'passed', diagnostics: [] }))),
    preview: vi.fn(async (_configuration, limit): Promise<DatasetPreview> => ({ bounded: true, sideEffectFree: true, limit, datasets: [], estimate: { records: 2 }, unsupportedCapabilities: [] })),
    createPlan: vi.fn(async () => plan),
    verifyPlanDigest: vi.fn(async () => true),
    approvePlan: vi.fn(async () => running),
    cancelRun: vi.fn(async (runId): Promise<DatasetRunProgress> => ({ ...running, runId, lifecycle: 'cancelled' })),
    retryRun: vi.fn(async runId => ({ ...running, runId })),
    getStatus: vi.fn(async (): Promise<DatasetFreshnessStatus> => ({
      scope: { tenant: 't', dataset: 'd', sourceBinding: 's', stream: 'x' }, freshness: 'current', availability: 'online', artifactState: 'canonical',
      capabilityDescriptor: { contract: DATASET_EXECUTION_CONTRACT, schemaVersion: '1.0.0', runtime: { id: 'fixture', version: '1.0.0', plane: 'browser-local-archive', dataClass: 'canonical', maturity: 'experimental' }, guarantees: { transaction: 'none', isolation: 'none', durability: 'memory', availability: 'local-process', ordering: 'stable-identity' }, capabilities: [], evidence: [] },
    })),
    getRejections: vi.fn(async () => [{ locator: 'row:2', logicalIdDigest: 'sha256:id', code: 'INVALID', reason: 'Schema validation failed' }]),
    traverseLineage: vi.fn(async () => ({ contract: DATASET_LINEAGE_CONTRACT, schemaVersion: '1.0.0', snapshot: 1, nodes: [], edges: [], truncated: false })),
    ...overrides,
  }
}

function configured(machine: DatasetWorkflowMachine): void {
  machine.setField('endpoint', 'https://example.test')
}

describe('DatasetWorkflowMachine', () => {
  it('applies defaults, conditionals, and constraints', () => {
    expect(visibleDatasetConfigFields(datasetConnectorFixtureSchema, { mode: 'local' })).not.toContain('credentialReference')
    expect(visibleDatasetConfigFields(datasetConnectorFixtureSchema, { mode: 'remote' })).toContain('credentialReference')
    expect(validateDatasetConfiguration(datasetConnectorFixtureSchema, { mode: 'remote', endpoint: 'bad' })).toMatchObject({ credentialReference: expect.any(String), endpoint: expect.any(String) })
  })

  it('redacts write-only values in serializable configuration views', () => {
    const safe = sanitizeDatasetConfiguration(datasetConnectorFixtureSchema, { mode: 'remote', endpoint: 'https://example.test', credentialReference: 'synthetic-secret-ref' })
    expect(JSON.stringify(safe)).not.toContain('synthetic-secret-ref')
    expect(safe.credentialReference).toBe('[write-only reference]')
  })

  it('checks all stable stages and requests a bounded side-effect-free preview', async () => {
    const fake = api(); const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine)
    await machine.check(); await machine.preview(100_000)
    expect(machine.getSnapshot().checkResults?.map(item => item.stage)).toEqual(['configuration', 'authorization', 'reachability', 'discovery', 'capability', 'policy'])
    expect(fake.preview).toHaveBeenCalledWith(expect.anything(), 1000, expect.any(AbortSignal))
    expect(machine.getSnapshot().preview).toMatchObject({ bounded: true, sideEffectFree: true })
  })

  it('rejects a preview adapter that violates the side-effect-free contract', async () => {
    const fake = api({ preview: vi.fn(async (): Promise<DatasetPreview> => ({ bounded: true, sideEffectFree: false as true, limit: 10, datasets: [], estimate: {}, unsupportedCapabilities: [] })) })
    const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine); await machine.preview()
    expect(machine.getSnapshot()).toMatchObject({ phase: 'failed', diagnostic: { code: 'DATASET_WORKFLOW_FAILED' } })
  })

  it('freezes the plan and verifies its digest immediately before approval', async () => {
    const fake = api(); const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine)
    await machine.preview(); await machine.buildPlan()
    expect(Object.isFrozen(machine.getSnapshot().plan)).toBe(true)
    await machine.approve('wrong')
    expect(fake.verifyPlanDigest).not.toHaveBeenCalled()
    expect(machine.getSnapshot().diagnostic?.code).toBe('DESTRUCTIVE_CONFIRMATION_REQUIRED')
    await machine.approve(plan.id)
    expect(fake.verifyPlanDigest).toHaveBeenCalledBefore(fake.approvePlan as ReturnType<typeof vi.fn>)
    expect(machine.getSnapshot().phase).toBe('running')
  })

  it('fails closed when the immutable plan digest cannot be verified', async () => {
    const fake = api({ verifyPlanDigest: vi.fn(async () => false) }); const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine)
    await machine.preview(); await machine.buildPlan(); await machine.approve(plan.id)
    expect(fake.approvePlan).not.toHaveBeenCalled()
    expect(machine.getSnapshot()).toMatchObject({ phase: 'failed', diagnostic: { code: 'DATASET_WORKFLOW_FAILED' } })
  })

  it('cancels, retries, and keeps last attempt separate from status success', async () => {
    const fake = api(); const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine)
    await machine.preview(); await machine.buildPlan(); await machine.approve(plan.id); await machine.cancel(); await machine.retry(); await machine.refreshStatus()
    expect(fake.cancelRun).toHaveBeenCalledWith('run-42', expect.any(AbortSignal))
    expect(fake.retryRun).toHaveBeenCalledWith('run-42', expect.any(AbortSignal))
    expect(machine.getSnapshot().status?.lastSuccessful).toBeUndefined()
  })

  it('aborts obsolete network operations without surfacing a failure', async () => {
    let firstSignal: AbortSignal | undefined
    const fake = api({ check: vi.fn(async (_config, signal) => { firstSignal = signal; await new Promise(() => undefined); return [] }) })
    const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake); configured(machine)
    void machine.check(); await machine.preview()
    expect(firstSignal?.aborted).toBe(true)
    expect(machine.getSnapshot().phase).toBe('previewed')
  })

  it('never sends a credential reference into the serialized plan input', async () => {
    const fake = api(); const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, fake)
    machine.setField('mode', 'remote'); machine.setField('endpoint', 'https://example.test'); machine.setField('credentialReference', 'synthetic-secret-ref')
    await machine.preview(); await machine.buildPlan()
    expect(JSON.stringify(machine.getSnapshot())).not.toContain('synthetic-secret-ref')
    expect((fake.preview as ReturnType<typeof vi.fn>).mock.calls[0]![0].credentialReference).toBe('synthetic-secret-ref')
    const planInput = (fake.createPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(JSON.stringify(planInput)).not.toContain('synthetic-secret-ref')
    expect(planInput.credentialReference).toBe('[write-only reference]')
  })

  it('renders only stable diagnostics and redacts arbitrary thrown messages', async () => {
    const secret = 'synthetic-record-value'
    const machine = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, api({ check: vi.fn(async () => { throw new Error(secret) }) })); configured(machine); await machine.check()
    expect(JSON.stringify(machine.getSnapshot())).not.toContain(secret)
    const known = new DatasetWorkflowMachine(datasetConnectorFixtureSchema, api({ check: vi.fn(async () => { throw new DatasetWorkflowError({ code: 'AUTH_DENIED', severity: 'error', summary: 'Authorization was denied', remediation: 'Choose another saved reference', retryClass: 'after-change' }) }) })); configured(known); await known.check()
    expect(known.getSnapshot().diagnostic?.code).toBe('AUTH_DENIED')
  })

  it('uses only the public generic core dataset contracts', () => {
    expect([DATASET_EXECUTION_CONTRACT, DATASET_INGEST_CONTRACT, DATASET_LINEAGE_CONTRACT]).toEqual([
      'fortemi.dataset-execution-capabilities/v1', 'fortemi.dataset-ingest/v1', 'fortemi.dataset-lineage/v1',
    ])
  })
})
