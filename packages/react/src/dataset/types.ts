import type {
  DatasetExecutionCapabilityDescriptor,
  DatasetRunStatus,
  LineageTraversalRequest,
  LineageTraversalResult,
} from '@fortemi/core'

export type DatasetJsonPrimitive = string | number | boolean | null

export interface DatasetConfigSchema {
  $id: string
  version: string
  type: 'object'
  title?: string
  description?: string
  required?: string[]
  properties: Record<string, DatasetConfigProperty>
  allOf?: Array<{
    if: { properties: Record<string, { const: DatasetJsonPrimitive }>; required?: string[] }
    then: { required?: string[] }
  }>
}

export interface DatasetConfigProperty {
  type: 'string' | 'number' | 'integer' | 'boolean'
  title?: string
  description?: string
  default?: DatasetJsonPrimitive
  enum?: DatasetJsonPrimitive[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: 'credential-reference' | 'password' | 'uri' | string
  writeOnly?: boolean
}

export type DatasetConfiguration = Readonly<Record<string, DatasetJsonPrimitive>>

export interface DatasetDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  summary: string
  remediation?: string
  retryClass: 'never' | 'immediate' | 'backoff' | 'after-change'
}

export class DatasetWorkflowError extends Error {
  constructor(public readonly diagnostic: DatasetDiagnostic) {
    super(diagnostic.code)
    this.name = 'DatasetWorkflowError'
  }
}

export type DatasetCheckStage =
  | 'configuration' | 'authorization' | 'reachability'
  | 'discovery' | 'capability' | 'policy'

export interface DatasetCheckResult {
  stage: DatasetCheckStage
  status: 'passed' | 'warning' | 'failed' | 'not-run'
  diagnostics: DatasetDiagnostic[]
}

export interface DatasetPreviewEstimate {
  records?: number
  bytes?: number
  networkBytes?: number
  storageBytes?: number
}

export interface DatasetPreview {
  bounded: true
  sideEffectFree: true
  limit: number
  datasets: Array<{
    id: string
    streams: Array<{ id: string; fields: string[] }>
    inferredSchema: 'not-requested' | 'candidate' | 'validated'
    redactedSamples: ReadonlyArray<Readonly<Record<string, DatasetJsonPrimitive>>>
  }>
  estimate: DatasetPreviewEstimate
  unsupportedCapabilities: string[]
}

export interface DatasetPlan {
  id: string
  digest: string
  sourceRevision: string
  sourceDigest: string
  configurationDigest: string
  capabilities: string[]
  transforms: string[]
  locality: string
  outboundHosts: string[]
  privacy: string
  rights: string
  retention: string
  estimatedWrites: number
  estimatedCost?: string
  fallbackBehavior: string
  reconciliation: {
    destructive: boolean
    estimatedDeletes: number
    confirmationThreshold: number
  }
}

export interface DatasetRunProgress {
  runId: string
  lifecycle: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'committed' | 'failed' | 'degraded'
  stage: string
  observed: number
  total?: number
  lastCheckpoint?: string
  accepted: number
  rejected: number
  retryClass: DatasetDiagnostic['retryClass']
  verification: 'pending' | 'verified' | 'failed'
  diagnostics: DatasetDiagnostic[]
}

export interface DatasetFreshnessStatus extends DatasetRunStatus {
  availability: 'online' | 'offline-cold' | 'offline-warm'
  artifactState: 'canonical' | 'derived' | 'cached' | 'stale' | 'degraded' | 'unverifiable'
  cacheAgeSeconds?: number
  changedGuarantees?: string[]
  capabilityDescriptor: DatasetExecutionCapabilityDescriptor
}

export interface DatasetRejection {
  locator?: string
  logicalIdDigest: string
  code: string
  reason: string
}

export interface DatasetWorkflowApi {
  check(configuration: DatasetConfiguration, signal: AbortSignal): Promise<DatasetCheckResult[]>
  preview(configuration: DatasetConfiguration, limit: number, signal: AbortSignal): Promise<DatasetPreview>
  createPlan(configuration: DatasetConfiguration, preview: DatasetPreview, signal: AbortSignal): Promise<DatasetPlan>
  verifyPlanDigest(plan: DatasetPlan, signal: AbortSignal): Promise<boolean>
  approvePlan(plan: DatasetPlan, confirmation: string | undefined, signal: AbortSignal): Promise<DatasetRunProgress>
  cancelRun(runId: string, signal: AbortSignal): Promise<DatasetRunProgress>
  retryRun(runId: string, signal: AbortSignal): Promise<DatasetRunProgress>
  getStatus(signal: AbortSignal): Promise<DatasetFreshnessStatus>
  getRejections(runId: string, signal: AbortSignal): Promise<DatasetRejection[]>
  traverseLineage(request: LineageTraversalRequest, signal: AbortSignal): Promise<LineageTraversalResult>
}

export interface DatasetWorkflowSnapshot {
  phase: 'configure' | 'checking' | 'checked' | 'previewing' | 'previewed' | 'planning' | 'review' | 'approving' | 'running' | 'complete' | 'failed'
  configuration: DatasetConfiguration
  validation: Readonly<Record<string, string>>
  checkResults?: readonly DatasetCheckResult[]
  preview?: DatasetPreview
  plan?: DatasetPlan
  run?: DatasetRunProgress
  status?: DatasetFreshnessStatus
  rejections?: readonly DatasetRejection[]
  diagnostic?: DatasetDiagnostic
}
