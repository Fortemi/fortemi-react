import { computeHash } from './hash.js'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  DATASET_EXECUTION_CONTRACT,
  negotiateDatasetExecutionCapabilities,
  type DatasetCapabilityDegradation,
  type DatasetCapabilityDiagnostic,
  type DatasetCapabilityRequirement,
  type DatasetExecutionCapabilityDescriptor,
  type DatasetExecutionCapabilityId,
} from './dataset-execution-capabilities.js'

export const DATASET_MATERIALIZATION_CONTRACT = 'fortemi.dataset-materialization-profile/v1' as const
export const DATASET_MATERIALIZATION_SCHEMA_VERSION = '1.0.0' as const

export const DATASET_MATERIALIZATION_KINDS = [
  'chunking', 'lexical', 'vector', 'hybrid', 'rerank',
  'entity-relationship-extraction', 'graph-retrieval', 'community',
] as const

export type DatasetMaterializationKind = typeof DATASET_MATERIALIZATION_KINDS[number]
export type DatasetMaterializationOperation = 'build' | 'query'
export type DatasetDeterminismClass = 'deterministic' | 'seeded' | 'nondeterministic'
export type DatasetPrivacyBoundary = 'chunking' | 'model-invocation' | 'index-persistence'
export type DatasetProfileStatus = 'supported' | 'experimental' | 'unsupported'
export type DatasetDigest = `sha256:${string}`

export interface DatasetImplementationIdentity {
  id: string
  version: string
  digest: DatasetDigest
  model?: { id: string; version: string; digest: DatasetDigest }
}

export interface DatasetMaterializationProfile {
  contract: typeof DATASET_MATERIALIZATION_CONTRACT
  schemaVersion: string
  id: string
  version: string
  kind: DatasetMaterializationKind
  status: DatasetProfileStatus
  operations: DatasetMaterializationOperation[]
  inputTypes: string[]
  implementation: DatasetImplementationIdentity
  configurationSchema: Record<string, unknown>
  requiredRuntimeCapabilities: DatasetCapabilityRequirement[]
  optionalRuntimeCapabilities?: Array<DatasetCapabilityRequirement & { fallback?: DatasetExecutionCapabilityId[] }>
  determinism: { class: DatasetDeterminismClass; seedRequired?: boolean }
  privacy: {
    behavior: 'local-only' | 'policy-filtered-external'
    authorizationRequired: true
    filtersBefore: DatasetPrivacyBoundary[]
  }
  resourceLimits: {
    maxInputBytes: number
    maxRecords: number
    maxConcurrency: number
    maxMemoryBytes?: number
    timeoutMs?: number
  }
  output: { dataClass: 'regenerable-index'; canonicalMutation: false }
}

export interface DatasetProfileNegotiationRequest {
  operation: DatasetMaterializationOperation
  profile: DatasetMaterializationProfile
  runtime: DatasetExecutionCapabilityDescriptor
  fallbackProfiles?: DatasetMaterializationProfile[]
}

export interface DatasetProfileNegotiationResult {
  accepted: boolean
  requestedProfile: string
  selectedProfile?: string
  runtime: DatasetExecutionCapabilityDescriptor['runtime']
  degraded: boolean
  degradations: DatasetCapabilityDegradation[]
  diagnostics: Array<DatasetCapabilityDiagnostic | {
    code: 'PROFILE_INVALID' | 'OPERATION_UNSUPPORTED' | 'PROFILE_UNSUPPORTED' | 'NO_FALLBACK_PROFILE'
    message: string
    path?: string
  }>
}

export interface DatasetSourceRecord {
  logicalId: string
  revision: string
  digest: DatasetDigest
  content: unknown
  locator?: string
}

export interface DatasetSourceSnapshot {
  datasetId: string
  revision: string
  schemaId: string
  schemaVersion: string
  schemaDigest: DatasetDigest
  sourceDigests: DatasetDigest[]
  records: DatasetSourceRecord[]
}

export interface DatasetPrivacyDecision {
  policyId: string
  policyVersion: string
  policyDigest: DatasetDigest
  allowedRecordDigests: DatasetDigest[]
  deniedRecordDigests: DatasetDigest[]
  evaluatedAt: string
}

export interface DatasetMaterializationArtifact {
  kind: 'chunk' | 'lexical-entry' | 'vector' | 'reranked-hit' | 'entity' | 'relationship' | 'graph-result' | 'community'
  logicalId: string
  sourceRecordDigests: DatasetDigest[]
  digest: DatasetDigest
  payload?: unknown
  score?: number
}

export interface DatasetMeasuredResources {
  elapsedMs: number
  inputBytes: number
  peakMemoryBytes?: number
  modelInvocations: number
  persistedBytes: number
}

export interface DatasetMaterializationRequest {
  runId: string
  processingRunId: string
  snapshot: DatasetSourceSnapshot
  profile: DatasetMaterializationProfile
  configuration: unknown
  operation: 'build'
  mode: 'full' | 'incremental'
  affected?: { sourceRevisions: string[]; recordDigests: DatasetDigest[]; chunkDigests: DatasetDigest[] }
}

export interface DatasetMaterializationReceipt {
  contract: typeof DATASET_MATERIALIZATION_CONTRACT
  schemaVersion: string
  receiptId: string
  runId: string
  processingRunId: string
  source: {
    datasetId: string
    revision: string
    digests: DatasetDigest[]
  }
  schema: { id: string; version: string; digest: DatasetDigest }
  profile: {
    id: string
    version: string
    digest: DatasetDigest
    configurationDigest: DatasetDigest
    implementation: DatasetImplementationIdentity
  }
  runtime: DatasetExecutionCapabilityDescriptor['runtime']
  negotiation: Pick<DatasetProfileNegotiationResult, 'requestedProfile' | 'selectedProfile' | 'degraded' | 'degradations'>
  mode: 'full' | 'incremental'
  affected: { sourceRevisions: string[]; recordDigests: DatasetDigest[]; chunkDigests: DatasetDigest[] }
  output: { counts: Record<string, number>; digests: DatasetDigest[]; aggregateDigest: DatasetDigest }
  privacy: DatasetPrivacyDecision
  resources: DatasetMeasuredResources
  createdAt: string
}

export interface DatasetRetrievalRequest {
  queryId: string
  operation: 'query'
  profile: DatasetMaterializationProfile
  query: unknown
  limit: number
}

export interface DatasetRetrievalResponse {
  contract: typeof DATASET_MATERIALIZATION_CONTRACT
  schemaVersion: string
  queryId: string
  requestedProfile: string
  actualProfile: string
  actualBackend: { id: string; version: string; plane: DatasetExecutionCapabilityDescriptor['runtime']['plane'] }
  degraded: boolean
  fallbackReason?: string
  scoreSemantics: { implementationScoped: true; comparableAcrossImplementations: false }
  results: DatasetMaterializationArtifact[]
  receiptId: string
}

export interface DatasetBenchmarkEvidence {
  contract: typeof DATASET_MATERIALIZATION_CONTRACT
  schemaVersion: string
  evidenceType: 'benchmark'
  benchmarkId: string
  corpus: { id: string; revision: string; digest: DatasetDigest; records: number; bytes: number }
  hardware: { runtime: string; cpu: string; memoryBytes: number; accelerator?: string }
  implementation: DatasetImplementationIdentity
  profile: { id: string; version: string; digest: DatasetDigest; configurationDigest: DatasetDigest }
  correctness: { passed: boolean; suite: string; receiptDigest: DatasetDigest }
  freshness: { measuredAt: string; sourceRevision: string }
  measurements: Array<{ name: string; value: number; unit: 'ms' | 'bytes' | 'records/s' | 'queries/s' }>
  claims: { corpusScoped: true; universalScaleLimit: false }
}

export interface DatasetMaterializationAdapter {
  readonly backend: { id: string; version: string }
  materialize(input: Readonly<{
    snapshot: DatasetSourceSnapshot
    profile: DatasetMaterializationProfile
    configuration: unknown
    mode: 'full' | 'incremental'
    affected: DatasetMaterializationReceipt['affected']
  }>): Promise<{ artifacts: DatasetMaterializationArtifact[]; resources: DatasetMeasuredResources }>
  retrieve?(input: Readonly<{ request: DatasetRetrievalRequest; profile: DatasetMaterializationProfile }>): Promise<DatasetMaterializationArtifact[]>
}

export type DatasetRecordAuthorizer = (record: Readonly<DatasetSourceRecord>) => boolean | Promise<boolean>

export class DatasetMaterializationError extends Error {
  constructor(public readonly code: 'NEGOTIATION_FAILED' | 'PROFILE_INVALID' | 'CONFIGURATION_INVALID' | 'RESOURCE_LIMIT_EXCEEDED' | 'ADAPTER_MISMATCH', message: string) {
    super(message)
    this.name = 'DatasetMaterializationError'
  }
}

const encoder = new TextEncoder()

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

export function digestDatasetMaterializationValue(value: unknown): DatasetDigest {
  return computeHash(encoder.encode(canonicalJson(value))) as DatasetDigest
}

function profileDiagnostics(profile: DatasetMaterializationProfile): DatasetProfileNegotiationResult['diagnostics'] {
  const diagnostics: DatasetProfileNegotiationResult['diagnostics'] = []
  const requiredBoundaries: DatasetPrivacyBoundary[] = ['chunking', 'model-invocation', 'index-persistence']
  if (profile.contract !== DATASET_MATERIALIZATION_CONTRACT || !/^1\./.test(profile.schemaVersion)) {
    diagnostics.push({ code: 'PROFILE_INVALID', path: '/contract', message: 'Unsupported profile contract or schema major' })
  }
  if (profile.output.dataClass !== 'regenerable-index' || profile.output.canonicalMutation !== false) {
    diagnostics.push({ code: 'PROFILE_INVALID', path: '/output', message: 'Profiles may only produce derived, regenerable artifacts' })
  }
  for (const boundary of requiredBoundaries) {
    if (!profile.privacy.filtersBefore.includes(boundary)) {
      diagnostics.push({ code: 'PROFILE_INVALID', path: '/privacy/filtersBefore', message: `Privacy filtering must precede ${boundary}` })
    }
  }
  if (profile.determinism.class === 'seeded' && profile.determinism.seedRequired !== true) {
    diagnostics.push({ code: 'PROFILE_INVALID', path: '/determinism/seedRequired', message: 'Seeded profiles must require a seed' })
  }
  if (profile.resourceLimits.maxInputBytes < 0 || profile.resourceLimits.maxRecords < 0 || profile.resourceLimits.maxConcurrency < 1) {
    diagnostics.push({ code: 'PROFILE_INVALID', path: '/resourceLimits', message: 'Resource limits must be non-negative and concurrency must be positive' })
  }
  return diagnostics
}

/** Negotiate the profile and its required/optional runtime capabilities before any build or query I/O. */
export function negotiateDatasetMaterializationProfile(request: DatasetProfileNegotiationRequest): DatasetProfileNegotiationResult {
  const candidates = [request.profile, ...(request.fallbackProfiles ?? [])]
  const primaryDiagnostics = profileDiagnostics(request.profile)
  if (!request.profile.operations.includes(request.operation)) {
    primaryDiagnostics.push({ code: 'OPERATION_UNSUPPORTED', path: '/operations', message: `${request.operation} is not supported by ${request.profile.id}` })
  }
  if (request.profile.status === 'unsupported') {
    primaryDiagnostics.push({ code: 'PROFILE_UNSUPPORTED', path: '/status', message: `${request.profile.id} is unsupported` })
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    const diagnostics = index === 0 ? primaryDiagnostics : profileDiagnostics(candidate)
    if (!candidate.operations.includes(request.operation) || candidate.status === 'unsupported' || diagnostics.length > 0) continue
    const capability = negotiateDatasetExecutionCapabilities(request.runtime, {
      contract: DATASET_EXECUTION_CONTRACT,
      required: candidate.requiredRuntimeCapabilities,
      optional: candidate.optionalRuntimeCapabilities,
    })
    if (capability.accepted) {
      const fallback = index > 0
      return {
        accepted: true,
        requestedProfile: request.profile.id,
        selectedProfile: candidate.id,
        runtime: { ...request.runtime.runtime },
        degraded: fallback || capability.degradations.length > 0,
        degradations: capability.degradations,
        diagnostics: fallback ? primaryDiagnostics : [],
      }
    }
    if (index === 0) primaryDiagnostics.push(...capability.diagnostics)
  }

  return {
    accepted: false,
    requestedProfile: request.profile.id,
    runtime: { ...request.runtime.runtime },
    degraded: false,
    degradations: [],
    diagnostics: [...primaryDiagnostics, { code: 'NO_FALLBACK_PROFILE', message: `No compatible ${request.operation} profile is available` }],
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function assertResources(snapshot: DatasetSourceSnapshot, profile: DatasetMaterializationProfile): number {
  const inputBytes = encoder.encode(canonicalJson(snapshot.records)).byteLength
  if (snapshot.records.length > profile.resourceLimits.maxRecords || inputBytes > profile.resourceLimits.maxInputBytes) {
    throw new DatasetMaterializationError('RESOURCE_LIMIT_EXCEEDED', `Input exceeds profile ${profile.id} resource limits`)
  }
  return inputBytes
}

function stableArtifacts(artifacts: DatasetMaterializationArtifact[]): DatasetMaterializationArtifact[] {
  return [...artifacts].sort((left, right) => {
    const score = (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY)
    return score || left.logicalId.localeCompare(right.logicalId) || left.digest.localeCompare(right.digest)
  })
}

/**
 * Runs authorization before the adapter sees text, model inputs, or persistence inputs.
 * The adapter receives a detached immutable snapshot and can only return derived artifacts.
 */
export async function executeDatasetMaterialization(
  request: DatasetMaterializationRequest,
  runtime: DatasetExecutionCapabilityDescriptor,
  adapter: DatasetMaterializationAdapter,
  authorize: DatasetRecordAuthorizer,
  options: { fallbackProfiles?: DatasetMaterializationProfile[]; now?: () => string } = {},
): Promise<{ artifacts: DatasetMaterializationArtifact[]; receipt: DatasetMaterializationReceipt }> {
  const negotiation = negotiateDatasetMaterializationProfile({ operation: 'build', profile: request.profile, runtime, fallbackProfiles: options.fallbackProfiles })
  if (!negotiation.accepted || !negotiation.selectedProfile) {
    throw new DatasetMaterializationError('NEGOTIATION_FAILED', negotiation.diagnostics.map(item => item.message).join('; '))
  }
  const selected = [request.profile, ...(options.fallbackProfiles ?? [])].find(item => item.id === negotiation.selectedProfile)!
  try {
    const validateConfiguration = new Ajv2020({ strict: true, allErrors: true }).compile(selected.configurationSchema)
    if (!validateConfiguration(request.configuration)) {
      throw new DatasetMaterializationError('CONFIGURATION_INVALID', `Configuration does not satisfy ${selected.id}: ${JSON.stringify(validateConfiguration.errors)}`)
    }
  } catch (error) {
    if (error instanceof DatasetMaterializationError) throw error
    throw new DatasetMaterializationError('PROFILE_INVALID', `Invalid configuration schema for ${selected.id}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const inputBytes = assertResources(request.snapshot, selected)
  const allowed: DatasetSourceRecord[] = []
  const denied: DatasetDigest[] = []
  for (const record of request.snapshot.records) {
    if (await authorize(Object.freeze(clone(record)))) allowed.push(clone(record))
    else denied.push(record.digest)
  }
  const privacy: DatasetPrivacyDecision = {
    policyId: 'caller-authorization', policyVersion: '1.0.0',
    policyDigest: digestDatasetMaterializationValue({ policy: 'caller-authorization', version: '1.0.0' }),
    allowedRecordDigests: allowed.map(item => item.digest).sort(), deniedRecordDigests: denied.sort(),
    evaluatedAt: (options.now ?? (() => new Date().toISOString()))(),
  }
  const affected = request.affected ?? {
    sourceRevisions: [request.snapshot.revision],
    recordDigests: allowed.map(item => item.digest).sort(),
    chunkDigests: [],
  }
  const detachedSnapshot = clone({ ...request.snapshot, records: allowed })
  const result = await adapter.materialize(Object.freeze({
    snapshot: detachedSnapshot,
    profile: clone(selected),
    configuration: clone(request.configuration),
    mode: request.mode,
    affected: clone(affected),
  }))
  const artifacts = selected.determinism.class === 'deterministic' ? stableArtifacts(result.artifacts) : clone(result.artifacts)
  const digests = artifacts.map(item => item.digest).sort()
  const counts = artifacts.reduce<Record<string, number>>((all, item) => {
    all[item.kind] = (all[item.kind] ?? 0) + 1
    return all
  }, {})
  const profileDigest = digestDatasetMaterializationValue(selected)
  const receiptBase = {
    contract: DATASET_MATERIALIZATION_CONTRACT,
    schemaVersion: DATASET_MATERIALIZATION_SCHEMA_VERSION,
    runId: request.runId,
    processingRunId: request.processingRunId,
    source: { datasetId: request.snapshot.datasetId, revision: request.snapshot.revision, digests: [...request.snapshot.sourceDigests].sort() },
    schema: { id: request.snapshot.schemaId, version: request.snapshot.schemaVersion, digest: request.snapshot.schemaDigest },
    profile: { id: selected.id, version: selected.version, digest: profileDigest, configurationDigest: digestDatasetMaterializationValue(request.configuration), implementation: clone(selected.implementation) },
    runtime: clone(runtime.runtime),
    negotiation: { requestedProfile: negotiation.requestedProfile, selectedProfile: negotiation.selectedProfile, degraded: negotiation.degraded, degradations: clone(negotiation.degradations) },
    mode: request.mode,
    affected: clone(affected),
    output: { counts, digests, aggregateDigest: digestDatasetMaterializationValue(digests) },
    privacy,
    resources: { ...clone(result.resources), inputBytes },
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  }
  const receipt: DatasetMaterializationReceipt = {
    ...receiptBase,
    receiptId: digestDatasetMaterializationValue(receiptBase),
  }
  return { artifacts, receipt }
}

export async function executeDatasetRetrieval(
  request: DatasetRetrievalRequest,
  runtime: DatasetExecutionCapabilityDescriptor,
  adapter: DatasetMaterializationAdapter,
  receiptId: string,
  fallbackProfiles: DatasetMaterializationProfile[] = [],
): Promise<DatasetRetrievalResponse> {
  const negotiation = negotiateDatasetMaterializationProfile({ operation: 'query', profile: request.profile, runtime, fallbackProfiles })
  if (!negotiation.accepted || !negotiation.selectedProfile) throw new DatasetMaterializationError('NEGOTIATION_FAILED', negotiation.diagnostics.map(item => item.message).join('; '))
  if (!adapter.retrieve) throw new DatasetMaterializationError('ADAPTER_MISMATCH', `Backend ${adapter.backend.id} cannot query`)
  const selected = [request.profile, ...fallbackProfiles].find(item => item.id === negotiation.selectedProfile)!
  const results = await adapter.retrieve(Object.freeze({ request: clone(request), profile: clone(selected) }))
  return {
    contract: DATASET_MATERIALIZATION_CONTRACT,
    schemaVersion: DATASET_MATERIALIZATION_SCHEMA_VERSION,
    queryId: request.queryId,
    requestedProfile: request.profile.id,
    actualProfile: selected.id,
    actualBackend: { ...adapter.backend, plane: runtime.runtime.plane },
    degraded: negotiation.degraded,
    ...(negotiation.degraded ? { fallbackReason: negotiation.diagnostics.map(item => item.message).join('; ') || 'optional capability degradation' } : {}),
    scoreSemantics: { implementationScoped: true, comparableAcrossImplementations: false },
    results: selected.determinism.class === 'deterministic' ? stableArtifacts(results).slice(0, request.limit) : clone(results).slice(0, request.limit),
    receiptId,
  }
}

export interface DatasetIncrementalParityResult {
  equivalent: boolean
  mismatches: Array<'identities' | 'chunks' | 'relationships' | 'communities' | 'digests' | 'ordering'>
}

/** Compares every correctness dimension required before incremental output may replace a full rebuild. */
export function compareDatasetIncrementalParity(
  full: readonly DatasetMaterializationArtifact[],
  incremental: readonly DatasetMaterializationArtifact[],
): DatasetIncrementalParityResult {
  const select = (items: readonly DatasetMaterializationArtifact[], kind?: DatasetMaterializationArtifact['kind']) =>
    items.filter(item => !kind || item.kind === kind).map(item => `${item.logicalId}:${item.digest}`).sort()
  const mismatches: DatasetIncrementalParityResult['mismatches'] = []
  if (canonicalJson(select(full)) !== canonicalJson(select(incremental))) mismatches.push('identities')
  if (canonicalJson(select(full, 'chunk')) !== canonicalJson(select(incremental, 'chunk'))) mismatches.push('chunks')
  if (canonicalJson(select(full, 'relationship')) !== canonicalJson(select(incremental, 'relationship'))) mismatches.push('relationships')
  if (canonicalJson(select(full, 'community')) !== canonicalJson(select(incremental, 'community'))) mismatches.push('communities')
  if (canonicalJson(full.map(item => item.digest).sort()) !== canonicalJson(incremental.map(item => item.digest).sort())) mismatches.push('digests')
  const order = (items: readonly DatasetMaterializationArtifact[]) => items.map(item => `${item.logicalId}:${item.digest}`)
  if (canonicalJson(order(full)) !== canonicalJson(order(incremental))) mismatches.push('ordering')
  return { equivalent: mismatches.length === 0, mismatches }
}

/** Benchmark evidence is publishable only after correctness and source-binding gates pass. */
export function validateDatasetBenchmarkEvidence(evidence: DatasetBenchmarkEvidence): string[] {
  const errors: string[] = []
  if (evidence.contract !== DATASET_MATERIALIZATION_CONTRACT || !/^1\./.test(evidence.schemaVersion)) errors.push('unsupported benchmark contract')
  if (!evidence.correctness.passed) errors.push('correctness suite did not pass')
  if (evidence.freshness.sourceRevision !== evidence.corpus.revision) errors.push('benchmark evidence is stale')
  if (!evidence.claims.corpusScoped || evidence.claims.universalScaleLimit) errors.push('benchmark claims must remain corpus-scoped')
  if (evidence.measurements.length === 0) errors.push('benchmark has no measurements')
  return errors
}
