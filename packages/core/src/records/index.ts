/**
 * Canonical record layer (#323, ADR-013 D3): writable structured records
 * without PGlite. RecordStore contract + durable/memory implementations +
 * canonical repositories.
 *
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @source @packages/core/src/records/record-shard.ts
 * @created 2026-07-17
 * @agent Codex
 */

export type {
  AttachmentBlobRecord,
  AttachmentRecord,
  CollectionNoteRecord,
  CollectionRecord,
  JournalEntry,
  LinkRecord0,
  NoteOriginalRecord,
  NoteRecord0,
  NoteRevisedCurrentRecord,
  NoteTagRecord,
  RecordCollectionName,
  RecordCollections,
  RecordListOptions,
  RecordStore,
  RecordStoreCapabilities,
} from './types.js'
export { RECORD_COLLECTIONS, RECORD_STORE_CAPABILITIES } from './types.js'

export { MemoryRecordStore } from './memory-record-store.js'
export {
  IdbRecordStore,
  createRecordStore,
  RECORD_SCHEMA_VERSION,
} from './idb-record-store.js'
export type { CreateRecordStoreOptions } from './idb-record-store.js'

export { CanonicalNotesRepository } from './canonical-notes-repository.js'
export type {
  CanonicalNoteCreateInput,
  CanonicalNoteUpdateInput,
  CanonicalNoteView,
} from './canonical-notes-repository.js'

export { CanonicalAttachmentsRepository } from './canonical-attachments-repository.js'
export type { CanonicalAttachInput } from './canonical-attachments-repository.js'

export { projectAttachments, dropAttachmentProjection } from './attachment-projection.js'
export type { AttachmentProjectionResult } from './attachment-projection.js'

export { projectNotes, projectRecords, dropNoteProjection } from './record-projection.js'
export type { NoteProjectionResult, RecordProjectionResult } from './record-projection.js'

export { createRecordBackend } from './record-backend.js'
export type { RecordBackendOptions, RecordBackendManageNoteResult } from './record-backend.js'

export {
  exportShardFromRecords,
  exportShardFromRecordsWithReport,
  importShardToRecords,
} from './record-shard.js'
