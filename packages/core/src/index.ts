/**
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @source @packages/core/src/shard/schema-validator.ts
 * @created 2026-07-17
 * @agent Codex
 */
export const VERSION = '2026.7.8'

export { generateId } from './uuid.js'

export { TypedEventBus } from './event-bus.js'
export type { EventMap, IDisposable } from './event-bus.js'

export { createPGliteInstance } from './db.js'
export type { PersistenceMode, CreatePGliteOptions } from './db.js'

export {
  dumpDbSnapshot,
  restoreDbSnapshot,
  verifyDbSnapshotMeta,
  DbSnapshotVersionError,
  DB_SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_PGLITE_VERSION,
  CURRENT_MIGRATION_HEAD,
} from './data-archive.js'
export type {
  DbSnapshot,
  DbSnapshotMeta,
  DbSnapshotCompat,
  DbSnapshotExpectations,
  DbSnapshotSource,
  DbSnapshotCompression,
  DumpableDb,
  DumpDbSnapshotOptions,
  RestoreDbSnapshotOptions,
} from './data-archive.js'

// Backend seam (#191) — uniform tool-intent operation interface + negotiation
export {
  selectBackend,
  createPGliteBackend,
  createShardBackend,
  createRemoteBackend,
} from './data-backend.js'
export type {
  DataBackend,
  BackendCapabilities,
  BackendSemanticTier,
  BackendStartupCost,
  BackendNote,
  BackendNoteFull,
  BackendLink,
  BackendConcept,
  BackendProvenanceEdge,
  BackendSearchHit,
  BackendSearchResult,
  BackendListOptions,
  BackendSearchQueryOptions,
  BackendRequest,
  BackendCandidate,
  BackendSelection,
  PGliteBackendOptions,
  ShardBackendOptions,
  RemoteBackendConfig,
  RemoteBackendPaths,
} from './data-backend.js'

export {
  PGliteStorageBackend,
  PGliteStorageBackendFactory,
  PGliteWorkerStorageBackend,
  PGliteWorkerStorageBackendFactory,
  defaultStorageBackendFactory,
} from './storage-backend.js'
export type {
  DatabaseClient,
  QueryExecutor,
  QueryResult,
  StorageBackend,
  StorageBackendFactory,
  StorageOpenRequest,
  StorageTopology,
  PGliteWorkerStorageBackendFactoryOptions,
} from './storage-backend.js'

export { CapabilityManager } from './capability-manager.js'
export type { CapabilityName, CapabilityState } from './capability-manager.js'

export { MigrationRunner } from './migration-runner.js'
export type { Migration } from './migration-runner.js'
export { allMigrations } from './migrations/index.js'

export { ArchiveManager } from './archive-manager.js'
export type { ArchiveInfo } from './archive-manager.js'

export { createFortemi } from './create-fortemi.js'
export type { FortemiCore, FortemiConfig } from './create-fortemi.js'

export { computeHash, computeBlobHash } from './hash.js'

export {
  FORTEMI_COMPATIBILITY_PATH,
  FORTEMI_COMPATIBILITY_STATES,
  FORTEMI_REQUIRED_COMPATIBILITY_CAPABILITIES,
  fortemiCompatibilityUrl,
  validateFortemiCompatibilityResponse,
  fetchAndValidateFortemiCompatibility,
  formatFortemiCompatibilitySummary,
} from './server-compatibility.js'
export type {
  FetchFortemiCompatibilityOptions,
  FortemiCompatibilityCapability,
  FortemiCompatibilityResponse,
  FortemiCompatibilityState,
  FortemiCompatibilityValidationResult,
  FortemiRequiredCompatibilityCapability,
} from './server-compatibility.js'

export { registerServiceWorker } from './service-worker/register.js'
export type { SWRegistrationResult } from './service-worker/register.js'

export { createRoutes, matchRoute } from './service-worker/routes.js'
export type { RouteHandler } from './service-worker/routes.js'

export { createBlobStore, createLazyBlobStore, MemoryBlobStore } from './blob-store.js'
export type {
  BlobStore,
  BlobBackendKind,
  BlobStoreDiagnostics,
  BlobReconcileOptions,
  BlobReconcileResult,
  BlobGcOptions,
  BlobGcResult,
  CreateBlobStoreOptions,
} from './blob-store.js'
export { migrateLegacyBlobStore } from './blob-store-legacy.js'
export type { LegacyMigrationReport } from './blob-store-legacy.js'

export type { WorkerRequest, WorkerResponse } from './worker/protocol.js'
export { PGliteWorkerClient, TransactionProxy } from './worker/worker-client.js'

export { NotesRepository } from './repositories/notes-repository.js'
export { SearchRepository } from './repositories/search-repository.js'
export { EmbeddingSetsRepository } from './repositories/embedding-sets-repository.js'
export { GraphRepository, detectCommunities } from './repositories/graph-repository.js'
export { CommunitiesRepository } from './repositories/communities-repository.js'
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
export type {
  EmbeddingSetRow,
  EmbeddingSetCreateInput,
  EmbeddingSetEmbeddingInput,
  EmbeddingSetKind,
  EmbeddingSetMode,
  EmbeddingSetCriteria,
  EmbeddingSetFreshness,
  EmbeddingCompatibilityPolicy,
  VirtualMaterializationPolicy,
  VirtualEmbeddingSetSource,
  VirtualEmbeddingSetDefinition,
  EmbeddingSetSelector,
  EmbeddingSetDescriptor,
  VirtualEmbeddingSetValidationError,
  ResolvedEmbeddingSet,
  ResolvedEmbeddingRow,
} from './repositories/embedding-sets-repository.js'
export type { GraphNode, GraphEdge, GraphCommunity, CommunityGraph, SimilarityGraphOptions, SimilarityGraphRequest, SimilarityGraphCacheKey, SimilarityGraphResult, CommunityOptions } from './repositories/graph-repository.js'
export type { CommunitySourceType, CommunityFilterDefinition, CommunitySourceDescriptor, CommunityAssignmentView, CommunitySummary, CommunityCreateInput } from './repositories/communities-repository.js'

export {
  JobQueueWorker,
  titleGenerationHandler,
  aiRevisionHandler,
  conceptTaggingHandler,
  linkingHandler,
  enqueueJob,
  enqueueNoteCreationJobs,
  enqueueFullWorkflow,
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
export type { SkosScheme, SkosConcept, SkosRelation, NoteSkosTag } from './repositories/skos-repository.js'
export { ProvenanceRepository } from './repositories/provenance-repository.js'
export type { ProvenanceEdge, RecordProvenanceInput } from './repositories/provenance-repository.js'

export { captureKnowledge, manageNote, searchTool } from './tools/index.js'
export type { CaptureKnowledgeResult, ManageNoteResult } from './tools/index.js'
export {
  CaptureKnowledgeInputSchema,
  ManageNoteInputSchema,
  SearchInputSchema,
} from './tools/index.js'
export type { CaptureKnowledgeInput, ManageNoteInput, SearchInput } from './tools/index.js'
export { FortemiToolManifest, fortemiManifest } from './tools/index.js'
export type { FortemiToolDefinition, BridgeCapability } from './tools/index.js'

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

export {
  detectInferenceCapabilities,
  estimateVramMB,
  estimateModelFit,
} from './capabilities/inference-detect.js'
export type {
  InferenceCapabilities,
  RecommendedTier,
  ModelFitResult,
} from './capabilities/inference-detect.js'

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

export {
  registerSemanticCapability,
  registerSemanticCapabilityWorker,
  unregisterSemanticCapability,
} from './capabilities/semantic-loader.js'
export {
  createWorkerEmbedFunction,
  handleEmbedRequests,
  EMBED_REQUEST_KIND,
  EMBED_RESPONSE_KIND,
} from './capabilities/embed-worker-transport.js'
export type {
  EmbedTransportPort,
  EmbedWorkerOptions,
  EmbedRequestMessage,
  EmbedResponseMessage,
} from './capabilities/embed-worker-transport.js'
export { registerLlmCapability, unregisterLlmCapability } from './capabilities/llm-loader.js'
export type { LlmCapabilityOptions } from './capabilities/llm-loader.js'

export { ProviderRegistry, createLegacyProvider } from './capabilities/provider-registry.js'
export { OpenAICompatibleProvider } from './capabilities/openai-provider.js'
export type { OpenAIProviderConfig } from './capabilities/openai-provider.js'

export {
  discoverLocalProviders,
  classifyModel,
  LOCAL_ENDPOINTS,
} from './capabilities/local-discovery.js'
export { FallbackRouter, classifyError } from './capabilities/fallback-router.js'
export type {
  FallbackRouterConfig,
  CooldownConfig,
  ErrorCategory,
  FallbackEvent,
  CooldownEvent,
} from './capabilities/fallback-router.js'

export type {
  DiscoveredProvider,
  DiscoveryOptions,
  LocalEndpoint,
  ModelCategory,
} from './capabilities/local-discovery.js'

export {
  getFortemiBridge,
  getFortemiSecretStore,
  hasFortemiSecureSecrets,
} from './fortemi-bridge.js'
export type {
  BridgeProviderInfo,
  FortemiBridge,
  FortemiBridgeCapabilities,
  FortemiBridgeHost,
  FortemiInferenceRouter,
  FortemiSecretStore,
} from './fortemi-bridge.js'

export type {
  InferenceProvider,
  ProviderCapabilities,
  ProviderTier,
  EmbedRequest,
  EmbedResponse,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ModelInfo,
  ProbeResult,
  ProbeStatus,
} from './capabilities/inference-provider.js'

export {
  buildPluginCsp,
  computeSri,
  verifySri,
  isPluginScriptAllowed,
  fetchPluginScript,
  appendPluginScript,
  parseCspReport,
  createCspReportHandler,
} from './security/plugin-content.js'
export type {
  CspDirectiveName,
  CspDirectives,
  PluginCspOptions,
  PluginScriptPolicy,
  PluginScriptDescriptor,
  LoadedPluginScript,
  CspViolationReport,
} from './security/plugin-content.js'

// Shard import/export
export {
  CURRENT_SHARD_VERSION,
  SHARD_FORMAT,
  packTarGz,
  unpackTarGz,
  sha256Hex,
  validateChecksums,
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
  exportShard,
  exportShardWithReport,
  importShard,
  verifyShardSignature,
  signShard,
  isShardSigningSupported,
  sidecarBlobDigests,
  AllowlistTrustStore,
  SIGNATURE_ENTRY,
  SIGNING_ENVELOPE_VERSION,
  getKnowledgeShardContractReceipt,
  CORE_V1_COMPONENTS,
  createShardCapabilityReport,
  getKnowledgeShardProfileRegistry,
  profileSupportError,
  getKnowledgeShardSchema,
  validateCoreV1ShardArchive,
  validateFullV1ShardArchive,
  validateRecordV1ShardArchive,
  validateShardArchive,
  validateShardManifest,
  validateShardComponentRecord,
  assertShardComponentRecord,
  openShard,
  createCosineSemanticProvider,
  prefetchShard,
  fromPrefetched,
  isShardPrefetched,
  getPrefetchedSha256,
  clearPrefetchedShard,
} from './shard/index.js'
export type { ShardSchemaValidationResult } from './shard/index.js'
export type {
  ShardSignatureVerdict,
  ShardSignatureEnvelope,
  ShardSigningPayload,
  ShardSigner,
  ShardTrustStore,
  TrustedKey,
  VerifyShardSignatureInput,
  SignShardInput,
} from './shard/index.js'
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
  VectorEntry,
  CosineSemanticProviderOptions,
  ShardClusterRef,
  ShardLayout,
  PrefetchOptions,
  PrefetchResult,
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
  BrowserNoteExport,
} from './shard/index.js'

export {
  AIWG_SCAN_REQUIRED_FIELDS,
  assertAiwgFortemiIndexExport,
  assertAiwgFortemiChunkManifest,
  assertAiwgFortemiChunkPart,
  assertAiwgStaticEmbeddingSet,
  aiwgFortemiIndexFromKnowledgeShard,
  aiwgFortemiIndexToKnowledgeShard,
  aiwgFortemiIndexToCommunityGraph,
  buildAiwgChunkedIndex,
  buildAiwgStaticEmbeddingSet,
  createAiwgFetchChunkLoader,
  createAiwgFetchDetailLoader,
  createAiwgIndexController,
  createAiwgReviewDecisionExport,
  filterAiwgRecordsByPrivacy,
  findAiwgStaticDuplicatePairs,
  getAiwgFortemiFacets,
  queryAiwgFortemiIndex,
  queryAiwgHybridIndex,
  queryAiwgSemanticIndex,
  validateAiwgFortemiChunkManifest,
  validateAiwgFortemiChunkPart,
  validateAiwgFortemiIndexExport,
  validateAiwgStaticEmbeddingSet,
} from './aiwg-index.js'
export {
  getAiwgFortemiIndexExportSchema,
  validateAiwgFortemiIndexExportSchema,
  validateAiwgFortemiProjectedRecordSchema,
} from './aiwg-index-schema.js'
export type { AiwgIndexSchemaValidationResult } from './aiwg-index-schema.js'
export type {
  AiwgChunkedIndexBuildOptions,
  AiwgChunkedIndexBuildResult,
  AiwgChunkedIndexDetailLoader,
  AiwgChunkedIndexLoadOptions,
  AiwgChunkedIndexLoader,
  AiwgChunkedIndexProgress,
  AiwgChunkedIndexProgressPhase,
  AiwgChunkedIndexQueryOptions,
  AiwgChunkedIndexQueryResult,
  AiwgChunkedIndexValidationResult,
  AiwgFortemiChunkDetailRef,
  AiwgFortemiChunkManifest,
  AiwgFortemiChunkPart,
  AiwgPrivacyFilterOptions,
  AiwgFortemiChunkPartRef,
  AiwgFortemiChunk,
  AiwgFortemiIndexExport,
  AiwgFortemiIndexExportSchemaVersion,
  AiwgFortemiProjectedRecord,
  AiwgFortemiProvenance,
  AiwgFortemiProvenanceEvent,
  AiwgFortemiRecord,
  AiwgFortemiRecordEmbedding,
  AiwgFortemiRecordSchemaVersion,
  AiwgFortemiRecordSource,
  AiwgFortemiRecordType,
  AiwgFortemiRelationship,
  AiwgFortemiRelationshipDirection,
  AiwgFortemiSearchProjection,
  AiwgFortemiSkosConcept,
  AiwgFortemiSkosRelation,
  AiwgFortemiSkosRelationType,
  AiwgFortemiAttachmentReference,
  AiwgFortemiBinarySource,
  AiwgHeadlessEmbeddingBackend,
  AiwgIndexController,
  AiwgIndexControllerListener,
  AiwgIndexControllerSnapshot,
  AiwgIndexGraphOptions,
  AiwgIndexQueryMatch,
  AiwgIndexQueryOptions,
  AiwgIndexQueryRankedItem,
  AiwgIndexQueryResult,
  AiwgIndexQueryWeights,
  AiwgIndexValidationResult,
  AiwgKnowledgeShardOptions,
  AiwgPrivacyClassification,
  AiwgProvenanceConfidence,
  AiwgRelationshipDirection,
  AiwgRelationshipEdgeSummary,
  AiwgRelationshipNodeSummary,
  AiwgRelationshipQueryOptions,
  AiwgRelationshipSetOperation,
  AiwgRelationshipSetOptions,
  AiwgRelationshipSetResult,
  AiwgRelationshipTraversalOptions,
  AiwgRelationshipTraversalResult,
  AiwgReviewAction,
  AiwgReviewDecision,
  AiwgReviewDecisionExport,
  AiwgReviewInput,
  AiwgStaticDuplicatePair,
  AiwgStaticEmbeddingRecord,
  AiwgStaticEmbeddingSet,
  BuildAiwgStaticEmbeddingSetOptions,
  AiwgStaticHybridQueryOptions,
  AiwgStaticSemanticQueryOptions,
  AiwgStaticSemanticResult,
} from './aiwg-index.js'

// Canonical record layer (#323, ADR-013): DB-free writable records + journal.
export * from './records/index.js'
