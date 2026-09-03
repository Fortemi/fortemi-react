import {
  DATASET_EXECUTION_CONTRACT,
  DATASET_INGEST_CONTRACT,
} from '@fortemi/core'
import type { DatasetExecutionDataClass, DatasetExecutionPlane } from '@fortemi/core'
import type { DatasetConfigSchema, DatasetFreshnessStatus, DatasetRunProgress } from './types.js'

export const datasetConnectorFixtureSchema: DatasetConfigSchema = {
  $id: 'https://fortemi.dev/schemas/dataset-connector-fixture/v1',
  version: '1.0.0',
  type: 'object',
  title: 'Research corpus',
  description: 'Connect a bounded research corpus using a saved credential reference.',
  required: ['mode', 'endpoint'],
  properties: {
    mode: { type: 'string', title: 'Source mode', enum: ['local', 'remote'], default: 'local', description: 'Where source records are discovered.' },
    endpoint: { type: 'string', title: 'Endpoint', format: 'uri', minLength: 8, description: 'Canonical source endpoint.' },
    credentialReference: { type: 'string', title: 'Saved credential', format: 'credential-reference', writeOnly: true, minLength: 3, description: 'Opaque reference; its value is never displayed.' },
    batchSize: { type: 'integer', title: 'Batch size', default: 100, minimum: 1, maximum: 1000, description: 'Maximum records read per page.' },
  },
  allOf: [{ if: { properties: { mode: { const: 'remote' } }, required: ['mode'] }, then: { required: ['credentialReference'] } }],
}

const storyStates = [
  ['canonical', 'online', 'server-process', 'canonical'],
  ['canonical', 'online', 'live-remote-persistence', 'remote-persistence'],
  ['derived', 'online', 'browser-local-archive', 'regenerable-index'],
  ['cached', 'online', 'static-cache', 'static-cache'],
  ['stale', 'online', 'static-cache', 'static-cache'],
  ['degraded', 'online', 'server-process', 'canonical'],
  ['unverifiable', 'online', 'portable-shard', 'portable-projection'],
  ['canonical', 'offline-cold', 'browser-local-archive', 'canonical'],
  ['cached', 'offline-warm', 'static-cache', 'static-cache'],
] as const

export const datasetStatusStoryFixtures: Readonly<Record<string, DatasetFreshnessStatus>> = Object.freeze(Object.fromEntries(storyStates.map(([artifactState, availability, plane, dataClass]) => {
  const key = plane === 'live-remote-persistence' ? 'live-server' : availability.startsWith('offline') ? availability : artifactState
  return [key, {
    scope: { tenant: 'fixture', dataset: key, sourceBinding: 'source', stream: 'default' },
    freshness: artifactState === 'stale' ? 'stale' : 'current',
    availability,
    artifactState,
    ...(artifactState === 'cached' || artifactState === 'stale' ? { cacheAgeSeconds: 300 } : {}),
    ...(artifactState === 'degraded' ? { changedGuarantees: ['vector search replaced by lexical search'] } : {}),
    lastAttempt: { runId: `run-${key}`, state: artifactState === 'degraded' ? 'degraded' : 'committed', verification: artifactState === 'unverifiable' ? 'failed' : 'verified', idempotencyKey: `key-${key}` },
    capabilityDescriptor: {
      contract: DATASET_EXECUTION_CONTRACT,
      schemaVersion: '1.0.0',
      runtime: { id: `fixture-${key}`, version: '1.0.0', plane: plane as DatasetExecutionPlane, dataClass: dataClass as DatasetExecutionDataClass, maturity: 'experimental' },
      guarantees: { transaction: 'none', isolation: 'none', durability: 'memory', availability: 'local-process', ordering: 'stable-identity' },
      capabilities: [], evidence: [],
    },
  } satisfies DatasetFreshnessStatus]
})))

export const datasetTerminalRunStories: Readonly<Record<'rejected' | 'cancelled' | 'failed', DatasetRunProgress>> = Object.freeze({
  rejected: { runId: 'run-rejected', lifecycle: 'degraded', stage: 'validation', observed: 3, total: 3, accepted: 2, rejected: 1, retryClass: 'after-change', verification: 'verified', diagnostics: [] },
  cancelled: { runId: 'run-cancelled', lifecycle: 'cancelled', stage: 'cancelled', observed: 2, accepted: 2, rejected: 0, retryClass: 'immediate', verification: 'pending', diagnostics: [] },
  failed: { runId: 'run-failed', lifecycle: 'failed', stage: 'commit', observed: 2, accepted: 0, rejected: 0, retryClass: 'backoff', verification: 'failed', diagnostics: [] },
})

// Compile-time guard that the fixture stays tied to the generic ingest contract.
export const datasetFixtureContract = DATASET_INGEST_CONTRACT
