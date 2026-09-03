import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  DATASET_EXECUTION_CONTRACT,
  negotiateDatasetExecutionCapabilities,
  validateDatasetExecutionDescriptor,
  type DatasetCapabilityNegotiationRequest,
  type DatasetExecutionCapabilityDescriptor,
} from '../dataset-execution-capabilities.js'
import {
  FORTEMI_BROWSER_LOCAL_DATASET_EXECUTION_DESCRIPTOR,
  FORTEMI_PORTABLE_SHARD_DATASET_EXECUTION_DESCRIPTOR,
  FORTEMI_STATIC_CACHE_DATASET_EXECUTION_DESCRIPTOR,
} from '../dataset-execution-descriptors.js'

const contractRoot = resolve(import.meta.dirname, '../../schemas/dataset-execution-capabilities')
const fixture = (name: string): DatasetExecutionCapabilityDescriptor =>
  JSON.parse(readFileSync(resolve(contractRoot, 'fixtures', name), 'utf8'))

describe('dataset execution capability contract', () => {
  it('meta-validates and validates all golden descriptors', () => {
    const schema = JSON.parse(readFileSync(resolve(contractRoot, 'v1.schema.json'), 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    expect(ajv.validateSchema(schema)).toBe(true)
    const validate = ajv.compile(schema)
    for (const name of ['browser-local.json', 'static-cache.json', 'portable-shard.json', 'remote-alpha.json']) {
      const descriptor = fixture(name)
      expect(validate(descriptor), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true)
      expect(validateDatasetExecutionDescriptor(descriptor)).toEqual([])
    }
    expect(validate({
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', fallback: ['ingest.snapshot'] }],
    })).toBe(false)
    expect(validate({
      contract: DATASET_EXECUTION_CONTRACT,
      required: [],
      optional: [{ id: 'ingest.incremental', fallback: ['ingest.full'] }],
    })).toBe(true)
  })

  it('rejects internally inconsistent profiles that remain structurally valid', () => {
    for (const name of ['invalid-incremental-without-checkpoint.json', 'invalid-field-lineage-without-evidence.json']) {
      expect(validateDatasetExecutionDescriptor(fixture(name))).toContainEqual(
        expect.objectContaining({ code: 'CAPABILITY_INCONSISTENT' }),
      )
    }
  })

  it('exposes semantically valid descriptors for each implemented local plane', () => {
    expect([
      FORTEMI_BROWSER_LOCAL_DATASET_EXECUTION_DESCRIPTOR,
      FORTEMI_STATIC_CACHE_DATASET_EXECUTION_DESCRIPTOR,
      FORTEMI_PORTABLE_SHARD_DATASET_EXECUTION_DESCRIPTOR,
    ].map(descriptor => [descriptor.runtime.plane, validateDatasetExecutionDescriptor(descriptor)])).toEqual([
      ['browser-local-archive', []],
      ['static-cache', []],
      ['portable-shard', []],
    ])
  })

  it('negotiates exact support, versions, limits, and explicit optional fallback', () => {
    const descriptor = fixture('browser-local.json')
    const exact = negotiateDatasetExecutionCapabilities(descriptor, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', minimumVersion: '1.0.0', minimumLimits: { maxBatchRecords: 100 } }],
    })
    expect(exact).toMatchObject({ accepted: true, selected: ['ingest.full'], degradations: [], diagnostics: [] })

    const insufficient = negotiateDatasetExecutionCapabilities(descriptor, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', minimumVersion: '2.0.0' }],
    })
    expect(insufficient.accepted).toBe(false)
    expect(insufficient.diagnostics[0]?.code).toBe('CAPABILITY_VERSION_INSUFFICIENT')

    const limited = negotiateDatasetExecutionCapabilities(descriptor, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', minimumLimits: { maxBatchRecords: 1001 } }],
    })
    expect(limited.diagnostics[0]?.code).toBe('CAPABILITY_LIMIT_INSUFFICIENT')

    const degraded = negotiateDatasetExecutionCapabilities(descriptor, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'identity.record' }],
      optional: [{ id: 'ingest.incremental', fallback: ['ingest.full'] }],
    })
    expect(degraded).toMatchObject({
      accepted: true,
      selected: ['identity.record', 'ingest.full'],
      degradations: [{ requested: 'ingest.incremental', selected: 'ingest.full', reason: 'unsupported' }],
    })
    expect(degraded.degradations[0]?.changedGuarantees).not.toEqual([])
  })

  it('fails closed for unknown contract/schema majors and missing required capabilities', () => {
    const descriptor = fixture('static-cache.json')
    const wrongSchema = { ...descriptor, schemaVersion: '2.0.0' }
    expect(negotiateDatasetExecutionCapabilities(wrongSchema, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [],
    }).diagnostics[0]?.code).toBe('SCHEMA_VERSION_UNSUPPORTED')

    const missing = negotiateDatasetExecutionCapabilities(descriptor, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full' }],
    })
    expect(missing).toMatchObject({ accepted: false })
    expect(missing.diagnostics[0]?.code).toBe('REQUIRED_CAPABILITY_MISSING')

    const wrongContract: DatasetCapabilityNegotiationRequest = {
      contract: 'fortemi.dataset-execution-capabilities/v2' as typeof DATASET_EXECUTION_CONTRACT,
      required: [],
    }
    expect(negotiateDatasetExecutionCapabilities(descriptor, wrongContract).accepted).toBe(false)
  })

  it('is pure and performs no inferred I/O or mutation', () => {
    const descriptor = fixture('browser-local.json')
    const request: DatasetCapabilityNegotiationRequest = {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'identity.record' }],
    }
    const beforeDescriptor = JSON.stringify(descriptor)
    const beforeRequest = JSON.stringify(request)
    const first = negotiateDatasetExecutionCapabilities(descriptor, request)
    const second = negotiateDatasetExecutionCapabilities(descriptor, request)
    expect(first).toEqual(second)
    expect(JSON.stringify(descriptor)).toBe(beforeDescriptor)
    expect(JSON.stringify(request)).toBe(beforeRequest)
  })
})
