import type { DatasetExecutionCapabilityDescriptor } from './dataset-execution-capabilities.js'
import { DATASET_EXECUTION_CONTRACT, DATASET_EXECUTION_SCHEMA_VERSION } from './dataset-execution-capabilities.js'

/** Descriptor for the journaled browser-local RecordStore/PGlite projection. */
export const FORTEMI_BROWSER_LOCAL_DATASET_EXECUTION_DESCRIPTOR: DatasetExecutionCapabilityDescriptor = {
  contract: DATASET_EXECUTION_CONTRACT,
  schemaVersion: DATASET_EXECUTION_SCHEMA_VERSION,
  runtime: { id: 'fortemi-browser', version: '2026.8.0', plane: 'browser-local-archive', dataClass: 'canonical', maturity: 'stable' },
  guarantees: { transaction: 'atomic-batch', isolation: 'serializable', durability: 'wal', availability: 'local-process', ordering: 'backend-cursor' },
  capabilities: [
    { id: 'ingest.full', version: '1.0.0', status: 'supported', limits: { maxBatchRecords: 1000, maxConcurrency: 1 }, evidence: ['browser-conformance'] },
    { id: 'identity.record', version: '1.0.0', status: 'supported', evidence: ['browser-conformance'] },
    { id: 'mutation.upsert', version: '1.0.0', status: 'supported', evidence: ['browser-conformance'] },
    { id: 'transaction.atomic-batch', version: '1.0.0', status: 'supported', evidence: ['browser-conformance'] },
    { id: 'ordering.deterministic', version: '1.0.0', status: 'supported', evidence: ['browser-conformance'] },
  ],
  evidence: [{ id: 'browser-conformance', kind: 'conformance-report', uri: 'fortemi://conformance/browser-local/v1' }],
}

/** Descriptor for the read-only generated Fortemi index cache. */
export const FORTEMI_STATIC_CACHE_DATASET_EXECUTION_DESCRIPTOR: DatasetExecutionCapabilityDescriptor = {
  contract: DATASET_EXECUTION_CONTRACT,
  schemaVersion: DATASET_EXECUTION_SCHEMA_VERSION,
  runtime: { id: 'fortemi-static', version: '2026.8.0', plane: 'static-cache', dataClass: 'static-cache', maturity: 'stable' },
  guarantees: { transaction: 'none', isolation: 'snapshot', durability: 'filesystem', availability: 'local-process', ordering: 'stable-identity' },
  capabilities: [
    { id: 'index.lexical', version: '1.0.0', status: 'supported', limits: { maxPageSize: 1000 }, evidence: ['static-conformance'] },
    { id: 'pagination.cursor', version: '1.0.0', status: 'supported', evidence: ['static-conformance'] },
    { id: 'ordering.deterministic', version: '1.0.0', status: 'supported', evidence: ['static-conformance'] },
  ],
  evidence: [{ id: 'static-conformance', kind: 'conformance-report', uri: 'fortemi://conformance/static-cache/v1' }],
}

/** Descriptor for a verified, immutable Knowledge Shard projection. */
export const FORTEMI_PORTABLE_SHARD_DATASET_EXECUTION_DESCRIPTOR: DatasetExecutionCapabilityDescriptor = {
  contract: DATASET_EXECUTION_CONTRACT,
  schemaVersion: DATASET_EXECUTION_SCHEMA_VERSION,
  runtime: { id: 'fortemi-shard', version: '2026.8.0', plane: 'portable-shard', dataClass: 'portable-projection', maturity: 'stable' },
  guarantees: { transaction: 'none', isolation: 'snapshot', durability: 'filesystem', availability: 'local-process', ordering: 'stable-identity' },
  capabilities: [
    { id: 'schema.inspect', version: '1.0.0', status: 'supported', evidence: ['shard-conformance'] },
    { id: 'lineage.dataset', version: '1.0.0', status: 'experimental', evidence: ['shard-conformance'] },
    { id: 'ordering.deterministic', version: '1.0.0', status: 'supported', evidence: ['shard-conformance'] },
  ],
  evidence: [{ id: 'shard-conformance', kind: 'conformance-report', uri: 'fortemi://conformance/knowledge-shard/v1' }],
}
