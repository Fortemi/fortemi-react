import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  DATASET_EXECUTION_CONTRACT,
  type DatasetExecutionCapabilityDescriptor,
} from '../dataset-execution-capabilities.js'
import {
  DATASET_MATERIALIZATION_CONTRACT,
  DATASET_MATERIALIZATION_SCHEMA_VERSION,
  compareDatasetIncrementalParity,
  digestDatasetMaterializationValue,
  executeDatasetMaterialization,
  executeDatasetRetrieval,
  negotiateDatasetMaterializationProfile,
  validateDatasetBenchmarkEvidence,
  type DatasetBenchmarkEvidence,
  type DatasetMaterializationAdapter,
  type DatasetMaterializationArtifact,
  type DatasetMaterializationProfile,
  type DatasetMaterializationRequest,
  type DatasetSourceSnapshot,
} from '../dataset-materialization-profiles.js'

const fixtureDir = resolve(import.meta.dirname, '../../schemas/dataset-materialization/fixtures')
const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schemas/dataset-materialization/v1.schema.json'), 'utf8'))
const fixture = (name: string) => JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as DatasetMaterializationProfile
const digest = (character: string) => `sha256:${character.repeat(64)}` as const

function runtime(capabilities: string[]): DatasetExecutionCapabilityDescriptor {
  return {
    contract: DATASET_EXECUTION_CONTRACT,
    schemaVersion: '1.0.0',
    runtime: { id: 'test-runtime', version: '1.0.0', plane: 'server-process', dataClass: 'regenerable-index', maturity: 'beta' },
    guarantees: { transaction: 'none', isolation: 'snapshot', durability: 'process', availability: 'single-host', ordering: 'stable-identity' },
    capabilities: capabilities.map(id => ({ id, version: '1.0.0', status: 'supported', evidence: ['test'] })) as DatasetExecutionCapabilityDescriptor['capabilities'],
    evidence: [{ id: 'test', kind: 'fixture', uri: 'fortemi://fixture/materialization' }],
  }
}

const snapshot: DatasetSourceSnapshot = {
  datasetId: 'dataset-a', revision: 'revision-2', schemaId: 'schema-a', schemaVersion: '2.0.0',
  schemaDigest: digest('a'), sourceDigests: [digest('b')],
  records: [
    { logicalId: 'allowed', revision: '2', digest: digest('c'), content: { text: 'public value' } },
    { logicalId: 'denied', revision: '2', digest: digest('d'), content: { text: 'TOP-SECRET-DENIED' } },
  ],
}

function request(profile = fixture('supported.json'), mode: 'full' | 'incremental' = 'full'): DatasetMaterializationRequest {
  return {
    runId: 'run-1', processingRunId: 'ingest-run-9', snapshot: structuredClone(snapshot), profile,
    configuration: { language: 'en' }, operation: 'build', mode,
    ...(mode === 'incremental' ? { affected: { sourceRevisions: ['revision-2'], recordDigests: [digest('c')], chunkDigests: [digest('e')] } } : {}),
  }
}

const artifacts: DatasetMaterializationArtifact[] = [
  { kind: 'lexical-entry', logicalId: 'z', sourceRecordDigests: [digest('c')], digest: digest('f'), score: 0.5 },
  { kind: 'lexical-entry', logicalId: 'a', sourceRecordDigests: [digest('c')], digest: digest('1'), score: 0.5 },
]

function adapter(seen?: string[]): DatasetMaterializationAdapter {
  return {
    backend: { id: 'test-adapter', version: '1.2.3' },
    async materialize(input) {
      const serialized = JSON.stringify(input)
      for (const boundary of ['chunk', 'model', 'index', 'telemetry', 'diagnostic']) seen?.push(`${boundary}:${serialized}`)
      input.snapshot.records.splice(0, 1)
      return { artifacts, resources: { elapsedMs: 12, inputBytes: 999, peakMemoryBytes: 2048, modelInvocations: 0, persistedBytes: 128 } }
    },
    async retrieve() { return artifacts },
  }
}

describe('dataset materialization profiles', () => {
  it('meta-validates the contract and all eight scenario fixtures', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true)
    const validate = ajv.compile(schema)
    const names = readdirSync(fixtureDir).filter(name => name.endsWith('.json')).sort()
    expect(names).toEqual(['browser.json', 'degraded.json', 'deterministic.json', 'external-adapter.json', 'nondeterministic.json', 'server.json', 'supported.json', 'unsupported.json'])
    for (const name of names) expect(validate(fixture(name)), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true)
  })

  it('negotiates before execution, fails closed, and makes fallback degradation explicit', () => {
    const supported = negotiateDatasetMaterializationProfile({ operation: 'build', profile: fixture('supported.json'), runtime: runtime(['index.lexical']) })
    expect(supported).toMatchObject({ accepted: true, selectedProfile: 'fortemi.lexical.default', degraded: false })

    const unsupported = negotiateDatasetMaterializationProfile({ operation: 'build', profile: fixture('unsupported.json'), runtime: runtime(['index.vector']) })
    expect(unsupported.accepted).toBe(false)
    expect(unsupported.diagnostics.map(item => item.code)).toContain('PROFILE_UNSUPPORTED')

    const fallback = negotiateDatasetMaterializationProfile({
      operation: 'query', profile: fixture('degraded.json'), runtime: runtime(['index.lexical']), fallbackProfiles: [fixture('supported.json')],
    })
    expect(fallback).toMatchObject({ accepted: true, requestedProfile: 'fortemi.hybrid.preferred', selectedProfile: 'fortemi.lexical.default', degraded: true })
    expect(fallback.diagnostics).toContainEqual(expect.objectContaining({ code: 'REQUIRED_CAPABILITY_MISSING' }))
  })

  it('authorizes before every adapter-visible boundary and never exposes denied content', async () => {
    const seen: string[] = []
    const canonical = request()
    const before = structuredClone(canonical.snapshot)
    const result = await executeDatasetMaterialization(canonical, runtime(['index.lexical']), adapter(seen), record => record.logicalId !== 'denied', { now: () => '2026-09-03T00:00:00Z' })
    expect(seen).toHaveLength(5)
    expect(seen.join('\n')).not.toContain('TOP-SECRET-DENIED')
    expect(seen.join('\n')).not.toContain(digest('d'))
    expect(canonical.snapshot).toEqual(before)
    expect(result.receipt.privacy).toMatchObject({ allowedRecordDigests: [digest('c')], deniedRecordDigests: [digest('d')] })
    expect(result.receipt.output.counts).toEqual({ 'lexical-entry': 2 })
    expect(result.receipt.processingRunId).toBe('ingest-run-9')
    expect(result.artifacts.map(item => item.logicalId)).toEqual(['a', 'z'])
  })

  it('emits schema-valid lineage, configuration, implementation, privacy, output, and resource receipts', async () => {
    const result = await executeDatasetMaterialization(request(), runtime(['index.lexical']), adapter(), () => true, { now: () => '2026-09-03T00:00:00Z' })
    const validate = new Ajv2020({ strict: true }).compile(schema)
    expect(validate(result.receipt), JSON.stringify(validate.errors)).toBe(true)
    expect(result.receipt).toMatchObject({
      contract: DATASET_MATERIALIZATION_CONTRACT, schemaVersion: DATASET_MATERIALIZATION_SCHEMA_VERSION,
      source: { datasetId: 'dataset-a', revision: 'revision-2', digests: [digest('b')] },
      schema: { id: 'schema-a', version: '2.0.0', digest: digest('a') },
      profile: { id: 'fortemi.lexical.default', version: '1.0.0', configurationDigest: expect.stringMatching(/^sha256:/) },
      resources: { elapsedMs: 12, modelInvocations: 0, persistedBytes: 128 },
    })
    expect(result.receipt.receiptId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.receipt.output.aggregateDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('binds incremental affected revisions/chunks and proves parity across every required dimension', async () => {
    const result = await executeDatasetMaterialization(request(fixture('supported.json'), 'incremental'), runtime(['index.lexical']), adapter(), () => true)
    expect(result.receipt.affected).toEqual({ sourceRevisions: ['revision-2'], recordDigests: [digest('c')], chunkDigests: [digest('e')] })
    expect(compareDatasetIncrementalParity(artifacts, structuredClone(artifacts))).toEqual({ equivalent: true, mismatches: [] })
    expect(compareDatasetIncrementalParity(artifacts, [...artifacts].reverse())).toEqual({ equivalent: false, mismatches: ['ordering'] })
    const changed = structuredClone(artifacts)
    changed.push({ kind: 'relationship', logicalId: 'edge-1', sourceRecordDigests: [digest('c')], digest: digest('9') })
    expect(compareDatasetIncrementalParity(artifacts, changed)).toMatchObject({ equivalent: false, mismatches: expect.arrayContaining(['identities', 'relationships', 'digests', 'ordering']) })
  })

  it('labels the actual backend/profile, fallback, and implementation-scoped scores', async () => {
    const response = await executeDatasetRetrieval({
      queryId: 'query-1', operation: 'query', profile: fixture('degraded.json'), query: { text: 'needle' }, limit: 10,
    }, runtime(['index.lexical']), adapter(), digest('0'), [fixture('supported.json')])
    expect(response).toMatchObject({
      requestedProfile: 'fortemi.hybrid.preferred', actualProfile: 'fortemi.lexical.default',
      actualBackend: { id: 'test-adapter', version: '1.2.3', plane: 'server-process' }, degraded: true,
      scoreSemantics: { implementationScoped: true, comparableAcrossImplementations: false },
    })
    expect(response.fallbackReason).toContain('unsupported')
  })

  it('keeps optional external adapters derived-only and compatible with #212', async () => {
    const external = fixture('external-adapter.json')
    expect(external.output).toEqual({ dataClass: 'regenerable-index', canonicalMutation: false })
    const canonical = request(external)
    canonical.configuration = {}
    const before = structuredClone(canonical.snapshot)
    await executeDatasetMaterialization(canonical, runtime(['index.graph', 'lineage.relationship-evidence']), adapter(), () => true)
    expect(canonical.snapshot).toEqual(before)
  })

  it('rejects profiles that omit a privacy boundary or permit canonical mutation', () => {
    const invalidPrivacy = structuredClone(fixture('supported.json'))
    invalidPrivacy.privacy.filtersBefore = ['chunking', 'index-persistence']
    expect(negotiateDatasetMaterializationProfile({ operation: 'build', profile: invalidPrivacy, runtime: runtime(['index.lexical']) }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PROFILE_INVALID', path: '/privacy/filtersBefore' }))
    const invalidOutput = structuredClone(fixture('supported.json')) as unknown as DatasetMaterializationProfile
    ;(invalidOutput.output as { canonicalMutation: boolean }).canonicalMutation = true
    expect(negotiateDatasetMaterializationProfile({ operation: 'build', profile: invalidOutput, runtime: runtime(['index.lexical']) }).accepted).toBe(false)
  })

  it('validates configuration and resource bounds before invoking an adapter', async () => {
    let invoked = false
    const target = adapter()
    const guarded: DatasetMaterializationAdapter = {
      ...target,
      async materialize(input) { invoked = true; return target.materialize(input) },
    }
    await expect(executeDatasetMaterialization(
      { ...request(), configuration: { unknown: true } }, runtime(['index.lexical']), guarded, () => true,
    )).rejects.toMatchObject({ code: 'CONFIGURATION_INVALID' })
    expect(invoked).toBe(false)

    const constrained = fixture('supported.json')
    constrained.resourceLimits.maxRecords = 1
    await expect(executeDatasetMaterialization(request(constrained), runtime(['index.lexical']), guarded, () => true))
      .rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' })
    expect(invoked).toBe(false)
  })

  it('gates benchmark publication on correctness, freshness, and corpus-scoped claims', () => {
    const evidence = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../benchmarks/dataset-materialization/small-corpus.v1.json'), 'utf8')) as DatasetBenchmarkEvidence
    const validate = new Ajv2020({ strict: true }).compile(schema)
    expect(validate(evidence), JSON.stringify(validate.errors)).toBe(true)
    expect(validateDatasetBenchmarkEvidence(evidence)).toEqual([])
    const invalid = structuredClone(evidence)
    invalid.correctness.passed = false
    invalid.freshness.sourceRevision = 'stale-revision'
    ;(invalid.claims as { universalScaleLimit: boolean }).universalScaleLimit = true
    expect(validateDatasetBenchmarkEvidence(invalid)).toEqual([
      'correctness suite did not pass', 'benchmark evidence is stale', 'benchmark claims must remain corpus-scoped',
    ])
    expect(digestDatasetMaterializationValue({ b: 2, a: 1 })).toBe(digestDatasetMaterializationValue({ a: 1, b: 2 }))
  })
})
