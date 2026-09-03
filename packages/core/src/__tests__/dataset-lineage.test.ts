import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  DatasetLineageLedger,
  LINEAGE_ENTITY_KINDS,
  computeLineageDigest,
  type LineageActivity,
  type LineageAgent,
  type LineageAssertion,
  type LineageAuthorizationPolicy,
  type LineageEntity,
  type LineageEvidence,
  type LineageRelationshipKind,
} from '../dataset-lineage.js'

const timestamp = '2026-09-03T12:00:00.000Z'
const schemaId = 'urn:fortemi:test-schema'
const allowAll: LineageAuthorizationPolicy = {
  canReadEntity: () => true,
  canReadAssertion: () => true,
  canReadEvidence: () => true,
}
const agent: LineageAgent = { id: 'agent:fortemi', kind: 'software', name: 'Fortemi', version: '2026.8.0' }
const activity: LineageActivity = { id: 'activity:run-1', kind: 'transform', planId: 'plan:1', runId: 'run:1', startedAt: timestamp, endedAt: timestamp, agentIds: [agent.id] }
const evidencePayload = { query: 'select normalized_email from source', row: 7 }
const evidence: LineageEvidence = {
  id: 'evidence:query-1', revision: '1', locator: 'shard://runs/run-1/evidence/query-1.json',
  digest: computeLineageDigest(evidencePayload), privacy: 'internal', capturedAt: timestamp, payload: evidencePayload,
}
const entity = (id: string, kind: LineageEntity['kind'], attributes?: Record<string, unknown>): LineageEntity => ({
  id, kind, schemaId, schemaVersion: '1.0.0', createdAt: timestamp, ...(attributes ? { attributes } : {}),
})
const assertion = (overrides: Partial<LineageAssertion> = {}): LineageAssertion => ({
  id: 'assertion:field-email', revision: '1', relationship: 'field-derived-from', assertionKind: 'observed',
  sourceEntityId: 'field:source-email', targetEntityId: 'field:normalized-email', issuerAgentId: agent.id,
  producingActivityId: activity.id, method: 'sql-expression',
  evidence: [{ evidenceId: evidence.id, revision: evidence.revision, digest: evidence.digest, locator: evidence.locator }],
  confidence: 1, privacy: 'internal', schemaId: 'urn:fortemi:lineage-assertion', schemaVersion: '1.0.0', assertedAt: timestamp,
  ...overrides,
})

function baseLedger(): DatasetLineageLedger {
  const ledger = new DatasetLineageLedger({ maximumTraversalDepth: 8, maximumTraversalResults: 100, maximumPageSize: 20 })
  ledger.appendAgent(agent)
  ledger.appendEntity(entity('field:source-email', 'field'))
  ledger.appendEntity(entity('field:normalized-email', 'field'))
  ledger.appendActivity(activity)
  ledger.appendEvidence(evidence)
  ledger.appendAssertion(assertion())
  return ledger
}

describe('dataset lineage contract', () => {
  it('meta-validates the public schema and validates golden archive, traversal, projection, and receipt contracts', () => {
    const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schemas/dataset-lineage/v1.schema.json'), 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true, formats: { 'date-time': true } })
    expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true)
    const validate = ajv.compile(schema)
    const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../schemas/dataset-lineage/fixtures/golden-observed-field.json'), 'utf8'))
    const ledger = baseLedger()
    const archive = ledger.exportArchive()
    const traversal = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', maximumDepth: 2, maximumResults: 20, pageSize: 20, includeEvidence: true }, allowAll)
    const projection = ledger.project({ entityKinds: [...LINEAGE_ENTITY_KINDS], relationshipKinds: ['field-derived-from'], assertionKinds: ['observed'], preservesEvidence: true, preservesCorrections: true })
    for (const value of [golden, archive, traversal, projection, projection.lossReceipt]) expect(validate(value), JSON.stringify(validate.errors)).toBe(true)
  })

  it('represents every required dataset intelligence identity kind', () => {
    const ledger = new DatasetLineageLedger()
    for (const kind of LINEAGE_ENTITY_KINDS) ledger.appendEntity(entity(`${kind}:1`, kind))
    expect(ledger.exportArchive().entities.map(item => item.kind).sort()).toEqual([...LINEAGE_ENTITY_KINDS].sort())
  })

  it('preserves declared and observed evidence-bearing directional assertions independently', () => {
    const ledger = baseLedger()
    ledger.appendAssertion(assertion({ id: 'assertion:claimed', revision: 'claim-1', assertionKind: 'declared', producingActivityId: undefined, evidence: [], confidence: 0.6 }))
    const result = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', maximumDepth: 1, maximumResults: 20, pageSize: 20, includeEvidence: true }, allowAll)
    expect(result.edges.map(edge => edge.assertion.assertionKind).sort()).toEqual(['declared', 'observed'])
    expect(result.edges.find(edge => edge.assertion.assertionKind === 'observed')?.evidence).toEqual([evidence])
    expect(result.edges.find(edge => edge.assertion.assertionKind === 'declared')?.evidence).toEqual([])
  })

  it('rejects missing identities, invalid direction/type combinations, dangling evidence, and digest mismatches', () => {
    const ledger = baseLedger()
    expect(() => ledger.appendEntity(entity('', 'dataset'))).toThrow(expect.objectContaining({ code: 'IDENTITY_REQUIRED' }))
    ledger.appendEntity(entity('dataset:1', 'dataset'))
    expect(() => ledger.appendAssertion(assertion({ id: 'assertion:bad-direction', sourceEntityId: 'dataset:1' }))).toThrow(expect.objectContaining({ code: 'TYPE_DIRECTION_INVALID' }))
    expect(() => ledger.appendAssertion(assertion({ id: 'assertion:dangling-evidence', evidence: [{ evidenceId: 'missing', revision: '1', digest: evidence.digest }] }))).toThrow(expect.objectContaining({ code: 'EVIDENCE_DANGLING' }))
    expect(() => ledger.appendEvidence({ ...evidence, id: 'evidence:tampered', digest: `sha256:${'0'.repeat(64)}` })).toThrow(expect.objectContaining({ code: 'EVIDENCE_DIGEST_MISMATCH' }))
    expect(() => ledger.appendAssertion(assertion({ id: 'assertion:digest-mismatch', evidence: [{ evidenceId: evidence.id, revision: evidence.revision, digest: `sha256:${'0'.repeat(64)}` }] }))).toThrow(expect.objectContaining({ code: 'EVIDENCE_DIGEST_MISMATCH' }))
  })

  it('keeps corrections, retractions, and supersessions append-only without erasing prior assertions', () => {
    const ledger = baseLedger()
    ledger.appendAssertion(assertion({ id: 'assertion:claimed', assertionKind: 'declared', producingActivityId: undefined, evidence: [] }))
    ledger.appendActivity({ id: 'activity:correction', kind: 'correction', startedAt: timestamp, agentIds: [agent.id] })
    ledger.appendCorrection({ id: 'correction:1', assertionId: 'assertion:field-email', assertionRevision: '1', action: 'correct', issuerAgentId: agent.id, activityId: 'activity:correction', reason: 'correct method', recordedAt: timestamp, replacementAssertionId: 'assertion:field-email', replacementRevision: '2' })
    ledger.appendAssertion(assertion({ revision: '2', method: 'sql-expression-v2' }))
    ledger.appendCorrection({ id: 'correction:2', assertionId: 'assertion:claimed', assertionRevision: '1', action: 'retract', issuerAgentId: agent.id, activityId: 'activity:correction', reason: 'claim withdrawn', recordedAt: timestamp })
    const result = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', maximumDepth: 1, maximumResults: 20, pageSize: 20 }, allowAll)
    expect(result.edges.map(edge => `${edge.assertion.id}@${edge.assertion.revision}:${edge.status}`).sort()).toEqual([
      'assertion:claimed@1:retracted',
      'assertion:field-email@1:corrected',
      'assertion:field-email@2:active',
    ])
    expect(ledger.exportArchive().assertions).toHaveLength(3)
  })

  it('round-trips corrected and superseded history without semantic or byte-field loss', () => {
    const ledger = baseLedger()
    ledger.appendAssertion(assertion({ id: 'assertion:claimed', assertionKind: 'declared', producingActivityId: undefined, evidence: [], confidence: 0.5 }))
    ledger.appendActivity({ id: 'activity:correction', kind: 'correction', startedAt: timestamp, agentIds: [agent.id] })
    ledger.appendCorrection({ id: 'correction:correct', assertionId: 'assertion:field-email', assertionRevision: '1', action: 'correct', issuerAgentId: agent.id, activityId: 'activity:correction', reason: 'method clarified', recordedAt: timestamp, replacementAssertionId: 'assertion:field-email', replacementRevision: '2' })
    ledger.appendAssertion(assertion({ revision: '2', method: 'sql-expression-v2' }))
    ledger.appendCorrection({ id: 'correction:retract', assertionId: 'assertion:claimed', assertionRevision: '1', action: 'retract', issuerAgentId: agent.id, activityId: 'activity:correction', reason: 'claim withdrawn', recordedAt: timestamp })
    ledger.appendAssertion(assertion({ id: 'assertion:replacement', revision: '1', relationship: 'derived-from' }))
    ledger.appendCorrection({ id: 'correction:supersede', assertionId: 'assertion:field-email', assertionRevision: '2', action: 'supersede', issuerAgentId: agent.id, activityId: 'activity:correction', reason: 'canonical replacement', recordedAt: timestamp, replacementAssertionId: 'assertion:replacement', replacementRevision: '1' })
    const archive = ledger.exportArchive()
    expect(archive.assertions).toHaveLength(4)
    expect(archive.corrections.map(item => item.action).sort()).toEqual(['correct', 'retract', 'supersede'])
    expect(DatasetLineageLedger.importArchive(archive).exportArchive()).toEqual(archive)
  })

  it('traverses cycles once, distinguishes indirect influences, filters edges, and respects depth', () => {
    const ledger = baseLedger()
    ledger.appendEntity(entity('field:joined', 'field'))
    ledger.appendAssertion(assertion({ id: 'assertion:join', sourceEntityId: 'field:normalized-email', targetEntityId: 'field:joined', relationship: 'join-influence' }))
    ledger.appendAssertion(assertion({ id: 'assertion:cycle', sourceEntityId: 'field:joined', targetEntityId: 'field:source-email', relationship: 'derived-from' }))
    const result = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', maximumDepth: 8, maximumResults: 100, pageSize: 20 }, allowAll)
    expect(result.nodes.map(node => node.entity.id).sort()).toEqual(['field:joined', 'field:normalized-email', 'field:source-email'])
    expect(result.edges.map(edge => edge.assertion.relationship).sort()).toEqual(['derived-from', 'field-derived-from', 'join-influence'])
    const filtered = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', relationshipKinds: ['field-derived-from'], maximumDepth: 1, maximumResults: 20, pageSize: 20 }, allowAll)
    expect(filtered.edges).toHaveLength(1)
    expect(filtered.nodes.some(node => node.entity.id === 'field:joined')).toBe(false)
  })

  it('provides stable snapshot pagination and rejects cursor reuse or traversal overflow', () => {
    const ledger = baseLedger()
    const request = { startEntityIds: ['field:source-email'], direction: 'downstream' as const, maximumDepth: 2, maximumResults: 20, pageSize: 1 }
    const first = ledger.traverse(request, allowAll)
    expect(first.nextCursor).toBeDefined()
    ledger.appendEntity(entity('field:later', 'field'))
    const second = ledger.traverse({ ...request, snapshot: first.snapshot, cursor: first.nextCursor }, allowAll)
    expect(second.snapshot).toBe(first.snapshot)
    expect([...first.nodes, ...second.nodes].some(node => node.entity.id === 'field:later')).toBe(false)
    expect(() => ledger.traverse({ ...request, direction: 'upstream', snapshot: first.snapshot, cursor: first.nextCursor }, allowAll)).toThrow(expect.objectContaining({ code: 'CURSOR_INVALID' }))
    expect(() => ledger.traverse({ ...request, maximumDepth: 99 }, allowAll)).toThrow(expect.objectContaining({ code: 'TRAVERSAL_LIMIT_EXCEEDED' }))
  })

  it('applies authorization and privacy policy before exposing topology or evidence details', () => {
    const ledger = baseLedger()
    const restricted = entity('field:restricted', 'field')
    ledger.appendEntity(restricted)
    ledger.appendAssertion(assertion({ id: 'assertion:restricted', targetEntityId: restricted.id, privacy: 'restricted' }))
    const policy: LineageAuthorizationPolicy = {
      canReadEntity: item => item.id !== restricted.id,
      canReadAssertion: item => item.privacy !== 'restricted',
      canReadEvidence: () => false,
    }
    const result = ledger.traverse({ startEntityIds: ['field:source-email'], direction: 'downstream', maximumDepth: 3, maximumResults: 20, pageSize: 20, includeEvidence: true }, policy)
    expect(JSON.stringify(result)).not.toContain('field:restricted')
    expect(result.edges[0]?.evidence).toEqual([])
    expect(() => ledger.traverse({ startEntityIds: [restricted.id], direction: 'both', maximumDepth: 1, maximumResults: 20, pageSize: 20 }, policy)).toThrow(expect.objectContaining({ code: 'IDENTITY_DANGLING' }))
  })

  it('emits zero-loss receipts for Knowledge Shard-equivalent projections and explicit losses otherwise', () => {
    const ledger = baseLedger()
    const allRelationships: LineageRelationshipKind[] = ['derived-from', 'field-derived-from', 'extracted-from', 'chunk-of', 'indexed-from', 'embedded-from', 'graph-derived-from', 'community-derived-from', 'revision-of', 'distributed-as', 'join-influence', 'filter-influence', 'aggregation-influence', 'ordering-influence', 'similarity-influence']
    const lossless = ledger.project({ entityKinds: [...LINEAGE_ENTITY_KINDS], relationshipKinds: allRelationships, assertionKinds: ['declared', 'observed'], preservesEvidence: true, preservesCorrections: true })
    expect(lossless).toMatchObject({ canonical: false, regenerable: true, sourceDigest: ledger.exportArchive().digest, lossReceipt: { lossless: true, losses: [] } })
    const lossy = ledger.project({ entityKinds: ['dataset'], relationshipKinds: [], assertionKinds: [], preservesEvidence: false, preservesCorrections: false })
    expect(lossy.lossReceipt.lossless).toBe(false)
    expect(lossy.lossReceipt.losses.map(item => item.reason)).toContain('unsupported-entity-kind')
    expect(lossy.lossReceipt.losses.map(item => item.reason)).toContain('unsupported-relationship-kind')
    expect(lossy.canonical).toBe(false)
  })
})
