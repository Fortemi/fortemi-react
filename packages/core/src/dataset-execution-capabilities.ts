/**
 * Language-neutral dataset execution capability negotiation contract.
 *
 * A descriptor reports demonstrated behavior for one concrete runtime. It is
 * not inferred from a package/backend name and it does not establish liveness.
 */

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

const ID_SET = new Set<string>(DATASET_EXECUTION_CAPABILITY_IDS)
const LIMIT_KEYS = ['maxInputBytes', 'maxRecordBytes', 'maxBatchRecords', 'maxConcurrency', 'maxPageSize', 'maxTraversalDepth'] as const

function major(version: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  return match ? Number(match[1]) : null
}

function compareVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1
  }
  return 0
}

function isSupported(capability: DatasetCapabilityDeclaration | undefined): capability is DatasetCapabilityDeclaration {
  return capability !== undefined && capability.status !== 'unsupported'
}

export function validateDatasetExecutionDescriptor(descriptor: DatasetExecutionCapabilityDescriptor): DatasetCapabilityDiagnostic[] {
  const diagnostics: DatasetCapabilityDiagnostic[] = []
  if (descriptor.contract !== DATASET_EXECUTION_CONTRACT) {
    diagnostics.push({ code: 'CONTRACT_MAJOR_UNSUPPORTED', path: '/contract', message: `Unsupported contract ${String(descriptor.contract)}` })
  }
  if (major(descriptor.schemaVersion) !== 1) {
    diagnostics.push({ code: 'SCHEMA_VERSION_UNSUPPORTED', path: '/schemaVersion', message: `Unsupported descriptor schema version ${descriptor.schemaVersion}` })
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
        diagnostics.push({ code: 'DESCRIPTOR_INVALID', capability: capability.id, path: `/capabilities/${index}/evidence`, message: `Unknown evidence ${evidenceId}` })
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

function assessRequirement(
  requirement: DatasetCapabilityRequirement,
  capabilities: Map<DatasetExecutionCapabilityId, DatasetCapabilityDeclaration>,
): { ok: boolean; reason?: DatasetCapabilityDegradation['reason']; diagnostics: DatasetCapabilityDiagnostic[] } {
  const capability = capabilities.get(requirement.id)
  if (!isSupported(capability)) {
    return { ok: false, reason: 'unsupported', diagnostics: [{ code: 'REQUIRED_CAPABILITY_MISSING', capability: requirement.id, message: `Capability ${requirement.id} is unsupported` }] }
  }
  if (requirement.minimumVersion) {
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
  const diagnostics = validateDatasetExecutionDescriptor(descriptor)
  if (request.contract !== DATASET_EXECUTION_CONTRACT) {
    diagnostics.push({ code: 'CONTRACT_MAJOR_UNSUPPORTED', path: '/contract', message: `Unsupported request contract ${String(request.contract)}` })
  }
  const capabilities = new Map(descriptor.capabilities.map(capability => [capability.id, capability]))
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
    runtime: { ...descriptor.runtime },
    selected: [...new Set(selected)],
    degradations,
    diagnostics,
  }
}
