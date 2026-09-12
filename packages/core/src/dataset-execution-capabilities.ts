/**
 * Language-neutral dataset execution capability negotiation contract.
 *
 * A descriptor reports demonstrated behavior for one concrete runtime. It is
 * not inferred from a package/backend name and it does not establish liveness.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import validationSchema from '../schemas/dataset-execution-capabilities/validation/1.0.1/schema.json' with { type: 'json' }

export const DATASET_EXECUTION_CONTRACT = 'fortemi.dataset-execution-capabilities/v1' as const
export const DATASET_EXECUTION_SCHEMA_VERSION = '1.0.0' as const

export const DATASET_EXECUTION_CAPABILITY_IDS = [
  'ingest.full', 'ingest.snapshot', 'ingest.incremental', 'ingest.stream',
  'schema.inspect', 'identity.stable-revision', 'identity.record',
  'mutation.upsert', 'mutation.tombstone', 'mutation.reconcile',
  'checkpoint.read', 'checkpoint.write', 'execution.cancel', 'rejection.record',
  'index.lexical', 'index.chunk', 'index.vector', 'index.hybrid', 'index.rerank',
  'index.graph', 'index.community', 'lineage.dataset', 'lineage.record',
  'lineage.field', 'lineage.relationship-evidence', 'transaction.atomic-batch',
  'privacy.pre-materialization-filter', 'pagination.cursor',
  'ordering.deterministic',
] as const

export type DatasetExecutionCapabilityId = typeof DATASET_EXECUTION_CAPABILITY_IDS[number]
export type DatasetExecutionPlane =
  | 'browser-local-archive' | 'static-cache' | 'portable-shard'
  | 'server-process' | 'live-remote-persistence'
export type DatasetExecutionDataClass = 'canonical' | 'regenerable-index' | 'static-cache' | 'portable-projection' | 'remote-persistence'
export type DatasetExecutionMaturity = 'experimental' | 'alpha' | 'beta' | 'stable'
export type DatasetCapabilityStatus = 'supported' | 'experimental' | 'unsupported'

export interface DatasetCapabilityEvidence {
  id: string
  kind: 'fixture' | 'conformance-report' | 'live-qualification'
  uri: string
  digest?: string
}

export interface DatasetCapabilityLimits {
  maxInputBytes?: number
  maxRecordBytes?: number
  maxBatchRecords?: number
  maxConcurrency?: number
  maxPageSize?: number
  maxTraversalDepth?: number
}

export interface DatasetCapabilityDeclaration {
  id: DatasetExecutionCapabilityId
  version: string
  status: DatasetCapabilityStatus
  limits?: DatasetCapabilityLimits
  evidence: string[]
}

export interface DatasetExecutionCapabilityDescriptor {
  contract: typeof DATASET_EXECUTION_CONTRACT
  schemaVersion: string
  runtime: {
    id: string
    version: string
    plane: DatasetExecutionPlane
    dataClass: DatasetExecutionDataClass
    maturity: DatasetExecutionMaturity
  }
  guarantees: {
    transaction: 'none' | 'single-record' | 'atomic-batch'
    isolation: 'none' | 'snapshot' | 'serializable'
    durability: 'process' | 'memory' | 'filesystem' | 'wal' | 'replicated'
    availability: 'local-process' | 'single-host' | 'remote-service'
    ordering: 'unspecified' | 'stable-identity' | 'backend-cursor'
  }
  capabilities: DatasetCapabilityDeclaration[]
  evidence: DatasetCapabilityEvidence[]
}

export interface DatasetCapabilityRequirement {
  id: DatasetExecutionCapabilityId
  minimumVersion?: string
  minimumLimits?: DatasetCapabilityLimits
}

export interface DatasetOptionalCapabilityRequirement extends DatasetCapabilityRequirement {
  fallback?: DatasetExecutionCapabilityId[]
}

export interface DatasetCapabilityNegotiationRequest {
  contract: typeof DATASET_EXECUTION_CONTRACT
  required: DatasetCapabilityRequirement[]
  optional?: DatasetOptionalCapabilityRequirement[]
}

export type DatasetCapabilityDiagnosticCode =
  | 'CONTRACT_MAJOR_UNSUPPORTED' | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'DESCRIPTOR_INVALID' | 'CAPABILITY_DUPLICATE' | 'CAPABILITY_INCONSISTENT'
  | 'REQUIRED_CAPABILITY_MISSING' | 'CAPABILITY_VERSION_INSUFFICIENT'
  | 'CAPABILITY_LIMIT_INSUFFICIENT'

export interface DatasetCapabilityDiagnostic {
  code: DatasetCapabilityDiagnosticCode
  capability?: DatasetExecutionCapabilityId
  path?: string
  message: string
}

export interface DatasetCapabilityDegradation {
  requested: DatasetExecutionCapabilityId
  selected?: DatasetExecutionCapabilityId
  reason: 'unsupported' | 'version-insufficient' | 'limit-insufficient'
  changedGuarantees: string[]
}

export interface DatasetCapabilityNegotiationResult {
  contract: typeof DATASET_EXECUTION_CONTRACT
  accepted: boolean
  runtime: DatasetExecutionCapabilityDescriptor['runtime']
  selected: DatasetExecutionCapabilityId[]
  degradations: DatasetCapabilityDegradation[]
  diagnostics: DatasetCapabilityDiagnostic[]
}

export type DatasetCapabilityWireResult =
  | { valid: false; diagnostics: DatasetCapabilityDiagnostic[] }
  | { valid: true; result: DatasetCapabilityNegotiationResult }

const ID_SET = new Set<string>(DATASET_EXECUTION_CAPABILITY_IDS)
const LIMIT_KEYS = ['maxInputBytes', 'maxRecordBytes', 'maxBatchRecords', 'maxConcurrency', 'maxPageSize', 'maxTraversalDepth'] as const

const versionPattern = new RegExp(validationSchema.$defs.semver.pattern)
const ajv = new Ajv2020({ strict: true, allErrors: false })
ajv.addSchema(validationSchema)
const descriptorStructure = ajv.compile<DatasetExecutionCapabilityDescriptor>({ $ref: validationSchema.$id + '#/$defs/descriptor' })
const requestStructure = ajv.compile<DatasetCapabilityNegotiationRequest>({ $ref: validationSchema.$id + '#/$defs/request' })

function parseVersion(value: unknown): { core: number[]; prerelease: string[] } | null {
  if (typeof value !== 'string' || value.length > 256) return null
  const match = versionPattern.exec(value)
  if (!match || match[0] !== value) return null
  const core = match.slice(1, 4).map(Number)
  if (!core.every(Number.isSafeInteger)) return null
  return { core, prerelease: match[4]?.split('.') ?? [] }
}

function major(version: string): number | null {
  const parsed = parseVersion(version)
  return parsed && parsed.prerelease.length === 0 ? parsed.core[0]! : null
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumeric = /^[0-9]+$/.test(leftPart)
    const rightNumeric = /^[0-9]+$/.test(rightPart)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    // Length then ASCII preserves arbitrary-precision numeric prerelease order.
    if (leftNumeric && leftPart.length !== rightPart.length) return leftPart.length > rightPart.length ? 1 : -1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function isSupported(capability: DatasetCapabilityDeclaration | undefined): capability is DatasetCapabilityDeclaration {
  return capability !== undefined && (capability.status === 'supported' || capability.status === 'experimental')
}

function structuralDiagnostics(validate: ValidateFunction, prefix = ''): DatasetCapabilityDiagnostic[] {
  return (validate.errors ?? []).slice(0, 8).map(error => ({
    code: 'DESCRIPTOR_INVALID',
    path: (prefix + error.instancePath).slice(0, 256),
    message: 'Invalid capability wire structure: ' + error.keyword,
  }))
}

export function validateDatasetExecutionDescriptor(descriptor: unknown): DatasetCapabilityDiagnostic[] {
  if (!descriptorStructure(descriptor)) {
    if (descriptor && typeof descriptor === 'object' && 'contract' in descriptor && descriptor.contract !== DATASET_EXECUTION_CONTRACT) {
      return [{ code: 'CONTRACT_MAJOR_UNSUPPORTED', path: '/contract', message: 'Unsupported descriptor contract' }]
    }
    return structuralDiagnostics(descriptorStructure)
  }
  const diagnostics: DatasetCapabilityDiagnostic[] = []
  if (descriptor.contract !== DATASET_EXECUTION_CONTRACT) {
    diagnostics.push({ code: 'CONTRACT_MAJOR_UNSUPPORTED', path: '/contract', message: `Unsupported contract ${String(descriptor.contract)}` })
  }
  if (major(descriptor.schemaVersion) !== 1) {
    diagnostics.push({ code: 'SCHEMA_VERSION_UNSUPPORTED', path: '/schemaVersion', message: `Unsupported descriptor schema version ${descriptor.schemaVersion}` })
  }
  if (!parseVersion(descriptor.runtime.version)) {
    diagnostics.push({ code: 'DESCRIPTOR_INVALID', path: '/runtime/version', message: 'Invalid runtime semantic version' })
  }
  const capabilities = new Map<DatasetExecutionCapabilityId, DatasetCapabilityDeclaration>()
  descriptor.capabilities.forEach((capability, index) => {
    if (!ID_SET.has(capability.id) || compareVersions(capability.version, capability.version) === null) {
      diagnostics.push({ code: 'DESCRIPTOR_INVALID', path: `/capabilities/${index}`, message: `Invalid capability declaration ${capability.id}` })
      return
    }
    if (capabilities.has(capability.id)) {
      diagnostics.push({ code: 'CAPABILITY_DUPLICATE', capability: capability.id, path: `/capabilities/${index}/id`, message: `Capability ${capability.id} is declared more than once` })
    }
    capabilities.set(capability.id, capability)
    for (const key of LIMIT_KEYS) {
      const value = capability.limits?.[key]
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        diagnostics.push({ code: 'DESCRIPTOR_INVALID', capability: capability.id, path: `/capabilities/${index}/limits/${key}`, message: `${key} must be a non-negative safe integer` })
      }
    }
    if (capability.status !== 'unsupported' && capability.evidence.length === 0) {
      diagnostics.push({ code: 'DESCRIPTOR_INVALID', capability: capability.id, path: `/capabilities/${index}/evidence`, message: `Supported capability ${capability.id} requires evidence` })
    }
    for (const evidenceId of capability.evidence) {
      if (!descriptor.evidence.some(evidence => evidence.id === evidenceId)) {
        diagnostics.push({ code: 'DESCRIPTOR_INVALID', capability: capability.id, path: `/capabilities/${index}/evidence`, message: 'Capability references undeclared evidence' })
      }
    }
  })

  const requireTogether = (source: DatasetExecutionCapabilityId, requirements: DatasetExecutionCapabilityId[]) => {
    if (!isSupported(capabilities.get(source))) return
    for (const requirement of requirements) {
      if (!isSupported(capabilities.get(requirement))) {
        diagnostics.push({ code: 'CAPABILITY_INCONSISTENT', capability: source, message: `${source} requires ${requirement}` })
      }
    }
  }
  requireTogether('ingest.incremental', ['identity.stable-revision', 'checkpoint.read', 'checkpoint.write'])
  requireTogether('lineage.field', ['lineage.relationship-evidence'])
  requireTogether('mutation.reconcile', ['mutation.upsert', 'mutation.tombstone'])
  requireTogether('index.hybrid', ['index.lexical', 'index.vector'])
  if (descriptor.guarantees.transaction === 'atomic-batch' && !isSupported(capabilities.get('transaction.atomic-batch'))) {
    diagnostics.push({ code: 'CAPABILITY_INCONSISTENT', capability: 'transaction.atomic-batch', message: 'Atomic-batch guarantee requires transaction.atomic-batch capability' })
  }
  if (descriptor.runtime.plane === 'static-cache' && descriptor.runtime.dataClass !== 'static-cache') {
    diagnostics.push({ code: 'CAPABILITY_INCONSISTENT', message: 'Static-cache execution plane must declare static-cache data class' })
  }
  if (descriptor.runtime.plane === 'live-remote-persistence' && descriptor.runtime.maturity === 'stable' && !descriptor.evidence.some(item => item.kind === 'live-qualification')) {
    diagnostics.push({ code: 'CAPABILITY_INCONSISTENT', message: 'Stable live remote persistence requires live qualification evidence' })
  }
  return diagnostics
}

export function validateDatasetExecutionRequest(request: unknown): DatasetCapabilityDiagnostic[] {
  if (!requestStructure(request)) {
    if (request && typeof request === 'object' && 'contract' in request && request.contract !== DATASET_EXECUTION_CONTRACT) {
      return [{ code: 'CONTRACT_MAJOR_UNSUPPORTED', path: '/request/contract', message: 'Unsupported request contract' }]
    }
    return structuralDiagnostics(requestStructure, '/request')
  }
  const diagnostics: DatasetCapabilityDiagnostic[] = []
  for (const [group, requirements] of [['required', request.required], ['optional', request.optional ?? []]] as const) {
    requirements.forEach((requirement, index) => {
      if (requirement.minimumVersion !== undefined && !parseVersion(requirement.minimumVersion)) {
        diagnostics.push({ code: 'DESCRIPTOR_INVALID', path: '/request/' + group + '/' + index + '/minimumVersion', message: 'Invalid required semantic version' })
      }
    })
  }
  return diagnostics
}

/** Validate untrusted JSON before exposing a typed negotiation result. */
export function negotiateDatasetExecutionCapabilitiesFromWire(descriptor: unknown, request: unknown): DatasetCapabilityWireResult {
  const diagnostics = [...validateDatasetExecutionDescriptor(descriptor), ...validateDatasetExecutionRequest(request)]
  if (diagnostics.length) return { valid: false, diagnostics }
  return {
    valid: true,
    result: negotiateDatasetExecutionCapabilities(descriptor as DatasetExecutionCapabilityDescriptor, request as DatasetCapabilityNegotiationRequest),
  }
}

function assessRequirement(
  requirement: DatasetCapabilityRequirement,
  capabilities: Map<DatasetExecutionCapabilityId, DatasetCapabilityDeclaration>,
): { ok: boolean; reason?: DatasetCapabilityDegradation['reason']; diagnostics: DatasetCapabilityDiagnostic[] } {
  const capability = capabilities.get(requirement.id)
  if (!isSupported(capability)) {
    return { ok: false, reason: 'unsupported', diagnostics: [{ code: 'REQUIRED_CAPABILITY_MISSING', capability: requirement.id, message: `Capability ${requirement.id} is unsupported` }] }
  }
  if (requirement.minimumVersion !== undefined) {
    const comparison = compareVersions(capability.version, requirement.minimumVersion)
    if (comparison === null || comparison < 0) {
      return { ok: false, reason: 'version-insufficient', diagnostics: [{ code: 'CAPABILITY_VERSION_INSUFFICIENT', capability: requirement.id, message: `${capability.version} does not satisfy ${requirement.minimumVersion}` }] }
    }
  }
  for (const key of LIMIT_KEYS) {
    const required = requirement.minimumLimits?.[key]
    if (required !== undefined && (capability.limits?.[key] ?? -1) < required) {
      return { ok: false, reason: 'limit-insufficient', diagnostics: [{ code: 'CAPABILITY_LIMIT_INSUFFICIENT', capability: requirement.id, path: `/minimumLimits/${key}`, message: `${key} does not satisfy ${required}` }] }
    }
  }
  return { ok: true, diagnostics: [] }
}

/** Pure negotiation: performs no I/O and cannot mutate the descriptor or request. */
export function negotiateDatasetExecutionCapabilities(
  descriptor: DatasetExecutionCapabilityDescriptor,
  request: DatasetCapabilityNegotiationRequest,
): DatasetCapabilityNegotiationResult {
  const diagnostics = [...validateDatasetExecutionDescriptor(descriptor), ...validateDatasetExecutionRequest(request)]
  const capabilities = new Map(diagnostics.length ? [] : descriptor.capabilities.map(capability => [capability.id, capability]))
  const selected: DatasetExecutionCapabilityId[] = []
  const degradations: DatasetCapabilityDegradation[] = []

  if (diagnostics.length === 0) {
    for (const requirement of request.required) {
      const assessment = assessRequirement(requirement, capabilities)
      if (assessment.ok) selected.push(requirement.id)
      else diagnostics.push(...assessment.diagnostics)
    }
    for (const requirement of request.optional ?? []) {
      const assessment = assessRequirement(requirement, capabilities)
      if (assessment.ok) {
        selected.push(requirement.id)
        continue
      }
      const fallback = requirement.fallback?.find(id => isSupported(capabilities.get(id)))
      if (fallback) selected.push(fallback)
      degradations.push({
        requested: requirement.id,
        ...(fallback ? { selected: fallback } : {}),
        reason: assessment.reason!,
        changedGuarantees: fallback
          ? [`${requirement.id} replaced by ${fallback}`]
          : [`${requirement.id} omitted`],
      })
    }
  }

  return {
    contract: DATASET_EXECUTION_CONTRACT,
    accepted: diagnostics.length === 0,
    runtime: { ...descriptor?.runtime },
    selected: [...new Set(selected)],
    degradations,
    diagnostics,
  }
}
