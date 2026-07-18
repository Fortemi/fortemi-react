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
import manifestSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/manifest.schema.json' with { type: 'json' }
import noteSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/note.schema.json' with { type: 'json' }
import collectionSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/collection.schema.json' with { type: 'json' }
import tagSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/tag.schema.json' with { type: 'json' }
import templateSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/template.schema.json' with { type: 'json' }
import linkSchema from '../../schemas/knowledge-shard/1.1.0/core-v1/link.schema.json' with { type: 'json' }
import { validateChecksums } from './checksum.js'
import { unpackTarGz } from './shard-tar.js'
import { CURRENT_SHARD_VERSION } from './types.js'
import type { ShardComponent, ShardManifest } from './types.js'

export interface ShardSchemaValidationResult {
  valid: boolean
  errors: string[]
}

type ShardFiles = Map<string, Uint8Array>
type CoreV1Component = 'notes' | 'collections' | 'tags' | 'templates' | 'links'
export type CoreV1SchemaVersion = '1.0.0' | '1.1.0'
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

const LEGACY_COMPONENT_SCHEMA_DEFS: Record<ShardComponent | 'templates', LegacySchemaDefName> = {
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
    manifest: manifestSchema,
    notes: noteSchema,
    collections: collectionSchema,
    tags: tagSchema,
    templates: templateSchema,
    links: linkSchema,
  },
}

let legacyAjvInstance: Ajv2020 | undefined
let coreAjvInstance: Ajv2020 | undefined
const legacyValidators = new Map<LegacySchemaDefName, ValidateFunction>()
const coreValidators = new Map<string, ValidateFunction>()

export function getKnowledgeShardSchema(): unknown {
  return {
    manifest: manifestSchema,
    notes: noteSchema,
    collections: collectionSchema,
    tags: tagSchema,
    templates: templateSchema,
    links: linkSchema,
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
    for (const bundle of Object.values(CORE_V1_SCHEMAS)) {
      for (const schema of Object.values(bundle)) {
        coreAjvInstance.addSchema(schema)
      }
    }
  }
  return coreAjvInstance
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
  return value === '1.0.0' || value === '1.1.0' ? value : undefined
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
  if (profileOf(value) === 'core-v1') {
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

  const errors = profileOf(manifest) === 'core-v1'
    ? validateCoreV1Structure(files, manifest)
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

export function validateShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
  profile?: 'core-v1',
  version: CoreV1SchemaVersion = CURRENT_SHARD_VERSION,
): ShardSchemaValidationResult {
  let validate: ValidateFunction
  if (profile === 'core-v1' && component in CORE_V1_COMPONENT_FILES) {
    validate = coreValidatorFor(component as CoreV1Component, version)
  } else {
    validate = legacyValidatorFor(LEGACY_COMPONENT_SCHEMA_DEFS[component])
  }
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}

export function assertShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
  profile?: 'core-v1',
  version: CoreV1SchemaVersion = CURRENT_SHARD_VERSION,
): void {
  const result = validateShardComponentRecord(component, value, profile, version)
  if (!result.valid) {
    throw new Error(`Invalid shard ${component} record:\n${result.errors.join('\n')}`)
  }
}
