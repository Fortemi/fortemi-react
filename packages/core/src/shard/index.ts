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
  ExportOptions,
  ImportOptions,
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
} from './field-mapper.js'
export type { BrowserNoteExport } from './field-mapper.js'

// Export pipeline
export { exportShard } from './shard-export.js'

// Import pipeline
export { importShard } from './shard-import.js'
