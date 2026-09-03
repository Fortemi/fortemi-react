import { computeHash } from './hash.js'

export const DATASET_LINEAGE_CONTRACT = 'fortemi.dataset-lineage/v1' as const
export const DATASET_LINEAGE_SCHEMA_VERSION = '1.0.0' as const

export const LINEAGE_ENTITY_KINDS = [
  'dataset', 'dataset-revision', 'distribution', 'record', 'field', 'chunk',
  'index', 'embedding-set', 'graph-artifact', 'community-artifact',
  'processing-plan', 'run',
] as const
export type LineageEntityKind = typeof LINEAGE_ENTITY_KINDS[number]

export const LINEAGE_RELATIONSHIP_KINDS = [
  'derived-from', 'field-derived-from', 'extracted-from', 'chunk-of',
  'indexed-from', 'embedded-from', 'graph-derived-from',
  'community-derived-from', 'revision-of', 'distributed-as',
  'join-influence', 'filter-influence', 'aggregation-influence',
  'ordering-influence', 'similarity-influence',
] as const
export type LineageRelationshipKind = typeof LINEAGE_RELATIONSHIP_KINDS[number]
export type LineageAssertionKind = 'declared' | 'observed'
export type LineagePrivacy = 'public' | 'internal' | 'confidential' | 'restricted'

export interface LineageEntity {
  id: string
  kind: LineageEntityKind
  schemaId: string
  schemaVersion: string
  revision?: string
  datasetId?: string
  createdAt: string
  attributes?: Record<string, unknown>
}

export interface LineageAgent {
  id: string
  kind: 'person' | 'service' | 'software' | 'organization'
  name: string
  version?: string
}

export interface LineageActivity {
  id: string
  kind: 'ingest' | 'transform' | 'index' | 'query' | 'export' | 'import' | 'correction'
  planId?: string
  runId?: string
  startedAt: string
  endedAt?: string
  agentIds: string[]
}

export interface LineageEvidence {
  id: string
  revision: string
  locator: string
  digest: string
  mediaType?: string
  privacy: LineagePrivacy
  capturedAt: string
  payload?: unknown
}

export interface LineageEvidenceReference {
  evidenceId: string
  revision: string
  digest: string
  locator?: string
}

export interface LineageAssertion {
  id: string
  revision: string
  relationship: LineageRelationshipKind
  assertionKind: LineageAssertionKind
  sourceEntityId: string
  targetEntityId: string
  issuerAgentId: string
  producingActivityId?: string
  method: string
  evidence: LineageEvidenceReference[]
  confidence: number
  privacy: LineagePrivacy
  schemaId: string
  schemaVersion: string
  assertedAt: string
}

export interface LineageCorrection {
  id: string
  assertionId: string
  assertionRevision: string
  action: 'correct' | 'retract' | 'supersede'
  issuerAgentId: string
  activityId: string
  reason: string
  recordedAt: string
  replacementAssertionId?: string
  replacementRevision?: string
}

export interface LineageLedgerArchive {
  contract: typeof DATASET_LINEAGE_CONTRACT
  schemaVersion: string
  snapshot: number
  entities: LineageEntity[]
  agents: LineageAgent[]
  activities: LineageActivity[]
  evidence: LineageEvidence[]
  assertions: LineageAssertion[]
  corrections: LineageCorrection[]
  digest: string
}

export interface LineageAuthorizationPolicy {
  canReadEntity(entity: LineageEntity): boolean
  canReadAssertion(assertion: LineageAssertion): boolean
  canReadEvidence(evidence: LineageEvidence): boolean
}

export interface LineageTraversalRequest {
  startEntityIds: string[]
  direction: 'upstream' | 'downstream' | 'both'
  entityKinds?: LineageEntityKind[]
  relationshipKinds?: LineageRelationshipKind[]
  assertionKinds?: LineageAssertionKind[]
  maximumDepth: number
  maximumResults: number
  pageSize: number
  snapshot?: number
  cursor?: string
  includeEvidence?: boolean
}

export interface LineageTraversalNode {
  entity: LineageEntity
  depth: number
  pathAssertionIds: string[]
}

export interface LineageTraversalEdge {
  assertion: LineageAssertion
  status: 'active' | 'corrected' | 'retracted' | 'superseded'
  evidence?: LineageEvidence[]
}

export interface LineageTraversalResult {
  contract: typeof DATASET_LINEAGE_CONTRACT
  schemaVersion: string
  snapshot: number
  nodes: LineageTraversalNode[]
  edges: LineageTraversalEdge[]
  nextCursor?: string
  truncated: boolean
}

export type LineageValidationCode =
  | 'IDENTITY_REQUIRED' | 'IDENTITY_DUPLICATE' | 'IDENTITY_DANGLING'
  | 'TYPE_DIRECTION_INVALID' | 'EVIDENCE_DANGLING' | 'EVIDENCE_DIGEST_MISMATCH'
  | 'ACTIVITY_REQUIRED' | 'AGENT_DANGLING' | 'VALUE_INVALID'
  | 'CORRECTION_INVALID' | 'TRAVERSAL_LIMIT_EXCEEDED' | 'CURSOR_INVALID'
  | 'SNAPSHOT_UNAVAILABLE'

export class LineageValidationError extends Error {
  constructor(public readonly code: LineageValidationCode, message: string) {
    super(message)
    this.name = 'LineageValidationError'
  }
}

export interface LineageProjectionCapabilities {
  entityKinds: LineageEntityKind[]
  relationshipKinds: LineageRelationshipKind[]
  assertionKinds: LineageAssertionKind[]
  preservesEvidence: boolean
  preservesCorrections: boolean
}

export interface LineageLossItem {
  path: string
  reason: 'unsupported-entity-kind' | 'unsupported-relationship-kind' | 'unsupported-assertion-kind' | 'evidence-omitted' | 'corrections-omitted'
  canonicalDigest: string
}

export interface LineageLossReceipt {
  contract: typeof DATASET_LINEAGE_CONTRACT
  schemaVersion: string
  sourceDigest: string
  projectionDigest: string
  lossless: boolean
  losses: LineageLossItem[]
}

export interface LineageProjection {
  contract: typeof DATASET_LINEAGE_CONTRACT
  schemaVersion: string
  canonical: false
  regenerable: true
  sourceDigest: string
  entities: LineageEntity[]
  assertions: LineageAssertion[]
  evidence: LineageEvidence[]
  corrections: LineageCorrection[]
  digest: string
  lossReceipt: LineageLossReceipt
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export function computeLineageDigest(value: unknown): string {
  return computeHash(new TextEncoder().encode(canonicalJson(value)))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireIdentity(id: string, label: string): void {
  if (!id || id.trim() !== id) throw new LineageValidationError('IDENTITY_REQUIRED', `${label} must be a non-empty canonical identity`)
}

function requireTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LineageValidationError('VALUE_INVALID', `${label} must be an RFC 3339 UTC timestamp`)
  }
}

const ENTITY_KIND_SET = new Set<string>(LINEAGE_ENTITY_KINDS)
const RELATIONSHIP_KIND_SET = new Set<string>(LINEAGE_RELATIONSHIP_KINDS)
const RELATIONSHIP_ENDPOINTS: Partial<Record<LineageRelationshipKind, [LineageEntityKind[], LineageEntityKind[]]>> = {
  'field-derived-from': [['field'], ['field']],
  'chunk-of': [['chunk'], ['record', 'distribution']],
  'indexed-from': [['index'], ['dataset', 'dataset-revision', 'distribution', 'record', 'field', 'chunk']],
  'embedded-from': [['embedding-set'], ['dataset', 'dataset-revision', 'record', 'field', 'chunk']],
  'graph-derived-from': [['graph-artifact'], ['dataset', 'dataset-revision', 'index', 'embedding-set']],
  'community-derived-from': [['community-artifact'], ['graph-artifact']],
  'revision-of': [['dataset-revision'], ['dataset']],
  'distributed-as': [['dataset', 'dataset-revision'], ['distribution']],
}

interface LedgerRevision<T> { sequence: number; value: T }

export interface DatasetLineageLedgerOptions {
  maximumTraversalDepth?: number
  maximumTraversalResults?: number
  maximumPageSize?: number
}

/**
 * Append-only canonical lineage ledger. Graph and index views are projections;
 * this ledger remains the authority for assertions and their evidence.
 */
export class DatasetLineageLedger {
  private sequence = 0
  private readonly entities = new Map<string, LedgerRevision<LineageEntity>>()
  private readonly agents = new Map<string, LedgerRevision<LineageAgent>>()
  private readonly activities = new Map<string, LedgerRevision<LineageActivity>>()
  private readonly evidence = new Map<string, LedgerRevision<LineageEvidence>>()
  private readonly assertions = new Map<string, LedgerRevision<LineageAssertion>>()
  private readonly corrections = new Map<string, LedgerRevision<LineageCorrection>>()
  private readonly maximumTraversalDepth: number
  private readonly maximumTraversalResults: number
  private readonly maximumPageSize: number

  constructor(options: DatasetLineageLedgerOptions = {}) {
    this.maximumTraversalDepth = options.maximumTraversalDepth ?? 16
    this.maximumTraversalResults = options.maximumTraversalResults ?? 10_000
    this.maximumPageSize = options.maximumPageSize ?? 500
  }

  get snapshot(): number { return this.sequence }

  appendEntity(entity: LineageEntity): number {
    requireIdentity(entity.id, 'entity.id')
    if (!ENTITY_KIND_SET.has(entity.kind)) throw new LineageValidationError('VALUE_INVALID', `Unsupported entity kind ${String(entity.kind)}`)
    requireIdentity(entity.schemaId, 'entity.schemaId')
    requireIdentity(entity.schemaVersion, 'entity.schemaVersion')
    requireTimestamp(entity.createdAt, 'entity.createdAt')
    this.ensureUnique(this.entities, entity.id, 'entity')
    return this.append(this.entities, entity.id, entity)
  }

  appendAgent(agent: LineageAgent): number {
    requireIdentity(agent.id, 'agent.id')
    requireIdentity(agent.name, 'agent.name')
    this.ensureUnique(this.agents, agent.id, 'agent')
    return this.append(this.agents, agent.id, agent)
  }

  appendActivity(activity: LineageActivity): number {
    requireIdentity(activity.id, 'activity.id')
    requireTimestamp(activity.startedAt, 'activity.startedAt')
    if (activity.endedAt) requireTimestamp(activity.endedAt, 'activity.endedAt')
    for (const agentId of activity.agentIds) {
      if (!this.agents.has(agentId)) throw new LineageValidationError('AGENT_DANGLING', `Activity references unknown agent ${agentId}`)
    }
    this.ensureUnique(this.activities, activity.id, 'activity')
    return this.append(this.activities, activity.id, activity)
  }

  appendEvidence(item: LineageEvidence): number {
    requireIdentity(item.id, 'evidence.id')
    requireIdentity(item.revision, 'evidence.revision')
    requireIdentity(item.locator, 'evidence.locator')
    requireTimestamp(item.capturedAt, 'evidence.capturedAt')
    if (item.payload !== undefined && computeLineageDigest(item.payload) !== item.digest) {
      throw new LineageValidationError('EVIDENCE_DIGEST_MISMATCH', `Evidence ${item.id} payload does not match ${item.digest}`)
    }
    const key = `${item.id}@${item.revision}`
    this.ensureUnique(this.evidence, key, 'evidence revision')
    return this.append(this.evidence, key, item)
  }

  appendAssertion(assertion: LineageAssertion): number {
    requireIdentity(assertion.id, 'assertion.id')
    requireIdentity(assertion.revision, 'assertion.revision')
    requireIdentity(assertion.method, 'assertion.method')
    requireIdentity(assertion.schemaId, 'assertion.schemaId')
    requireIdentity(assertion.schemaVersion, 'assertion.schemaVersion')
    requireTimestamp(assertion.assertedAt, 'assertion.assertedAt')
    if (!RELATIONSHIP_KIND_SET.has(assertion.relationship)) throw new LineageValidationError('VALUE_INVALID', `Unsupported relationship ${String(assertion.relationship)}`)
    if (!Number.isFinite(assertion.confidence) || assertion.confidence < 0 || assertion.confidence > 1) {
      throw new LineageValidationError('VALUE_INVALID', 'assertion.confidence must be between 0 and 1')
    }
    const source = this.entities.get(assertion.sourceEntityId)?.value
    const target = this.entities.get(assertion.targetEntityId)?.value
    if (!source || !target) throw new LineageValidationError('IDENTITY_DANGLING', 'Assertion source and target must both exist')
    const endpointRule = RELATIONSHIP_ENDPOINTS[assertion.relationship]
    if (endpointRule && (!endpointRule[0].includes(source.kind) || !endpointRule[1].includes(target.kind))) {
      throw new LineageValidationError('TYPE_DIRECTION_INVALID', `${assertion.relationship} does not allow ${source.kind} -> ${target.kind}`)
    }
    if (!this.agents.has(assertion.issuerAgentId)) throw new LineageValidationError('AGENT_DANGLING', `Unknown issuer agent ${assertion.issuerAgentId}`)
    if (assertion.producingActivityId && !this.activities.has(assertion.producingActivityId)) {
      throw new LineageValidationError('IDENTITY_DANGLING', `Unknown producing activity ${assertion.producingActivityId}`)
    }
    if (assertion.assertionKind === 'observed' && !assertion.producingActivityId) {
      throw new LineageValidationError('ACTIVITY_REQUIRED', 'Observed assertions require a producing activity')
    }
    if (assertion.assertionKind === 'observed' && assertion.evidence.length === 0) {
      throw new LineageValidationError('EVIDENCE_DANGLING', 'Observed assertions require evidence')
    }
    for (const reference of assertion.evidence) {
      const item = this.evidence.get(`${reference.evidenceId}@${reference.revision}`)?.value
      if (!item) throw new LineageValidationError('EVIDENCE_DANGLING', `Unknown evidence ${reference.evidenceId}@${reference.revision}`)
      if (item.digest !== reference.digest) throw new LineageValidationError('EVIDENCE_DIGEST_MISMATCH', `Evidence reference digest differs for ${reference.evidenceId}`)
      if (reference.locator && reference.locator !== item.locator) throw new LineageValidationError('EVIDENCE_DIGEST_MISMATCH', `Evidence locator differs for ${reference.evidenceId}`)
    }
    const key = `${assertion.id}@${assertion.revision}`
    if (this.assertions.has(key)) throw new LineageValidationError('IDENTITY_DUPLICATE', `Duplicate assertion revision ${key}`)
    const prior = [...this.assertions.values()].some(entry => entry.value.id === assertion.id)
    if (prior && !this.hasReplacementPermission(assertion.id, assertion.revision)) {
      throw new LineageValidationError('CORRECTION_INVALID', `Assertion ${assertion.id} can only receive revision ${assertion.revision} after an explicit correction`)
    }
    return this.append(this.assertions, key, assertion)
  }

  appendCorrection(correction: LineageCorrection): number {
    requireIdentity(correction.id, 'correction.id')
    requireIdentity(correction.reason, 'correction.reason')
    requireTimestamp(correction.recordedAt, 'correction.recordedAt')
    if (!this.assertions.has(`${correction.assertionId}@${correction.assertionRevision}`)) throw new LineageValidationError('IDENTITY_DANGLING', `Unknown assertion ${correction.assertionId}@${correction.assertionRevision}`)
    if (!this.agents.has(correction.issuerAgentId)) throw new LineageValidationError('AGENT_DANGLING', `Unknown correction issuer ${correction.issuerAgentId}`)
    const activity = this.activities.get(correction.activityId)?.value
    if (!activity || activity.kind !== 'correction') throw new LineageValidationError('CORRECTION_INVALID', 'Correction requires a correction activity')
    if (correction.action === 'retract' && (correction.replacementAssertionId || correction.replacementRevision)) throw new LineageValidationError('CORRECTION_INVALID', 'Retraction cannot name a replacement')
    if (correction.action !== 'retract' && (!correction.replacementAssertionId || !correction.replacementRevision)) throw new LineageValidationError('CORRECTION_INVALID', `${correction.action} requires a replacement assertion identity and revision`)
    if (correction.replacementAssertionId === correction.assertionId && correction.action === 'supersede') {
      throw new LineageValidationError('CORRECTION_INVALID', 'Supersession must identify a different assertion')
    }
    this.ensureUnique(this.corrections, correction.id, 'correction')
    return this.append(this.corrections, correction.id, correction)
  }

  traverse(request: LineageTraversalRequest, policy: LineageAuthorizationPolicy): LineageTraversalResult {
    this.validateTraversalRequest(request)
    const snapshot = request.snapshot ?? this.sequence
    if (snapshot < 0 || snapshot > this.sequence) throw new LineageValidationError('SNAPSHOT_UNAVAILABLE', `Snapshot ${snapshot} is unavailable`)
    const entityMap = this.visibleAt(this.entities, snapshot)
    const assertions = [...this.visibleAt(this.assertions, snapshot).values()]
      .filter(assertion => !request.relationshipKinds || request.relationshipKinds.includes(assertion.relationship))
      .filter(assertion => !request.assertionKinds || request.assertionKinds.includes(assertion.assertionKind))
      .filter(assertion => policy.canReadAssertion(clone(assertion)))
      .filter(assertion => {
        const source = entityMap.get(assertion.sourceEntityId)
        const target = entityMap.get(assertion.targetEntityId)
        return Boolean(source && target && policy.canReadEntity(clone(source)) && policy.canReadEntity(clone(target)))
      })
      .sort(compareAssertions)

    for (const id of request.startEntityIds) {
      const entity = entityMap.get(id)
      if (!entity || !policy.canReadEntity(clone(entity))) throw new LineageValidationError('IDENTITY_DANGLING', `Start entity ${id} is unavailable`)
    }

    const queue = [...new Set(request.startEntityIds)].sort().map(id => ({ id, depth: 0, path: [] as string[] }))
    const visitedDepth = new Map<string, number>()
    const nodeMap = new Map<string, LineageTraversalNode>()
    const edgeMap = new Map<string, LineageTraversalEdge>()
    while (queue.length > 0) {
      const current = queue.shift()!
      const priorDepth = visitedDepth.get(current.id)
      if (priorDepth !== undefined && priorDepth <= current.depth) continue
      visitedDepth.set(current.id, current.depth)
      const entity = entityMap.get(current.id)!
      if (!request.entityKinds || request.entityKinds.includes(entity.kind) || current.depth === 0) {
        nodeMap.set(current.id, { entity: clone(entity), depth: current.depth, pathAssertionIds: [...current.path] })
      }
      if (current.depth >= request.maximumDepth) continue
      for (const assertion of assertions) {
        const downstream = assertion.sourceEntityId === current.id
        const upstream = assertion.targetEntityId === current.id
        if ((request.direction === 'downstream' && !downstream) || (request.direction === 'upstream' && !upstream) || (request.direction === 'both' && !downstream && !upstream)) continue
        const nextId = downstream ? assertion.targetEntityId : assertion.sourceEntityId
        edgeMap.set(`${assertion.id}@${assertion.revision}`, {
          assertion: clone(assertion),
          status: this.statusAt(assertion.id, assertion.revision, snapshot),
          ...(request.includeEvidence ? { evidence: assertion.evidence.map(reference => this.evidence.get(`${reference.evidenceId}@${reference.revision}`))
            .filter((entry): entry is LedgerRevision<LineageEvidence> => Boolean(entry && entry.sequence <= snapshot))
            .map(entry => entry.value).filter(item => policy.canReadEvidence(clone(item))).map(clone) } : {}),
        })
        queue.push({ id: nextId, depth: current.depth + 1, path: [...current.path, assertion.id] })
      }
      if (nodeMap.size + edgeMap.size > request.maximumResults) break
    }

    const allNodes = [...nodeMap.values()].sort((left, right) => left.depth - right.depth || left.entity.id.localeCompare(right.entity.id))
    const allEdges = [...edgeMap.values()].sort((left, right) => compareAssertions(left.assertion, right.assertion))
    const rows = [
      ...allNodes.map(value => ({ kind: 'node' as const, key: `n:${String(value.depth).padStart(8, '0')}:${value.entity.id}`, value })),
      ...allEdges.map(value => ({ kind: 'edge' as const, key: `e:${value.assertion.sourceEntityId}:${value.assertion.targetEntityId}:${value.assertion.relationship}:${value.assertion.id}`, value })),
    ].sort((left, right) => left.key.localeCompare(right.key))
    const requestFingerprint = this.traversalFingerprint(request, snapshot)
    const offset = request.cursor ? this.decodeCursor(request.cursor, requestFingerprint, snapshot) : 0
    const bounded = rows.slice(0, request.maximumResults)
    const page = bounded.slice(offset, offset + request.pageSize)
    const nextOffset = offset + page.length
    const truncated = rows.length > request.maximumResults
    return {
      contract: DATASET_LINEAGE_CONTRACT,
      schemaVersion: DATASET_LINEAGE_SCHEMA_VERSION,
      snapshot,
      nodes: page.filter((row): row is Extract<typeof row, { kind: 'node' }> => row.kind === 'node').map(row => clone(row.value)),
      edges: page.filter((row): row is Extract<typeof row, { kind: 'edge' }> => row.kind === 'edge').map(row => clone(row.value)),
      ...(nextOffset < bounded.length ? { nextCursor: `${snapshot}.${nextOffset}.${requestFingerprint}` } : {}),
      truncated,
    }
  }

  exportArchive(snapshot = this.sequence): LineageLedgerArchive {
    if (snapshot < 0 || snapshot > this.sequence) throw new LineageValidationError('SNAPSHOT_UNAVAILABLE', `Snapshot ${snapshot} is unavailable`)
    const content = {
      contract: DATASET_LINEAGE_CONTRACT,
      schemaVersion: DATASET_LINEAGE_SCHEMA_VERSION,
      snapshot,
      entities: this.sorted(this.visibleAt(this.entities, snapshot)),
      agents: this.sorted(this.visibleAt(this.agents, snapshot)),
      activities: this.sorted(this.visibleAt(this.activities, snapshot)),
      evidence: this.sorted(this.visibleAt(this.evidence, snapshot), item => `${item.id}@${item.revision}`),
      assertions: this.sorted(this.visibleAt(this.assertions, snapshot)),
      corrections: this.sorted(this.visibleAt(this.corrections, snapshot)),
    }
    return clone({ ...content, digest: computeLineageDigest(content) })
  }

  static importArchive(archive: LineageLedgerArchive, options: DatasetLineageLedgerOptions = {}): DatasetLineageLedger {
    if (archive.contract !== DATASET_LINEAGE_CONTRACT || !archive.schemaVersion.startsWith('1.')) throw new LineageValidationError('VALUE_INVALID', 'Unsupported lineage archive contract')
    const { digest, ...content } = archive
    if (computeLineageDigest(content) !== digest) throw new LineageValidationError('EVIDENCE_DIGEST_MISMATCH', 'Lineage archive digest does not match canonical content')
    const ledger = new DatasetLineageLedger(options)
    for (const item of archive.agents) ledger.appendAgent(item)
    for (const item of archive.entities) ledger.appendEntity(item)
    for (const item of archive.activities) ledger.appendActivity(item)
    for (const item of archive.evidence) ledger.appendEvidence(item)
    const replacementKeys = new Set(archive.corrections.flatMap(item => item.replacementAssertionId && item.replacementRevision ? [`${item.replacementAssertionId}@${item.replacementRevision}`] : []))
    for (const item of archive.assertions.filter(item => !replacementKeys.has(`${item.id}@${item.revision}`))) ledger.appendAssertion(item)
    const pending = [...archive.corrections]
    while (pending.length > 0) {
      const index = pending.findIndex(item => ledger.assertions.has(`${item.assertionId}@${item.assertionRevision}`))
      if (index < 0) throw new LineageValidationError('CORRECTION_INVALID', 'Correction history contains an unreachable assertion revision')
      const correction = pending.splice(index, 1)[0]!
      ledger.appendCorrection(correction)
      if (correction.replacementAssertionId && correction.replacementRevision) {
        const key = `${correction.replacementAssertionId}@${correction.replacementRevision}`
        if (!ledger.assertions.has(key)) {
          const replacement = archive.assertions.find(item => `${item.id}@${item.revision}` === key)
          if (!replacement) throw new LineageValidationError('IDENTITY_DANGLING', `Missing replacement assertion ${key}`)
          ledger.appendAssertion(replacement)
        }
      }
    }
    return ledger
  }

  project(capabilities: LineageProjectionCapabilities, snapshot = this.sequence): LineageProjection {
    const source = this.exportArchive(snapshot)
    const losses: LineageLossItem[] = []
    const entities = source.entities.filter((item, index) => {
      const keep = capabilities.entityKinds.includes(item.kind)
      if (!keep) losses.push({ path: `/entities/${index}`, reason: 'unsupported-entity-kind', canonicalDigest: computeLineageDigest(item) })
      return keep
    })
    const entityIds = new Set(entities.map(item => item.id))
    const assertions = source.assertions.filter((item, index) => {
      const reason = !capabilities.relationshipKinds.includes(item.relationship) ? 'unsupported-relationship-kind'
        : !capabilities.assertionKinds.includes(item.assertionKind) ? 'unsupported-assertion-kind'
          : !entityIds.has(item.sourceEntityId) || !entityIds.has(item.targetEntityId) ? 'unsupported-entity-kind' : undefined
      if (reason) losses.push({ path: `/assertions/${index}`, reason, canonicalDigest: computeLineageDigest(item) })
      return !reason
    })
    const evidenceIds = new Set(assertions.flatMap(item => item.evidence.map(reference => `${reference.evidenceId}@${reference.revision}`)))
    const evidence = capabilities.preservesEvidence ? source.evidence.filter(item => evidenceIds.has(`${item.id}@${item.revision}`)) : []
    if (!capabilities.preservesEvidence && evidenceIds.size > 0) losses.push({ path: '/evidence', reason: 'evidence-omitted', canonicalDigest: computeLineageDigest(source.evidence) })
    const assertionIds = new Set(assertions.map(item => item.id))
    const corrections = capabilities.preservesCorrections ? source.corrections.filter(item => assertionIds.has(item.assertionId)) : []
    if (!capabilities.preservesCorrections && source.corrections.length > 0) losses.push({ path: '/corrections', reason: 'corrections-omitted', canonicalDigest: computeLineageDigest(source.corrections) })
    losses.sort((left, right) => left.path.localeCompare(right.path) || left.reason.localeCompare(right.reason))
    const projectionContent = { entities, assertions, evidence, corrections }
    const projectionDigest = computeLineageDigest(projectionContent)
    return clone({
      contract: DATASET_LINEAGE_CONTRACT,
      schemaVersion: DATASET_LINEAGE_SCHEMA_VERSION,
      canonical: false,
      regenerable: true,
      sourceDigest: source.digest,
      ...projectionContent,
      digest: projectionDigest,
      lossReceipt: {
        contract: DATASET_LINEAGE_CONTRACT,
        schemaVersion: DATASET_LINEAGE_SCHEMA_VERSION,
        sourceDigest: source.digest,
        projectionDigest,
        lossless: losses.length === 0,
        losses,
      },
    })
  }

  private append<T>(map: Map<string, LedgerRevision<T>>, key: string, value: T): number {
    this.sequence += 1
    map.set(key, { sequence: this.sequence, value: clone(value) })
    return this.sequence
  }

  private ensureUnique<T>(map: Map<string, LedgerRevision<T>>, key: string, label: string): void {
    if (map.has(key)) throw new LineageValidationError('IDENTITY_DUPLICATE', `Duplicate ${label} identity ${key}`)
  }

  private visibleAt<T>(map: Map<string, LedgerRevision<T>>, snapshot: number): Map<string, T> {
    return new Map([...map].filter(([, entry]) => entry.sequence <= snapshot).map(([key, entry]) => [key, clone(entry.value)]))
  }

  private sorted<T extends { id: string }>(map: Map<string, T>, key: (item: T) => string = item => item.id): T[] {
    return [...map.values()].sort((left, right) => key(left).localeCompare(key(right))).map(clone)
  }

  private hasReplacementPermission(assertionId: string, revision: string): boolean {
    return [...this.corrections.values()].some(entry => entry.value.action === 'correct' && entry.value.replacementAssertionId === assertionId && entry.value.replacementRevision === revision)
  }

  private statusAt(assertionId: string, revision: string, snapshot: number): LineageTraversalEdge['status'] {
    const latest = [...this.corrections.values()].filter(entry => entry.sequence <= snapshot && entry.value.assertionId === assertionId && entry.value.assertionRevision === revision)
      .sort((left, right) => right.sequence - left.sequence)[0]?.value
    if (!latest) return 'active'
    return latest.action === 'correct' ? 'corrected' : latest.action === 'retract' ? 'retracted' : 'superseded'
  }

  private validateTraversalRequest(request: LineageTraversalRequest): void {
    if (request.startEntityIds.length === 0) throw new LineageValidationError('IDENTITY_REQUIRED', 'At least one start entity is required')
    if (!Number.isSafeInteger(request.maximumDepth) || request.maximumDepth < 0 || request.maximumDepth > this.maximumTraversalDepth) throw new LineageValidationError('TRAVERSAL_LIMIT_EXCEEDED', `maximumDepth exceeds ${this.maximumTraversalDepth}`)
    if (!Number.isSafeInteger(request.maximumResults) || request.maximumResults < 1 || request.maximumResults > this.maximumTraversalResults) throw new LineageValidationError('TRAVERSAL_LIMIT_EXCEEDED', `maximumResults exceeds ${this.maximumTraversalResults}`)
    if (!Number.isSafeInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > this.maximumPageSize || request.pageSize > request.maximumResults) throw new LineageValidationError('TRAVERSAL_LIMIT_EXCEEDED', `pageSize exceeds ${this.maximumPageSize}`)
  }

  private traversalFingerprint(request: LineageTraversalRequest, snapshot: number): string {
    const parameters = { ...request }
    delete parameters.cursor
    delete parameters.snapshot
    return computeLineageDigest({ ...parameters, startEntityIds: [...new Set(parameters.startEntityIds)].sort(), snapshot })
  }

  private decodeCursor(cursor: string, fingerprint: string, snapshot: number): number {
    const match = /^(\d+)\.(\d+)\.(sha256:[0-9a-f]{64})$/.exec(cursor)
    if (!match || Number(match[1]) !== snapshot || match[3] !== fingerprint) throw new LineageValidationError('CURSOR_INVALID', 'Cursor does not match this query and snapshot')
    const offset = Number(match[2])
    if (!Number.isSafeInteger(offset) || offset < 0) throw new LineageValidationError('CURSOR_INVALID', 'Cursor offset is invalid')
    return offset
  }
}

function compareAssertions(left: LineageAssertion, right: LineageAssertion): number {
  return left.sourceEntityId.localeCompare(right.sourceEntityId)
    || left.targetEntityId.localeCompare(right.targetEntityId)
    || left.relationship.localeCompare(right.relationship)
    || left.id.localeCompare(right.id)
}
