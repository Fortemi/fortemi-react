import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATASET_EXECUTION_CONTRACT,
  negotiateDatasetExecutionCapabilities,
  negotiateDatasetExecutionCapabilitiesFromWire,
  validateDatasetExecutionDescriptor,
} from '../dataset-execution-capabilities.js'
import type { DatasetExecutionCapabilityDescriptor } from '../dataset-execution-capabilities.js'
import corpus from '../../schemas/dataset-execution-capabilities/validation/1.0.1/negotiation-vectors.json' with { type: 'json' }
import wireCorpus from '../../schemas/dataset-execution-capabilities/validation/1.0.1/wire-vectors.json' with { type: 'json' }

function descriptor(): DatasetExecutionCapabilityDescriptor {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schemas/dataset-execution-capabilities/fixtures/remote-alpha.json'), 'utf8'))
}

describe('capability negotiation validation revision 1.0.1', () => {
  it.each(wireCorpus.cases)('shared wire vector $id', vector => {
    const result = negotiateDatasetExecutionCapabilitiesFromWire(vector.descriptor, vector.request)
    expect(result.valid).toBe(vector.valid)
    if (result.valid) expect(result.result.accepted).toBe(vector.accepted)
    else expect(result.diagnostics.length).toBeGreaterThan(0)
  })
  it.each(corpus.versions)('$id', ({ offered, minimum, accepted }) => {
    const input = descriptor()
    input.capabilities.find(item => item.id === 'ingest.full')!.version = offered
    const result = negotiateDatasetExecutionCapabilities(input, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: [{ id: 'ingest.full', minimumVersion: minimum }],
    })
    expect(result.accepted).toBe(accepted)
    if (!accepted) expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('rejects an unknown status at the existing public negotiation boundary', () => {
    const input = descriptor()
    Object.assign(input.capabilities[0], { status: 'not-a-valid-state' })
    expect(negotiateDatasetExecutionCapabilities(input, {
      contract: DATASET_EXECUTION_CONTRACT, required: [{ id: 'ingest.full' }],
    }).accepted).toBe(false)
  })

  it.each([null, [], {}, 'not-json-object', 1, true])('rejects malformed top-level JSON %j without throwing', value => {
    const request = { contract: DATASET_EXECUTION_CONTRACT, required: [] }
    expect(negotiateDatasetExecutionCapabilitiesFromWire(value, request).valid).toBe(false)
    expect(negotiateDatasetExecutionCapabilitiesFromWire(descriptor(), value).valid).toBe(false)
  })

  it.each([
    { capabilities: null }, { capabilities: [null] }, { evidence: null },
    { runtime: null }, { guarantees: null }, { unknown: 'private-sentinel' },
  ])('validates nested structure before semantic traversal: %j', mutation => {
    const result = negotiateDatasetExecutionCapabilitiesFromWire({ ...descriptor(), ...mutation }, {
      contract: DATASET_EXECUTION_CONTRACT, required: [],
    })
    expect(result.valid).toBe(false)
    expect(result).not.toHaveProperty('result')
    expect(JSON.stringify(result)).not.toContain('private-sentinel')
  })

  it.each([
    { required: null }, { required: [null] }, { optional: {} },
    { required: [{ id: 'ingest.full', fallback: ['schema.inspect'] }] },
    { required: [{ id: 'ingest.full', minimumLimits: { maxConcurrency: -1 } }] },
    { required: [{ id: 'ingest.full', minimumLimits: { maxConcurrency: 9007199254740992 } }] },
    { required: [{ id: 'ingest.full', minimumLimits: { unknown: 1 } }] },
    { required: [{ id: 'unknown' }] },
    { optional: [{ id: 'ingest.full', minimumVersion: '' }] },
    { optional: [{ id: 'ingest.full', fallback: ['unknown'] }] },
  ])('rejects malformed requests before negotiation: %j', mutation => {
    const request = { contract: DATASET_EXECUTION_CONTRACT, required: [], ...mutation }
    expect(negotiateDatasetExecutionCapabilitiesFromWire(descriptor(), request).valid).toBe(false)
  })

  it.each(['1.0.0', '1.0.1', '1.1.0', '1.0.0+build'])('accepts a compatible descriptor revision %s', schemaVersion => {
    expect(negotiateDatasetExecutionCapabilitiesFromWire({ ...descriptor(), schemaVersion }, {
      contract: DATASET_EXECUTION_CONTRACT, required: [],
    })).toMatchObject({ valid: true, result: { accepted: true } })
  })

  it.each(['2.0.0', '0.9.0', '1.0.0-alpha'])('rejects unsupported descriptor revision %s', schemaVersion => {
    expect(validateDatasetExecutionDescriptor({ ...descriptor(), schemaVersion })).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_VERSION_UNSUPPORTED' }),
    )
  })

  it('rejects unsafe runtime versions and does not echo unknown evidence values', () => {
    const input = descriptor()
    input.runtime.version = '9007199254740992.0.0'
    expect(validateDatasetExecutionDescriptor(input).length).toBeGreaterThan(0)
    input.runtime.version = '1.0.0'
    input.capabilities[0]!.evidence = ['private-sentinel']
    const diagnostics = validateDatasetExecutionDescriptor(input)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(JSON.stringify(diagnostics)).not.toContain('private-sentinel')
  })

  it('keeps optional prerelease mismatch explicit and does not mutate either input', () => {
    const input = descriptor()
    input.capabilities.find(item => item.id === 'ingest.full')!.version = '1.0.0-alpha'
    const request = { contract: DATASET_EXECUTION_CONTRACT, required: [], optional: [
      { id: 'ingest.full' as const, minimumVersion: '1.0.0', fallback: ['identity.record' as const] },
    ] }
    const before = JSON.stringify({ input, request })
    expect(negotiateDatasetExecutionCapabilitiesFromWire(input, request)).toMatchObject({
      valid: true, result: {
        accepted: true, selected: ['identity.record'],
        degradations: [{ requested: 'ingest.full', selected: 'identity.record', reason: 'version-insufficient' }],
      },
    })
    expect(JSON.stringify({ input, request })).toBe(before)
  })

  it('implements every pair in the normative SemVer prerelease chain', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
      '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (const [offeredIndex, offered] of chain.entries()) {
      for (const [minimumIndex, minimumVersion] of chain.entries()) {
        const input = descriptor()
        input.capabilities.find(item => item.id === 'ingest.full')!.version = offered
        expect(negotiateDatasetExecutionCapabilities(input, {
          contract: DATASET_EXECUTION_CONTRACT,
          required: [{ id: 'ingest.full', minimumVersion }],
        }).accepted, offered + ' >= ' + minimumVersion).toBe(offeredIndex >= minimumIndex)
      }
    }
  })
})
