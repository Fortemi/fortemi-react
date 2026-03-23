export const VERSION = '2026.3.0'

export { generateId } from './uuid.js'

export { TypedEventBus } from './event-bus.js'
export type { EventMap, IDisposable } from './event-bus.js'

export { createPGliteInstance } from './db.js'
export type { PersistenceMode } from './db.js'

export { CapabilityManager } from './capability-manager.js'
export type { CapabilityName, CapabilityState } from './capability-manager.js'

export { MigrationRunner } from './migration-runner.js'
export type { Migration } from './migration-runner.js'
export { allMigrations } from './migrations/index.js'

export { ArchiveManager } from './archive-manager.js'
export type { ArchiveInfo } from './archive-manager.js'

export { createFortemi } from './create-fortemi.js'
export type { FortemiCore, FortemiConfig } from './create-fortemi.js'

export { computeHash } from './hash.js'

export { registerServiceWorker } from './service-worker/register.js'
export type { SWRegistrationResult } from './service-worker/register.js'

export { createRoutes, matchRoute } from './service-worker/routes.js'
export type { RouteHandler } from './service-worker/routes.js'

export { createBlobStore, MemoryBlobStore } from './blob-store.js'
export type { BlobStore } from './blob-store.js'

export type { WorkerRequest, WorkerResponse } from './worker/protocol.js'
export { PGliteWorkerClient, TransactionProxy } from './worker/worker-client.js'

export { NotesRepository } from './repositories/notes-repository.js'
export { SearchRepository } from './repositories/search-repository.js'
export { buildNoteConditions } from './repositories/condition-builder.js'
export type { ConditionResult } from './repositories/condition-builder.js'
export type {
  NoteSummary,
  NoteFull,
  NoteCreateInput,
  NoteUpdateInput,
  NoteListOptions,
  PaginatedResult,
  SearchResult,
  SearchResponse,
  SearchFacets,
  SearchOptions,
  NoteRevision,
} from './repositories/types.js'

export {
  JobQueueWorker,
  titleGenerationHandler,
  aiRevisionHandler,
  conceptTaggingHandler,
  linkingHandler,
  enqueueJob,
  enqueueNoteCreationJobs,
  getJobQueueStatus,
  JOB_PRIORITIES,
  JOB_CAPABILITIES,
} from './job-queue-worker.js'
export type { JobQueueOptions, JobType, EnqueueJobInput, JobStatus } from './job-queue-worker.js'

export { TagsRepository } from './repositories/tags-repository.js'
export { CollectionsRepository } from './repositories/collections-repository.js'
export type { CollectionRow, CollectionCreateInput } from './repositories/collections-repository.js'
export { LinksRepository } from './repositories/links-repository.js'
export type { LinkRow } from './repositories/links-repository.js'
export { SkosRepository } from './repositories/skos-repository.js'
export type { SkosScheme, SkosConcept, SkosRelation } from './repositories/skos-repository.js'

export { captureKnowledge, manageNote, searchTool } from './tools/index.js'
export type { CaptureKnowledgeResult, ManageNoteResult } from './tools/index.js'
export {
  CaptureKnowledgeInputSchema,
  ManageNoteInputSchema,
  SearchInputSchema,
} from './tools/index.js'
export type { CaptureKnowledgeInput, ManageNoteInput, SearchInput } from './tools/index.js'
export { FortemiToolManifest, fortemiManifest } from './tools/index.js'
export type { FortemiToolDefinition, PlinyCapability } from './tools/index.js'

export { getNote, GetNoteInputSchema } from './tools/index.js'
export type { GetNoteInput } from './tools/index.js'
export { listNotes, ListNotesInputSchema } from './tools/index.js'
export type { ListNotesInput } from './tools/index.js'
export { manageTags, ManageTagsInputSchema } from './tools/index.js'
export type { ManageTagsInput, ManageTagsResult } from './tools/index.js'
export { manageCollections, ManageCollectionsInputSchema } from './tools/index.js'
export type { ManageCollectionsInput, ManageCollectionsResult } from './tools/index.js'
export { manageLinks, ManageLinksInputSchema } from './tools/index.js'
export type { ManageLinksInput, ManageLinksResult } from './tools/index.js'
export { manageArchive, ManageArchiveInputSchema } from './tools/index.js'
export type { ManageArchiveInput, ManageArchiveResult } from './tools/index.js'
export { manageCapabilities, ManageCapabilitiesInputSchema } from './tools/index.js'
export type { ManageCapabilitiesInput, ManageCapabilitiesResult, CapabilityInfo } from './tools/index.js'
export { manageAttachments, ManageAttachmentsInputSchema } from './tools/index.js'
export type { ManageAttachmentsInput, ManageAttachmentsResult } from './tools/index.js'

export { detectGpuCapabilities, estimateVramTier, selectLlmModel } from './capabilities/gpu-detect.js'
export type { GpuCapabilities, VramTier } from './capabilities/gpu-detect.js'

export { AttachmentsRepository } from './repositories/attachments-repository.js'
export type { AttachmentRow, AttachmentBlobRow, AttachInput } from './repositories/attachments-repository.js'

export { chunkText } from './capabilities/chunking.js'
export {
  setEmbedFunction,
  getEmbedFunction,
  embeddingGenerationHandler,
} from './capabilities/embedding-handler.js'
export type { EmbedFunction } from './capabilities/embedding-handler.js'

export { setLlmFunction, getLlmFunction } from './capabilities/llm-handler.js'
export type { LlmCompleteFn } from './capabilities/llm-handler.js'

export { cosineSimilarity, suggestTags } from './capabilities/auto-tag.js'

export { registerSemanticCapability, unregisterSemanticCapability } from './capabilities/semantic-loader.js'
export { registerLlmCapability, unregisterLlmCapability } from './capabilities/llm-loader.js'
export type { LlmCapabilityOptions } from './capabilities/llm-loader.js'
