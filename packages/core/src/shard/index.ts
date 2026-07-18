/**
 * Shard module — Knowledge Shard (.shard) import/export for fortemi-react.
 *
 * A shard is a gzip-compressed tar archive containing serialized knowledge
 * data governed by a named portability profile. Server compatibility is
 * limited to profiles proven by cross-repository conformance tests.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @source @packages/core/src/shard/schema-validator.ts
 * @created 2026-07-17
 * @agent Codex
 */

// Types
export {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
} from './types.js'
export type {
  ShardManifest,
  ShardComponent,
  KnowledgeShardProfile,
  ShardBackend,
  ShardOperation,
  ShardAuthorityStatus,
  ShardProfileRegistryEntry,
  ShardLossEntry,
  ShardCapabilityReport,
  ShardExportResult,
  ShardAttachmentReference,
  ShardBinarySource,
  ExportOptions,
  ImportOptions,
  ImportProgress,
  ImportProgressPhase,
  ImportResult,
  ImportCounts,
  ConflictStrategy,
  ShardNote,
  ShardCollection,
  ShardTag,
  ShardTemplate,
  ShardLink,
  ShardEmbeddingSet,
  ShardEmbeddingSetMember,
  ShardEmbeddingConfig,
  ShardEmbedding,
  ShardSkosScheme,
  ShardSkosConcept,
  ShardSkosRelation,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
  ShardArtifactFreshness,
  ShardGraphSource,
  ShardGraphEdge,
  ShardCommunitySet,
  ShardCommunity,
  ShardCommunityAssignment,
} from './types.js'

export {
  CORE_V1_COMPONENTS,
  createShardCapabilityReport,
  getKnowledgeShardProfileRegistry,
  profileSupportError,
} from './profile-registry.js'

// Tar + gzip
export { packTarGz, unpackTarGz } from './shard-tar.js'

// Checksums
export { sha256Hex, validateChecksums } from './checksum.js'

// Signed-shard verification (#324, ADR-014)
export {
  verifyShardSignature,
  signShard,
  isShardSigningSupported,
  sidecarBlobDigests,
  AllowlistTrustStore,
  SIGNATURE_ENTRY,
  SIGNING_ENVELOPE_VERSION,
} from './shard-signature.js'
export type {
  ShardSignatureVerdict,
  ShardSignatureEnvelope,
  ShardSigningPayload,
  ShardSigner,
  ShardTrustStore,
  TrustedKey,
  VerifyShardSignatureInput,
  SignShardInput,
} from './shard-signature.js'

// Field mapping
export {
  noteToShard,
  noteFromShard,
  linkToShard,
  urlLinkToShard,
  linkFromShard,
  collectionToShard,
  collectionFromShard,
  tagsToShard,
  templateToShard,
  embeddingSetToShard,
  embeddingSetFromShard,
  embeddingSetMemberToShard,
  embeddingConfigToShard,
  embeddingToShard,
  embeddingFromShard,
  skosSchemeToShard,
  skosConceptToShard,
  skosRelationToShard,
  noteSkosTagToShard,
  provenanceEdgeToShard,
} from './field-mapper.js'
export type { BrowserNoteExport } from './field-mapper.js'

// Export pipeline
export { exportShard, exportShardWithReport } from './shard-export.js'

// Import pipeline
export { importShard } from './shard-import.js'

// Schema validation
export {
  getKnowledgeShardContractReceipt,
  getKnowledgeShardSchema,
  validateCoreV1ShardArchive,
  validateRecordV1ShardArchive,
  validateShardArchive,
  validateShardManifest,
  validateShardComponentRecord,
  assertShardComponentRecord,
} from './schema-validator.js'
export type { ShardSchemaValidationResult } from './schema-validator.js'

// In-place reader (static-file backend, issue #189)
export { openShard } from './shard-reader.js'
export type {
  ShardReader,
  ShardReaderSource,
  ShardReaderNote,
  OpenShardOptions,
  ShardListOptions,
  ShardSearchOptions,
  ShardSearchResult,
  ShardSearchRankedNote,
  ShardSearchWeights,
  ShardNoteFull,
  StaticSemanticProvider,
  ShardComponentStore,
} from './shard-reader.js'
export { createCosineSemanticProvider } from './semantic-providers.js'
export type { VectorEntry, CosineSemanticProviderOptions } from './semantic-providers.js'
export type { ShardClusterRef, ShardLayout } from './types.js'

// Prefetch / warm API
export {
  prefetchShard,
  fromPrefetched,
  isShardPrefetched,
  getPrefetchedSha256,
  clearPrefetchedShard,
} from './prefetch.js'
export type { PrefetchOptions, PrefetchResult } from './prefetch.js'
