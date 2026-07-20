/**
 * Canonical and transitional Knowledge Shard validation.
 *
 * @implements @.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md
 * @implements @.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md
 * @schema @packages/core/schemas/knowledge-shard.schema.receipt.json
 * @created 2026-07-17
 * @agent Codex
 */
import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import legacySchema from '../../schemas/knowledge-shard.schema.json' with { type: 'json' }
import authorityReceipt from '../../schemas/knowledge-shard.schema.receipt.json' with { type: 'json' }
import legacyManifestSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/manifest.schema.json' with { type: 'json' }
import legacyNoteSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/note.schema.json' with { type: 'json' }
import legacyCollectionSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/collection.schema.json' with { type: 'json' }
import legacyTagSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/tag.schema.json' with { type: 'json' }
import legacyTemplateSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/template.schema.json' with { type: 'json' }
import legacyLinkSchema from '../../schemas/knowledge-shard/1.0.0/core-v1/link.schema.json' with { type: 'json' }
import v1_1CoreManifestSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/manifest.schema.json' with { type: 'json' }
import v1_1RecordManifestSchema from '../../schemas/knowledge-shard/1.1.0/record-v1/manifest.schema.json' with { type: 'json' }
import v1_1FullManifestSchema from '../../schemas/knowledge-shard/1.1.0/full-v1/manifest.schema.json' with { type: 'json' }
import v1_1FullEmbeddingSchema from '../../schemas/knowledge-shard/1.1.0/full-v1/embedding.schema.json' with { type: 'json' }
import manifestSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/manifest.schema.json' with { type: 'json' }
import noteSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/note.schema.json' with { type: 'json' }
import collectionSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/collection.schema.json' with { type: 'json' }
import tagSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/tag.schema.json' with { type: 'json' }
import templateSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/template.schema.json' with { type: 'json' }
import linkSchema from '../../schemas/knowledge-shard/1.2.0/core-v1/link.schema.json' with { type: 'json' }
import recordManifestSchema from '../../schemas/knowledge-shard/1.2.0/record-v1/manifest.schema.json' with { type: 'json' }
import recordNoteSchema from '../../schemas/knowledge-shard/1.2.0/record-v1/note.schema.json' with { type: 'json' }
import recordCollectionSchema from '../../schemas/knowledge-shard/1.2.0/record-v1/collection.schema.json' with { type: 'json' }
import recordTagSchema from '../../schemas/knowledge-shard/1.2.0/record-v1/tag.schema.json' with { type: 'json' }
import recordLinkSchema from '../../schemas/knowledge-shard/1.2.0/record-v1/link.schema.json' with { type: 'json' }
import fullManifestSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/manifest.schema.json' with { type: 'json' }
import fullNoteOriginalSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/note-original.schema.json' with { type: 'json' }
import fullNoteOriginalHistorySchema from '../../schemas/knowledge-shard/1.2.0/full-v1/note-original-history.schema.json' with { type: 'json' }
import fullNoteRevisedCurrentSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/note-revised-current.schema.json' with { type: 'json' }
import fullNoteRevisionSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/note-revision.schema.json' with { type: 'json' }
import fullEmbeddingConfigSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/embedding-config.schema.json' with { type: 'json' }
import fullEmbeddingSetSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/embedding-set.schema.json' with { type: 'json' }
import fullEmbeddingSetMemberSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/embedding-set-member.schema.json' with { type: 'json' }
import fullEmbeddingSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/embedding.schema.json' with { type: 'json' }
import fullProvenanceEdgeSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/provenance-edge.schema.json' with { type: 'json' }
import fullProvenanceActivitySchema from '../../schemas/knowledge-shard/1.2.0/full-v1/provenance-activity.schema.json' with { type: 'json' }
import fullNamedLocationSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/named-location.schema.json' with { type: 'json' }
import fullProvenanceLocationSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/provenance-location.schema.json' with { type: 'json' }
import fullProvenanceDeviceSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/provenance-device.schema.json' with { type: 'json' }
import fullProvenanceRecordSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/provenance-record.schema.json' with { type: 'json' }
import fullSkosSchemeSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-scheme.schema.json' with { type: 'json' }
import fullSkosConceptSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-concept.schema.json' with { type: 'json' }
import fullSkosLabelSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-label.schema.json' with { type: 'json' }
import fullSkosNoteSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-note.schema.json' with { type: 'json' }
import fullSkosRelationSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-relation.schema.json' with { type: 'json' }
import fullSkosMappingRelationSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-mapping-relation.schema.json' with { type: 'json' }
import fullSkosSchemeMembershipSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-scheme-membership.schema.json' with { type: 'json' }
import fullNoteSkosTagSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/note-skos-tag.schema.json' with { type: 'json' }
import fullSkosCollectionSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-collection.schema.json' with { type: 'json' }
import fullSkosCollectionMemberSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/skos-collection-member.schema.json' with { type: 'json' }
import fullGraphSourceSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/graph-source.schema.json' with { type: 'json' }
import fullGraphEdgeSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/graph-edge.schema.json' with { type: 'json' }
import fullCommunitySetSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/community-set.schema.json' with { type: 'json' }
import fullCommunityAssignmentSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/community-assignment.schema.json' with { type: 'json' }
import fullSignatureSchema from '../../schemas/knowledge-shard/1.2.0/full-v1/signature.schema.json' with { type: 'json' }
import { validateChecksums } from './checksum.js'
import { unpackTarGz } from './shard-tar.js'
import { CURRENT_SHARD_VERSION } from './types.js'
import type { ShardComponent, ShardManifest } from './types.js'
import { computeBlobHash } from '../hash.js'
import { isSidecarEntry, sidecarEntryName } from './blob-sidecar.js'

export interface ShardSchemaValidationResult {
  valid: boolean
  errors: string[]
}

type ShardFiles = Map<string, Uint8Array>
type CoreV1Component = 'notes' | 'collections' | 'tags' | 'templates' | 'links'
type RecordV1Component = 'notes' | 'collections' | 'tags' | 'links'
type FullV1Component = ShardComponent
export type CoreV1SchemaVersion = '1.0.0' | '1.1.0' | '1.2.0'
type CurrentCanonicalSchemaVersion = '1.1.0' | '1.2.0'
type RecordEncoding = 'json-array' | 'jsonl'
type IdentifiedSchema = object & { $id: string }

const decoder = new TextDecoder()

type LegacySchemaDefName =
  | 'manifest'
  | 'note'
  | 'collection'
  | 'tag'
  | 'template'
  | 'link'
  | 'embeddingSet'
  | 'embeddingSetMember'
  | 'embeddingConfig'
  | 'embedding'
  | 'skosScheme'
  | 'skosConcept'
  | 'skosRelation'
  | 'noteSkosTag'
  | 'provenanceEdge'
  | 'graphSource'
  | 'graphEdge'
  | 'communitySet'
  | 'communityAssignment'

const LEGACY_COMPONENT_SCHEMA_DEFS: Partial<
  Record<ShardComponent | 'templates', LegacySchemaDefName>
> = {
  notes: 'note',
  collections: 'collection',
  tags: 'tag',
  templates: 'template',
  links: 'link',
  embedding_sets: 'embeddingSet',
  embedding_set_members: 'embeddingSetMember',
  embedding_configs: 'embeddingConfig',
  embeddings: 'embedding',
  skos_schemes: 'skosScheme',
  skos_concepts: 'skosConcept',
  skos_relations: 'skosRelation',
  note_skos_tags: 'noteSkosTag',
  provenance_edges: 'provenanceEdge',
  graph_sources: 'graphSource',
  graph_edges: 'graphEdge',
  communities: 'communitySet',
  community_assignments: 'communityAssignment',
}

const LEGACY_COMPONENT_FILES: Partial<
  Record<ShardComponent, { file: string; encoding: RecordEncoding }>
> = {
  notes: { file: 'notes.jsonl', encoding: 'jsonl' },
  collections: { file: 'collections.json', encoding: 'json-array' },
  tags: { file: 'tags.json', encoding: 'json-array' },
  templates: { file: 'templates.json', encoding: 'json-array' },
  links: { file: 'links.jsonl', encoding: 'jsonl' },
  embedding_sets: { file: 'embedding_sets.json', encoding: 'json-array' },
  embedding_set_members: { file: 'embedding_set_members.jsonl', encoding: 'jsonl' },
  embedding_configs: { file: 'embedding_configs.json', encoding: 'json-array' },
  embeddings: { file: 'embeddings.jsonl', encoding: 'jsonl' },
  skos_schemes: { file: 'skos_schemes.json', encoding: 'json-array' },
  skos_concepts: { file: 'skos_concepts.json', encoding: 'json-array' },
  skos_relations: { file: 'skos_relations.jsonl', encoding: 'jsonl' },
  note_skos_tags: { file: 'note_skos_tags.jsonl', encoding: 'jsonl' },
  provenance_edges: { file: 'provenance_edges.jsonl', encoding: 'jsonl' },
  graph_sources: { file: 'graph_sources.json', encoding: 'json-array' },
  graph_edges: { file: 'graph_edges.jsonl', encoding: 'jsonl' },
  communities: { file: 'communities.json', encoding: 'json-array' },
  community_assignments: { file: 'community_assignments.jsonl', encoding: 'jsonl' },
}

const CORE_V1_COMPONENT_FILES: Record<
  CoreV1Component,
  { file: string; encoding: RecordEncoding }
> = {
  notes: { file: 'notes.jsonl', encoding: 'jsonl' },
  collections: { file: 'collections.json', encoding: 'json-array' },
  tags: { file: 'tags.json', encoding: 'json-array' },
  templates: { file: 'templates.json', encoding: 'json-array' },
  links: { file: 'links.jsonl', encoding: 'jsonl' },
}

const RECORD_V1_COMPONENT_FILES: Record<
  RecordV1Component,
  { file: string; encoding: RecordEncoding }
> = {
  notes: { file: 'notes.jsonl', encoding: 'jsonl' },
  collections: { file: 'collections.json', encoding: 'json-array' },
  tags: { file: 'tags.json', encoding: 'json-array' },
  links: { file: 'links.jsonl', encoding: 'jsonl' },
}

const FULL_V1_COMPONENT_FILES: Record<
  FullV1Component,
  { file: string; encoding: RecordEncoding }
> = {
  notes: { file: 'notes.jsonl', encoding: 'jsonl' },
  collections: { file: 'collections.json', encoding: 'json-array' },
  tags: { file: 'tags.json', encoding: 'json-array' },
  templates: { file: 'templates.json', encoding: 'json-array' },
  links: { file: 'links.jsonl', encoding: 'jsonl' },
  note_originals: { file: 'note_originals.jsonl', encoding: 'jsonl' },
  note_original_history: { file: 'note_original_history.jsonl', encoding: 'jsonl' },
  note_revised_current: { file: 'note_revised_current.jsonl', encoding: 'jsonl' },
  note_revisions: { file: 'note_revisions.jsonl', encoding: 'jsonl' },
  embedding_configs: { file: 'embedding_configs.json', encoding: 'json-array' },
  embedding_sets: { file: 'embedding_sets.json', encoding: 'json-array' },
  embedding_set_members: { file: 'embedding_set_members.jsonl', encoding: 'jsonl' },
  embeddings: { file: 'embeddings.jsonl', encoding: 'jsonl' },
  provenance_edges: { file: 'provenance_edges.jsonl', encoding: 'jsonl' },
  provenance_activities: { file: 'provenance_activities.jsonl', encoding: 'jsonl' },
  named_locations: { file: 'named_locations.jsonl', encoding: 'jsonl' },
  provenance_locations: { file: 'provenance_locations.jsonl', encoding: 'jsonl' },
  provenance_devices: { file: 'provenance_devices.jsonl', encoding: 'jsonl' },
  provenance_records: { file: 'provenance_records.jsonl', encoding: 'jsonl' },
  skos_schemes: { file: 'skos_schemes.json', encoding: 'json-array' },
  skos_concepts: { file: 'skos_concepts.json', encoding: 'json-array' },
  skos_labels: { file: 'skos_labels.jsonl', encoding: 'jsonl' },
  skos_notes: { file: 'skos_notes.jsonl', encoding: 'jsonl' },
  skos_relations: { file: 'skos_relations.jsonl', encoding: 'jsonl' },
  skos_mapping_relations: { file: 'skos_mapping_relations.jsonl', encoding: 'jsonl' },
  skos_scheme_memberships: { file: 'skos_scheme_memberships.jsonl', encoding: 'jsonl' },
  note_skos_tags: { file: 'note_skos_tags.jsonl', encoding: 'jsonl' },
  skos_collections: { file: 'skos_collections.json', encoding: 'json-array' },
  skos_collection_members: { file: 'skos_collection_members.jsonl', encoding: 'jsonl' },
  graph_sources: { file: 'graph_sources.json', encoding: 'json-array' },
  graph_edges: { file: 'graph_edges.jsonl', encoding: 'jsonl' },
  communities: { file: 'communities.json', encoding: 'json-array' },
  community_assignments: { file: 'community_assignments.jsonl', encoding: 'jsonl' },
}

const CORE_V1_SCHEMAS: Record<
  CoreV1SchemaVersion,
  Record<CoreV1Component | 'manifest', IdentifiedSchema>
> = {
  '1.0.0': {
    manifest: legacyManifestSchema,
    notes: legacyNoteSchema,
    collections: legacyCollectionSchema,
    tags: legacyTagSchema,
    templates: legacyTemplateSchema,
    links: legacyLinkSchema,
  },
  '1.1.0': {
    manifest: v1_1CoreManifestSchema,
    notes: noteSchema,
    collections: collectionSchema,
    tags: tagSchema,
    templates: templateSchema,
    links: linkSchema,
  },
  '1.2.0': {
    manifest: manifestSchema,
    notes: noteSchema,
    collections: collectionSchema,
    tags: tagSchema,
    templates: templateSchema,
    links: linkSchema,
  },
}

const RECORD_V1_CURRENT_SCHEMAS: Record<
  RecordV1Component | 'manifest',
  IdentifiedSchema
> = {
  manifest: recordManifestSchema,
  notes: recordNoteSchema,
  collections: recordCollectionSchema,
  tags: recordTagSchema,
  links: recordLinkSchema,
}

const RECORD_V1_SCHEMAS: Record<
  CurrentCanonicalSchemaVersion,
  Record<RecordV1Component | 'manifest', IdentifiedSchema>
> = {
  '1.1.0': {
    ...RECORD_V1_CURRENT_SCHEMAS,
    manifest: v1_1RecordManifestSchema,
  },
  '1.2.0': RECORD_V1_CURRENT_SCHEMAS,
}

const FULL_V1_CURRENT_SCHEMAS: Record<
  FullV1Component | 'manifest' | 'signature',
  IdentifiedSchema
> = {
  manifest: fullManifestSchema,
  notes: noteSchema,
  collections: collectionSchema,
  tags: tagSchema,
  templates: templateSchema,
  links: linkSchema,
  note_originals: fullNoteOriginalSchema,
  note_original_history: fullNoteOriginalHistorySchema,
  note_revised_current: fullNoteRevisedCurrentSchema,
  note_revisions: fullNoteRevisionSchema,
  embedding_configs: fullEmbeddingConfigSchema,
  embedding_sets: fullEmbeddingSetSchema,
  embedding_set_members: fullEmbeddingSetMemberSchema,
  embeddings: fullEmbeddingSchema,
  provenance_edges: fullProvenanceEdgeSchema,
  provenance_activities: fullProvenanceActivitySchema,
  named_locations: fullNamedLocationSchema,
  provenance_locations: fullProvenanceLocationSchema,
  provenance_devices: fullProvenanceDeviceSchema,
  provenance_records: fullProvenanceRecordSchema,
  skos_schemes: fullSkosSchemeSchema,
  skos_concepts: fullSkosConceptSchema,
  skos_labels: fullSkosLabelSchema,
  skos_notes: fullSkosNoteSchema,
  skos_relations: fullSkosRelationSchema,
  skos_mapping_relations: fullSkosMappingRelationSchema,
  skos_scheme_memberships: fullSkosSchemeMembershipSchema,
  note_skos_tags: fullNoteSkosTagSchema,
  skos_collections: fullSkosCollectionSchema,
  skos_collection_members: fullSkosCollectionMemberSchema,
  graph_sources: fullGraphSourceSchema,
  graph_edges: fullGraphEdgeSchema,
  communities: fullCommunitySetSchema,
  community_assignments: fullCommunityAssignmentSchema,
  signature: fullSignatureSchema,
}

const FULL_V1_SCHEMAS: Record<
  CurrentCanonicalSchemaVersion,
  Record<FullV1Component | 'manifest' | 'signature', IdentifiedSchema>
> = {
  '1.1.0': {
    ...FULL_V1_CURRENT_SCHEMAS,
    manifest: v1_1FullManifestSchema,
    embeddings: v1_1FullEmbeddingSchema,
  },
  '1.2.0': FULL_V1_CURRENT_SCHEMAS,
}

let legacyAjvInstance: Ajv2020 | undefined
let coreAjvInstance: Ajv2020 | undefined
let recordAjvInstance: Ajv2020 | undefined
let fullAjvInstance: Ajv2020 | undefined
const legacyValidators = new Map<LegacySchemaDefName, ValidateFunction>()
const coreValidators = new Map<string, ValidateFunction>()
const recordValidators = new Map<string, ValidateFunction>()
const fullValidators = new Map<string, ValidateFunction>()

export function getKnowledgeShardSchema(): unknown {
  return {
    manifest: manifestSchema,
    notes: noteSchema,
    collections: collectionSchema,
    tags: tagSchema,
    templates: templateSchema,
    links: linkSchema,
    recordV1: {
      manifest: recordManifestSchema,
      notes: recordNoteSchema,
      collections: recordCollectionSchema,
      tags: recordTagSchema,
      links: recordLinkSchema,
    },
    fullV1: FULL_V1_CURRENT_SCHEMAS,
  }
}

export function getKnowledgeShardContractReceipt(): unknown {
  return authorityReceipt
}

function addCanonicalFormats(ajv: Ajv2020): void {
  ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value: string) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value)),
  })
  ajv.addFormat('uri', {
    type: 'string',
    validate: (value: string) => {
      try {
        return Boolean(new URL(value).protocol)
      } catch {
        return false
      }
    },
  })
}

function getLegacyAjv(): Ajv2020 {
  if (!legacyAjvInstance) {
    legacyAjvInstance = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    })
    legacyAjvInstance.addSchema(legacySchema)
  }
  return legacyAjvInstance
}

function getCoreAjv(): Ajv2020 {
  if (!coreAjvInstance) {
    coreAjvInstance = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: true,
    })
    addCanonicalFormats(coreAjvInstance)
    const registered = new Set<string>()
    for (const bundle of Object.values(CORE_V1_SCHEMAS)) {
      for (const schema of Object.values(bundle)) {
        if (!registered.has(schema.$id)) {
          coreAjvInstance.addSchema(schema)
          registered.add(schema.$id)
        }
      }
    }
  }
  return coreAjvInstance
}

function getRecordAjv(): Ajv2020 {
  if (!recordAjvInstance) {
    recordAjvInstance = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: true,
    })
    addCanonicalFormats(recordAjvInstance)
    const registered = new Set<string>()
    for (const bundle of Object.values(RECORD_V1_SCHEMAS)) {
      for (const schema of Object.values(bundle)) {
        if (!registered.has(schema.$id)) {
          recordAjvInstance.addSchema(schema)
          registered.add(schema.$id)
        }
      }
    }
  }
  return recordAjvInstance
}

function getFullAjv(): Ajv2020 {
  if (!fullAjvInstance) {
    fullAjvInstance = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: true,
    })
    addCanonicalFormats(fullAjvInstance)
    const registered = new Set<string>()
    for (const bundle of Object.values(FULL_V1_SCHEMAS)) {
      for (const schema of Object.values(bundle)) {
        if (!registered.has(schema.$id)) {
          fullAjvInstance.addSchema(schema)
          registered.add(schema.$id)
        }
      }
    }
  }
  return fullAjvInstance
}

function legacyValidatorFor(defName: LegacySchemaDefName): ValidateFunction {
  const cached = legacyValidators.get(defName)
  if (cached) return cached
  const validator = getLegacyAjv().getSchema(`${legacySchema.$id}#/$defs/${defName}`)
    ?? getLegacyAjv().compile({ $ref: `${legacySchema.$id}#/$defs/${defName}` })
  legacyValidators.set(defName, validator)
  return validator
}

function coreSchemaVersion(value: string): CoreV1SchemaVersion | undefined {
  return value === '1.0.0' || value === '1.1.0' || value === '1.2.0'
    ? value
    : undefined
}

function currentCanonicalSchemaVersion(
  value: string,
): CurrentCanonicalSchemaVersion | undefined {
  return value === '1.1.0' || value === '1.2.0' ? value : undefined
}

function coreValidatorFor(
  name: CoreV1Component | 'manifest',
  version: CoreV1SchemaVersion = CURRENT_SHARD_VERSION,
): ValidateFunction {
  const key = `${version}:${name}`
  const cached = coreValidators.get(key)
  if (cached) return cached
  const schema = CORE_V1_SCHEMAS[version][name]
  const validator = getCoreAjv().getSchema(schema.$id) ?? getCoreAjv().compile(schema)
  coreValidators.set(key, validator)
  return validator
}

function recordValidatorFor(
  name: RecordV1Component | 'manifest',
  version: CurrentCanonicalSchemaVersion = CURRENT_SHARD_VERSION,
): ValidateFunction {
  const key = `${version}:${name}`
  const cached = recordValidators.get(key)
  if (cached) return cached
  const schema = RECORD_V1_SCHEMAS[version][name]
  const validator = getRecordAjv().getSchema(schema.$id) ?? getRecordAjv().compile(schema)
  recordValidators.set(key, validator)
  return validator
}

function fullValidatorFor(
  name: FullV1Component | 'manifest' | 'signature',
  version: CurrentCanonicalSchemaVersion = CURRENT_SHARD_VERSION,
): ValidateFunction {
  const key = `${version}:${name}`
  const cached = fullValidators.get(key)
  if (cached) return cached
  const schema = FULL_V1_SCHEMAS[version][name]
  const validator = getFullAjv().getSchema(schema.$id) ?? getFullAjv().compile(schema)
  fullValidators.set(key, validator)
  return validator
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || '(root)'
    return `${path} ${error.message ?? 'is invalid'}`
  })
}

function profileOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const profile = (value as Record<string, unknown>).profile
  return typeof profile === 'string' ? profile : undefined
}

export function validateShardManifest(value: unknown): ShardSchemaValidationResult {
  let validate: ValidateFunction
  const profile = profileOf(value)
  if (profile === 'core-v1') {
    const version = value && typeof value === 'object' && !Array.isArray(value)
      ? coreSchemaVersion(String((value as Record<string, unknown>).version ?? ''))
      : undefined
    if (!version) {
      return {
        valid: false,
        errors: ['(root) uses an unsupported canonical core-v1 schema version'],
      }
    }
    validate = coreValidatorFor('manifest', version)
  } else if (profile === 'record-v1') {
    const version = value && typeof value === 'object' && !Array.isArray(value)
      ? currentCanonicalSchemaVersion(String((value as Record<string, unknown>).version ?? ''))
      : undefined
    if (!version) {
      return {
        valid: false,
        errors: ['(root) uses an unsupported canonical record-v1 schema version'],
      }
    }
    validate = recordValidatorFor('manifest', version)
  } else if (profile === 'full-v1') {
    const version = value && typeof value === 'object' && !Array.isArray(value)
      ? currentCanonicalSchemaVersion(String((value as Record<string, unknown>).version ?? ''))
      : undefined
    if (!version) {
      return {
        valid: false,
        errors: ['(root) uses an unsupported canonical full-v1 schema version'],
      }
    }
    validate = fullValidatorFor('manifest', version)
  } else {
    validate = legacyValidatorFor('manifest')
  }
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}

function parseJsonArray(
  bytes: Uint8Array | undefined,
  path: string,
): { records: unknown[]; errors: string[] } {
  if (!bytes) return { records: [], errors: [] }
  try {
    const value = JSON.parse(decoder.decode(bytes)) as unknown
    if (!Array.isArray(value)) return { records: [], errors: [`${path} must be a JSON array`] }
    return { records: value, errors: [] }
  } catch {
    return { records: [], errors: [`${path} failed to parse as JSON`] }
  }
}

function parseJsonl(
  bytes: Uint8Array | undefined,
  path: string,
): { records: unknown[]; errors: string[] } {
  if (!bytes) return { records: [], errors: [] }
  const text = decoder.decode(bytes).trim()
  if (!text) return { records: [], errors: [] }
  const records: unknown[] = []
  const errors: string[] = []
  for (const [index, line] of text.split('\n').entries()) {
    try {
      records.push(JSON.parse(line) as unknown)
    } catch {
      errors.push(`${path}:${index + 1} failed to parse as JSON`)
    }
  }
  return { records, errors }
}

function unpackShardFiles(input: Uint8Array | ArrayBuffer | ShardFiles): ShardFiles {
  if (input instanceof Map) return input
  return unpackTarGz(input instanceof ArrayBuffer ? new Uint8Array(input) : input)
}

function parseRecords(
  bytes: Uint8Array | undefined,
  path: string,
  encoding: RecordEncoding,
): { records: unknown[]; errors: string[] } {
  return encoding === 'json-array' ? parseJsonArray(bytes, path) : parseJsonl(bytes, path)
}

function validateLegacyComponentRecords(
  component: ShardComponent,
  records: unknown[],
  path: string,
): string[] {
  const errors: string[] = []
  for (const [index, record] of records.entries()) {
    const result = validateShardComponentRecord(component, record)
    if (!result.valid) {
      errors.push(...result.errors.map((error) => `${path}[${index}] ${error}`))
    }
  }
  return errors
}

function validateLegacyArchive(files: ShardFiles, manifest: ShardManifest): string[] {
  const errors: string[] = []
  const manifestResult = validateShardManifest(manifest)
  if (!manifestResult.valid) {
    errors.push(...manifestResult.errors.map((error) => `manifest.json ${error}`))
  }

  const componentsToValidate = new Set<ShardComponent>(manifest.components)
  for (const [component, spec] of Object.entries(LEGACY_COMPONENT_FILES) as Array<
    [ShardComponent, { file: string; encoding: RecordEncoding }]
  >) {
    if (files.has(spec.file)) componentsToValidate.add(component)
  }

  for (const component of componentsToValidate) {
    const spec = LEGACY_COMPONENT_FILES[component]
    if (!spec) continue
    if (component === 'notes' && manifest.layout?.clusters?.notes?.length) {
      for (const cluster of manifest.layout.clusters.notes) {
        const parsed = parseJsonl(files.get(cluster.href), cluster.href)
        errors.push(...parsed.errors)
        errors.push(...validateLegacyComponentRecords('notes', parsed.records, cluster.href))
      }
      continue
    }
    const parsed = parseRecords(files.get(spec.file), spec.file, spec.encoding)
    errors.push(...parsed.errors)
    errors.push(...validateLegacyComponentRecords(component, parsed.records, spec.file))
  }
  return errors
}

function coreReferenceErrors(records: Map<CoreV1Component, unknown[]>): string[] {
  const errors: string[] = []
  const notes = records.get('notes') as Array<Record<string, unknown>>
  const collections = records.get('collections') as Array<Record<string, unknown>>
  const tags = records.get('tags') as Array<Record<string, unknown>>
  const templates = records.get('templates') as Array<Record<string, unknown>>
  const links = records.get('links') as Array<Record<string, unknown>>
  const noteIds = new Set(notes.map((record) => record.id))
  const collectionIds = new Set(collections.map((record) => record.id))
  const tagNames = new Set(tags.map((record) => record.name))

  for (const [index, collection] of collections.entries()) {
    if (collection.parent_id !== null && !collectionIds.has(collection.parent_id)) {
      errors.push(`collections.json[${index}] parent_id does not reference a declared collection`)
    }
  }
  for (const [index, note] of notes.entries()) {
    if (note.collection_id !== null && !collectionIds.has(note.collection_id)) {
      errors.push(`notes.jsonl[${index}] collection_id does not reference a declared collection`)
    }
    for (const tag of note.tags as string[]) {
      if (!tagNames.has(tag)) {
        errors.push(`notes.jsonl[${index}] tag does not reference a declared tag`)
      }
    }
  }
  for (const [index, template] of templates.entries()) {
    if (template.collection_id !== null && !collectionIds.has(template.collection_id)) {
      errors.push(`templates.json[${index}] collection_id does not reference a declared collection`)
    }
    for (const tag of template.default_tags as string[]) {
      if (!tagNames.has(tag)) {
        errors.push(`templates.json[${index}] default tag does not reference a declared tag`)
      }
    }
  }
  for (const [index, link] of links.entries()) {
    if (!noteIds.has(link.from_note_id)) {
      errors.push(`links.jsonl[${index}] from_note_id does not reference a declared note`)
    }
    if (link.to_note_id !== null && !noteIds.has(link.to_note_id)) {
      errors.push(`links.jsonl[${index}] to_note_id does not reference a declared note`)
    }
  }
  return errors
}

function validateCoreV1Structure(files: ShardFiles, manifest: ShardManifest): string[] {
  const errors: string[] = []
  const schemaVersion = coreSchemaVersion(manifest.version)
  if (!schemaVersion) {
    return ['manifest.json uses an unsupported canonical core-v1 schema version']
  }
  const manifestValidator = coreValidatorFor('manifest', schemaVersion)
  if (!manifestValidator(manifest)) {
    return formatErrors(manifestValidator.errors).map((error) => `manifest.json ${error}`)
  }

  const components = manifest.components as CoreV1Component[]
  const expectedFiles = new Set(components.map((component) => CORE_V1_COMPONENT_FILES[component].file))
  for (const filename of expectedFiles) {
    if (!files.has(filename)) errors.push(`${filename} is declared but missing`)
    if (!(filename in manifest.checksums)) errors.push(`${filename} is missing its declared checksum`)
  }
  for (const filename of Object.keys(manifest.checksums)) {
    if (!expectedFiles.has(filename)) {
      errors.push(`manifest checksum references undeclared file ${filename}`)
    }
  }
  for (const filename of files.keys()) {
    if (filename !== 'manifest.json' && !expectedFiles.has(filename)) {
      errors.push(`archive contains undeclared file ${filename}`)
    }
  }

  const records = new Map<CoreV1Component, unknown[]>()
  for (const component of components) {
    const spec = CORE_V1_COMPONENT_FILES[component]
    const parsed = parseRecords(files.get(spec.file), spec.file, spec.encoding)
    errors.push(...parsed.errors)
    const validator = coreValidatorFor(component, schemaVersion)
    for (const [index, record] of parsed.records.entries()) {
      if (!validator(record)) {
        errors.push(
          ...formatErrors(validator.errors).map((error) => `${spec.file}[${index}] ${error}`),
        )
      }
    }
    const expectedCount = manifest.counts[component]
    if (expectedCount !== parsed.records.length) {
      errors.push(
        `${spec.file} count mismatch: manifest=${String(expectedCount)} actual=${parsed.records.length}`,
      )
    }
    records.set(component, parsed.records)
  }
  for (const component of Object.keys(CORE_V1_COMPONENT_FILES) as CoreV1Component[]) {
    if (!records.has(component)) records.set(component, [])
  }

  if (errors.length === 0) errors.push(...coreReferenceErrors(records))
  return errors
}

function validateFullV1Structure(files: ShardFiles, manifest: ShardManifest): string[] {
  const errors: string[] = []
  const schemaVersion = currentCanonicalSchemaVersion(manifest.version)
  if (!schemaVersion) {
    return ['manifest.json uses an unsupported canonical full-v1 schema version']
  }
  const manifestValidator = fullValidatorFor('manifest', schemaVersion)
  if (!manifestValidator(manifest)) {
    return formatErrors(manifestValidator.errors).map((error) => `manifest.json ${error}`)
  }

  const components = manifest.components as FullV1Component[]
  const expectedFiles = new Set(
    components.map((component) => FULL_V1_COMPONENT_FILES[component].file),
  )
  for (const filename of expectedFiles) {
    if (!files.has(filename)) errors.push(`${filename} is declared but missing`)
    if (!(filename in manifest.checksums)) errors.push(`${filename} is missing its declared checksum`)
  }
  for (const filename of Object.keys(manifest.checksums)) {
    if (!expectedFiles.has(filename)) {
      errors.push(`manifest checksum references undeclared file ${filename}`)
    }
  }
  for (const filename of files.keys()) {
    if (
      filename !== 'manifest.json'
      && filename !== 'signature.json'
      && !isSidecarEntry(filename)
      && !expectedFiles.has(filename)
    ) {
      errors.push(`archive contains undeclared file ${filename}`)
    }
  }

  const records = new Map<FullV1Component, unknown[]>()
  for (const component of components) {
    const spec = FULL_V1_COMPONENT_FILES[component]
    const parsed = parseRecords(files.get(spec.file), spec.file, spec.encoding)
    errors.push(...parsed.errors)
    const validator = fullValidatorFor(component, schemaVersion)
    for (const [index, record] of parsed.records.entries()) {
      if (!validator(record)) {
        errors.push(
          ...formatErrors(validator.errors).map((error) => `${spec.file}[${index}] ${error}`),
        )
      }
    }
    if (component !== 'communities') {
      const expectedCount = manifest.counts[component]
      if (expectedCount !== parsed.records.length) {
        errors.push(
          `${spec.file} count mismatch: manifest=${String(expectedCount)} actual=${parsed.records.length}`,
        )
      }
    }
    records.set(component, parsed.records)
  }

  const communitySets = records.get('communities') as Array<Record<string, unknown>>
  const communityCount = communitySets.reduce((total, set) => {
    const communities = Array.isArray(set.communities) ? set.communities : []
    return total + communities.length
  }, 0)
  if (manifest.counts.community_sets !== communitySets.length) {
    errors.push(
      `communities.json set count mismatch: manifest=${String(manifest.counts.community_sets)} actual=${communitySets.length}`,
    )
  }
  if (manifest.counts.communities !== communityCount) {
    errors.push(
      `communities.json community count mismatch: manifest=${String(manifest.counts.communities)} actual=${communityCount}`,
    )
  }

  const signatureBytes = files.get('signature.json')
  if (signatureBytes) {
    try {
      const signature = JSON.parse(decoder.decode(signatureBytes)) as unknown
      const signatureValidator = fullValidatorFor('signature', schemaVersion)
      if (!signatureValidator(signature)) {
        errors.push(
          ...formatErrors(signatureValidator.errors).map(
            (error) => `signature.json ${error}`,
          ),
        )
      }
    } catch {
      errors.push('signature.json failed to parse as JSON')
    }
  }

  const notes = records.get('notes') as Array<Record<string, unknown>>
  for (const [noteIndex, note] of notes.entries()) {
    const attachments = Array.isArray(note.attachments) ? note.attachments : []
    for (const [attachmentIndex, projection] of attachments.entries()) {
      const attachment = (
        projection as { attachment?: { checksum?: unknown } }
      ).attachment
      if (typeof attachment?.checksum !== 'string') continue
      const sidecar = sidecarEntryName(attachment.checksum)
      if (!files.has(sidecar)) {
        errors.push(
          `notes.jsonl[${noteIndex}].attachments[${attachmentIndex}] is missing mandatory sidecar ${sidecar}`,
        )
      }
    }
  }
  return errors
}

function validateRecordV1Structure(files: ShardFiles, manifest: ShardManifest): string[] {
  const errors: string[] = []
  const schemaVersion = currentCanonicalSchemaVersion(manifest.version)
  if (!schemaVersion) {
    return ['manifest.json uses an unsupported canonical record-v1 schema version']
  }
  const manifestValidator = recordValidatorFor('manifest', schemaVersion)
  if (!manifestValidator(manifest)) {
    return formatErrors(manifestValidator.errors).map((error) => `manifest.json ${error}`)
  }

  const components = manifest.components as RecordV1Component[]
  const expectedFiles = new Set(
    components.map((component) => RECORD_V1_COMPONENT_FILES[component].file),
  )
  for (const filename of expectedFiles) {
    if (!files.has(filename)) errors.push(`${filename} is declared but missing`)
    if (!(filename in manifest.checksums)) errors.push(`${filename} is missing its declared checksum`)
  }
  for (const filename of Object.keys(manifest.checksums)) {
    if (!expectedFiles.has(filename)) {
      errors.push(`manifest checksum references undeclared file ${filename}`)
    }
  }
  for (const filename of files.keys()) {
    if (filename !== 'manifest.json' && !expectedFiles.has(filename)) {
      errors.push(`archive contains undeclared file ${filename}`)
    }
  }

  const records = new Map<CoreV1Component, unknown[]>()
  for (const component of components) {
    const spec = RECORD_V1_COMPONENT_FILES[component]
    const parsed = parseRecords(files.get(spec.file), spec.file, spec.encoding)
    errors.push(...parsed.errors)
    const validator = recordValidatorFor(component, schemaVersion)
    for (const [index, record] of parsed.records.entries()) {
      if (!validator(record)) {
        errors.push(
          ...formatErrors(validator.errors).map((error) => `${spec.file}[${index}] ${error}`),
        )
      }
    }
    const expectedCount = manifest.counts[component]
    if (expectedCount !== parsed.records.length) {
      errors.push(
        `${spec.file} count mismatch: manifest=${String(expectedCount)} actual=${parsed.records.length}`,
      )
    }
    records.set(component, parsed.records)
  }
  for (const component of Object.keys(CORE_V1_COMPONENT_FILES) as CoreV1Component[]) {
    if (!records.has(component)) records.set(component, [])
  }

  if (errors.length === 0) errors.push(...coreReferenceErrors(records))
  return errors
}

export function validateShardArchive(
  input: Uint8Array | ArrayBuffer | ShardFiles,
): ShardSchemaValidationResult {
  let files: ShardFiles
  try {
    files = unpackShardFiles(input)
  } catch {
    return { valid: false, errors: ['archive failed to unpack'] }
  }

  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) return { valid: false, errors: ['manifest.json is missing'] }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  } catch {
    return { valid: false, errors: ['manifest.json failed to parse as JSON'] }
  }

  const profile = profileOf(manifest)
  const errors = profile === 'core-v1'
    ? validateCoreV1Structure(files, manifest)
    : profile === 'record-v1'
      ? validateRecordV1Structure(files, manifest)
      : profile === 'full-v1'
        ? validateFullV1Structure(files, manifest)
        : validateLegacyArchive(files, manifest)
  return { valid: errors.length === 0, errors }
}

export async function validateCoreV1ShardArchive(
  input: Uint8Array | ArrayBuffer | ShardFiles,
): Promise<ShardSchemaValidationResult> {
  let files: ShardFiles
  try {
    files = unpackShardFiles(input)
  } catch {
    return { valid: false, errors: ['archive failed to unpack'] }
  }
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) return { valid: false, errors: ['manifest.json is missing'] }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  } catch {
    return { valid: false, errors: ['manifest.json failed to parse as JSON'] }
  }

  const errors = validateCoreV1Structure(files, manifest)
  if (errors.length > 0) return { valid: false, errors }

  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    errors.push(...checksumResult.failures.map((filename) => `${filename} checksum mismatch`))
  }
  return { valid: errors.length === 0, errors }
}

export async function validateRecordV1ShardArchive(
  input: Uint8Array | ArrayBuffer | ShardFiles,
): Promise<ShardSchemaValidationResult> {
  let files: ShardFiles
  try {
    files = unpackShardFiles(input)
  } catch {
    return { valid: false, errors: ['archive failed to unpack'] }
  }
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) return { valid: false, errors: ['manifest.json is missing'] }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  } catch {
    return { valid: false, errors: ['manifest.json failed to parse as JSON'] }
  }

  const errors = validateRecordV1Structure(files, manifest)
  if (errors.length > 0) return { valid: false, errors }

  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    errors.push(...checksumResult.failures.map((filename) => `${filename} checksum mismatch`))
  }
  return { valid: errors.length === 0, errors }
}

export async function validateFullV1ShardArchive(
  input: Uint8Array | ArrayBuffer | ShardFiles,
): Promise<ShardSchemaValidationResult> {
  let files: ShardFiles
  try {
    files = unpackShardFiles(input)
  } catch {
    return { valid: false, errors: ['archive failed to unpack'] }
  }
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) return { valid: false, errors: ['manifest.json is missing'] }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  } catch {
    return { valid: false, errors: ['manifest.json failed to parse as JSON'] }
  }

  const errors = validateFullV1Structure(files, manifest)
  if (errors.length > 0) return { valid: false, errors }

  const checksumResult = await validateChecksums(manifest.checksums, files)
  if (!checksumResult.valid) {
    errors.push(...checksumResult.failures.map((filename) => `${filename} checksum mismatch`))
  }

  const notesSpec = FULL_V1_COMPONENT_FILES.notes
  const parsedNotes = parseRecords(files.get(notesSpec.file), notesSpec.file, notesSpec.encoding)
  for (const [noteIndex, note] of (
    parsedNotes.records as Array<Record<string, unknown>>
  ).entries()) {
    const attachments = Array.isArray(note.attachments) ? note.attachments : []
    for (const [attachmentIndex, projection] of attachments.entries()) {
      const attachment = (
        projection as { attachment?: { checksum?: unknown } }
      ).attachment
      if (typeof attachment?.checksum !== 'string') continue
      const sidecar = sidecarEntryName(attachment.checksum)
      const bytes = files.get(sidecar)
      if (bytes && computeBlobHash(bytes) !== attachment.checksum) {
        errors.push(
          `notes.jsonl[${noteIndex}].attachments[${attachmentIndex}] sidecar checksum mismatch`,
        )
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

export function validateShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
  profile?: 'core-v1' | 'record-v1' | 'full-v1',
  version: CoreV1SchemaVersion = CURRENT_SHARD_VERSION,
): ShardSchemaValidationResult {
  let validate: ValidateFunction
  if (profile === 'core-v1' && component in CORE_V1_COMPONENT_FILES) {
    validate = coreValidatorFor(component as CoreV1Component, version)
  } else if (profile === 'record-v1' && component in RECORD_V1_COMPONENT_FILES) {
    const canonicalVersion = currentCanonicalSchemaVersion(version)
    if (!canonicalVersion) {
      return {
        valid: false,
        errors: [`(root) uses an unsupported canonical record-v1 schema version ${version}`],
      }
    }
    validate = recordValidatorFor(component as RecordV1Component, canonicalVersion)
  } else if (profile === 'full-v1' && component in FULL_V1_COMPONENT_FILES) {
    const canonicalVersion = currentCanonicalSchemaVersion(version)
    if (!canonicalVersion) {
      return {
        valid: false,
        errors: [`(root) uses an unsupported canonical full-v1 schema version ${version}`],
      }
    }
    validate = fullValidatorFor(component as FullV1Component, canonicalVersion)
  } else {
    const legacyDef = LEGACY_COMPONENT_SCHEMA_DEFS[component]
    if (!legacyDef) {
      return {
        valid: false,
        errors: [`(root) component '${component}' requires an explicit full-v1 profile`],
      }
    }
    validate = legacyValidatorFor(legacyDef)
  }
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}

export function assertShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
  profile?: 'core-v1' | 'record-v1' | 'full-v1',
  version: CoreV1SchemaVersion = CURRENT_SHARD_VERSION,
): void {
  const result = validateShardComponentRecord(component, value, profile, version)
  if (!result.valid) {
    throw new Error(`Invalid shard ${component} record:\n${result.errors.join('\n')}`)
  }
}
