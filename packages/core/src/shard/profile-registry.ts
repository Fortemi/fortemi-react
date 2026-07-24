/**
 * Knowledge Shard portability profiles derived from the pinned Fortemi receipt.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @schema @packages/core/schemas/knowledge-shard/upstream-contract.json
 * @created 2026-07-17
 * @agent Codex
 */

import upstreamContract from '../../schemas/knowledge-shard/upstream-contract.json' with { type: 'json' }
import authorityReceipt from '../../schemas/knowledge-shard.schema.receipt.json' with { type: 'json' }
import authorityV2Receipt from '../../schemas/knowledge-shard-v2.schema.receipt.json' with { type: 'json' }
import fullV1ImplementationReceipt from '../../schemas/knowledge-shard-v2.implementation.receipt.json' with { type: 'json' }
import crossRepositoryReceipt from '../../schemas/knowledge-shard-v2.cross-repository.receipt.json' with { type: 'json' }
import fortemiRuntimeReceipt from '../../schemas/knowledge-shard-v2.fortemi-runtime.receipt.json' with { type: 'json' }
import type {
  KnowledgeShardProfile,
  ShardBackend,
  ShardCapabilityReport,
  ShardComponent,
  ShardLossEntry,
  ShardOperation,
  ShardProfileRegistryEntry,
} from './types.js'

export const CORE_V1_COMPONENTS = [
  'notes',
  'collections',
  'tags',
  'templates',
  'links',
] as const satisfies readonly ShardComponent[]

const ALL_PROFILES = ['core-v1', 'full-v1', 'record-v1'] as const
const FULL_V1_RECEIPT_CELLS = [
  'pglite-full-v1-to-pglite',
  'aiwg-full-v1-to-pglite',
  'pglite-full-v1-to-fortemi',
  'aiwg-full-v1-to-fortemi',
] as const
const FULL_V1_RECEIPT_COVERAGE = [
  'all-33-components',
  'all-34-count-fields',
  'attachment-bytes',
  'signatures',
  'identities',
  'relationships',
  'timestamps',
  'tombstones',
  'absent-null-empty-value',
  '768-dimensional-embeddings',
  'embedding-contract-lineage',
  'skos',
  'provenance',
  'graph-community',
  'current-minus-two',
  'current',
  'next-major-rejection',
  'malformed-input',
  'tampered-input',
  'resource-limits',
  'repeated-imports',
  'zero-mutation-on-rejection',
] as const
const FULL_V1_IMPLEMENTED = fullV1ImplementationReceipt.status === 'local-conformance-passed'
  && fullV1ImplementationReceipt.tuple.schemaVersion === '2.0.0'
  && fullV1ImplementationReceipt.tuple.profile === 'full-v1'
  && fullV1ImplementationReceipt.authority.commit === authorityV2Receipt.source.commit
  && fullV1ImplementationReceipt.authority.schemaBundleSha256 === authorityV2Receipt.schemaBundle.sha256
const FULL_V1_ADVERTISEMENT_RECEIPT_PASSED =
  crossRepositoryReceipt.status === 'delivered-cross-repository-conformance-passed'
  && crossRepositoryReceipt.tuple.schemaVersion === '2.0.0'
  && crossRepositoryReceipt.tuple.profile === 'full-v1'
  && crossRepositoryReceipt.authority.commit === authorityV2Receipt.source.commit
  && crossRepositoryReceipt.authority.contractSha256 === authorityV2Receipt.source.contractSha256
  && crossRepositoryReceipt.authority.schemaBundleSha256 === authorityV2Receipt.schemaBundle.sha256
  && crossRepositoryReceipt.reactProducer.archive.sha256
    === fullV1ImplementationReceipt.archive.sha256
  && crossRepositoryReceipt.aiwgProducer.archive.sha256
    === fortemiRuntimeReceipt.aiwgProducer.archive.sha256
  && crossRepositoryReceipt.fortemiConsumer.receipt.sha256
    === crossRepositoryReceipt.evidence.fortemiRuntimeReceiptSha256
  && crossRepositoryReceipt.fortemiConsumer.implementationCommit
    === fortemiRuntimeReceipt.implementation.commit
  && fortemiRuntimeReceipt.status === 'delivered-main-conformance-passed'
  && fortemiRuntimeReceipt.implementation.deliveredMain.conclusion === 'success'
  && fortemiRuntimeReceipt.consumer.cleanDestination === true
  && fortemiRuntimeReceipt.consumer.semanticReexport === true
  && fortemiRuntimeReceipt.consumer.zeroMutationOnFailure === true
  && crossRepositoryReceipt.cells.length === FULL_V1_RECEIPT_CELLS.length
  && crossRepositoryReceipt.cells.every((cell, index) =>
    cell.id === FULL_V1_RECEIPT_CELLS[index]
    && cell.status === 'passed'
    && JSON.stringify(cell.coverage) === JSON.stringify(FULL_V1_RECEIPT_COVERAGE))
  && crossRepositoryReceipt.advertisement.backend === 'pglite'
  && crossRepositoryReceipt.advertisement.schemaVersion === '2.0.0'
  && crossRepositoryReceipt.advertisement.profile === 'full-v1'
  && JSON.stringify(crossRepositoryReceipt.advertisement.operations)
    === JSON.stringify(['import', 'export'])
  && crossRepositoryReceipt.advertisement.enabled === true
  && crossRepositoryReceipt.claims.suiteWide === false
  && crossRepositoryReceipt.claims.recordStoreFullV1 === false

const ALL_COMPONENTS: readonly ShardComponent[] = [
  'notes',
  'collections',
  'tags',
  'templates',
  'links',
  'note_originals',
  'note_original_history',
  'note_revised_current',
  'note_revisions',
  'embedding_sets',
  'embedding_configs',
  'embedding_set_members',
  'embeddings',
  'provenance_activities',
  'named_locations',
  'provenance_locations',
  'provenance_devices',
  'provenance_records',
  'skos_schemes',
  'skos_concepts',
  'skos_labels',
  'skos_notes',
  'skos_relations',
  'skos_mapping_relations',
  'skos_scheme_memberships',
  'note_skos_tags',
  'skos_collections',
  'skos_collection_members',
  'provenance_edges',
  'community_assignments',
  'communities',
  'graph_edges',
  'graph_sources',
]

const RECORD_COMPONENTS: readonly ShardComponent[] = [
  'notes',
  'collections',
  'tags',
  'links',
]

const BACKEND_PROFILES: Record<
  ShardBackend,
  Record<ShardOperation, readonly KnowledgeShardProfile[]>
> = {
  pglite: {
    export: ['core-v1'],
    import: ['core-v1'],
  },
  'record-store': {
    export: upstreamContract.profiles['record-v1'].supported ? ['record-v1'] : [],
    import: upstreamContract.profiles['record-v1'].supported ? ['record-v1'] : [],
  },
}

const BACKEND_COMPONENTS: Record<
  ShardBackend,
  Record<ShardOperation, readonly ShardComponent[]>
> = {
  pglite: {
    export: ALL_COMPONENTS,
    import: ALL_COMPONENTS,
  },
  'record-store': {
    export: RECORD_COMPONENTS,
    import: RECORD_COMPONENTS,
  },
}

function isKnownProfile(profile: string): profile is KnowledgeShardProfile {
  return (ALL_PROFILES as readonly string[]).includes(profile)
}

function registryEntry(profile: KnowledgeShardProfile): ShardProfileRegistryEntry {
  const source = upstreamContract.profiles[profile]
  if ('supported' in source && source.supported) {
    const components = 'components' in source
      ? source.components
      : 'candidateComponents' in source
        ? source.candidateComponents
        : []
    return {
      profile,
      authority_status: 'supported',
      components: [...components] as ShardComponent[],
    }
  }
  if ('status' in source && source.status === 'candidate') {
    return {
      profile,
      authority_status: 'candidate',
      components: 'components' in source
        ? [...source.components] as ShardComponent[]
        : [],
    }
  }
  return {
    profile,
    authority_status: 'reserved',
    components: [],
  }
}

export function getKnowledgeShardProfileRegistry(): ShardProfileRegistryEntry[] {
  return ALL_PROFILES.map(registryEntry)
}

export interface CreateShardCapabilityReportInput {
  backend: ShardBackend
  operation: ShardOperation
  requestedProfile: string | null
  requestedSchemaVersion?: string | null
  declaredComponents?: readonly ShardComponent[]
  omittedComponents?: readonly ShardComponent[]
  losses?: readonly ShardLossEntry[]
}

export function createShardCapabilityReport(
  input: CreateShardCapabilityReportInput,
): ShardCapabilityReport {
  const requestedSchemaVersion = input.requestedSchemaVersion ?? null
  const requestedProfile = input.requestedProfile
  const knownProfile = requestedProfile && isKnownProfile(requestedProfile)
    ? requestedProfile
    : null
  const schema2Requested = requestedSchemaVersion === '2.0.0'
  const receiptBackedSchema2FullV1 = schema2Requested
    && requestedProfile === 'full-v1'
    && input.backend === 'pglite'
    && FULL_V1_ADVERTISEMENT_RECEIPT_PASSED
  const authorityPending = schema2Requested && !receiptBackedSchema2FullV1
  const advertisedProfiles: KnowledgeShardProfile[] = schema2Requested
    ? receiptBackedSchema2FullV1
      ? ['full-v1']
      : []
    : [...BACKEND_PROFILES[input.backend][input.operation]]
  const authorityStatus = requestedProfile === null
    ? 'unprofiled'
    : knownProfile
      ? receiptBackedSchema2FullV1
        ? 'supported'
        : authorityPending
          ? 'candidate'
          : registryEntry(knownProfile).authority_status
      : 'unknown'
  const backendSupported = knownProfile !== null
    && (receiptBackedSchema2FullV1
      || (!authorityPending && advertisedProfiles.includes(knownProfile)))
  const backendComponents = new Set(BACKEND_COMPONENTS[input.backend][input.operation])
  const profileComponents = knownProfile === 'core-v1'
    ? CORE_V1_COMPONENTS
    : BACKEND_COMPONENTS[input.backend][input.operation]
  const supportedComponents = profileComponents.filter((component) =>
    backendComponents.has(component),
  )
  const supportedComponentSet = new Set<ShardComponent>(supportedComponents)
  const declaredComponents = [...(input.declaredComponents ?? [])]
  const unsupportedComponents = declaredComponents.filter(
    (component) => !supportedComponentSet.has(component),
  )

  return {
    schema_version: 'fortemi.shard.capability-report.v1',
    backend: input.backend,
    operation: input.operation,
    requested_profile: requestedProfile,
    requested_schema_version: requestedSchemaVersion,
    authority_status: authorityStatus,
    backend_supported: backendSupported,
    portable: backendSupported,
    authority: requestedSchemaVersion === '2.0.0' ? {
      repository: authorityV2Receipt.source.repository,
      commit: authorityV2Receipt.source.commit,
      contract_sha256: authorityV2Receipt.source.contractSha256,
      contract_revision: '20',
      schema_version: authorityV2Receipt.knowledgeShard.schemaVersion,
      schema_bundle_sha256: authorityV2Receipt.schemaBundle.sha256,
    } : {
      repository: authorityReceipt.source.repository,
      commit: authorityReceipt.source.commit,
      contract_sha256: authorityReceipt.source.contractSha256,
      contract_revision: upstreamContract.contractRevision,
      schema_version: authorityReceipt.knowledgeShard.schemaVersion,
      schema_bundle_sha256: authorityReceipt.schemaBundle.sha256,
    },
    advertised_profiles: advertisedProfiles,
    supported_components: supportedComponents,
    declared_components: declaredComponents,
    unsupported_components: unsupportedComponents,
    omitted_components: [...(input.omittedComponents ?? [])],
    losses: [...(input.losses ?? [])],
  }
}

export function profileSupportError(report: ShardCapabilityReport): string | null {
  if (report.requested_profile === null) return null
  if (report.backend_supported) return null
  // Schema 2.0 paths remain callable for receipt generation and matrix testing.
  // Only the exact PGlite full-v1 tuple may advertise, and only when the
  // delivered cross-repository receipt binds both independent producers to the
  // clean Fortemi and PGlite destination evidence.
  if (report.requested_schema_version === '2.0.0') {
    if (report.requested_profile === 'core-v1' && report.backend === 'pglite') return null
    if (report.requested_profile === 'record-v1' && report.backend === 'record-store') return null
    if (
      report.requested_profile === 'full-v1'
      && report.backend === 'pglite'
      && FULL_V1_IMPLEMENTED
    ) return null
  }
  if (report.authority_status === 'reserved') {
    return `Knowledge Shard profile '${report.requested_profile}' is reserved by the pinned Fortemi authority and is not supported`
  }
  if (report.authority_status === 'candidate') {
    return `Knowledge Shard profile '${report.requested_profile}' is a candidate in the pinned Fortemi authority and is not yet supported`
  }
  if (report.authority_status === 'unknown') {
    return `Unknown Knowledge Shard profile '${report.requested_profile}'`
  }
  return `Knowledge Shard profile '${report.requested_profile}' is not supported by the ${report.backend} ${report.operation} path`
}
