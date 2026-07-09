/**
 * Shard module — Knowledge Shard (.shard) import/export for fortemi-react.
 *
 * A shard is a gzip-compressed tar archive containing serialized knowledge
 * data with 100% format compatibility with the Rust/PostgreSQL fortemi server.
 */

// Types
export {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
} from './types.js'
export type {
  ShardManifest,
  ShardComponent,
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
  ShardLink,
  ShardEmbeddingSet,
  ShardEmbeddingSetMember,
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

// Tar + gzip
export { packTarGz, unpackTarGz } from './shard-tar.js'

// Checksums
export { sha256Hex, validateChecksums } from './checksum.js'

// Field mapping
export {
  noteToShard,
  noteFromShard,
  linkToShard,
  linkFromShard,
  collectionToShard,
  collectionFromShard,
  tagsToShard,
  tagsFromShard,
  embeddingSetToShard,
  embeddingSetFromShard,
  embeddingSetMemberToShard,
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
export { exportShard } from './shard-export.js'

// Import pipeline
export { importShard } from './shard-import.js'

// Schema validation
export {
  getKnowledgeShardSchema,
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
