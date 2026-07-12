import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import schema from '../../schemas/knowledge-shard.schema.json' with { type: 'json' }
import { unpackTarGz } from './shard-tar.js'
import type { ShardComponent, ShardManifest } from './types.js'

export interface ShardSchemaValidationResult {
  valid: boolean
  errors: string[]
}

type ShardFiles = Map<string, Uint8Array>

const decoder = new TextDecoder()

type SchemaDefName =
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

const COMPONENT_SCHEMA_DEFS: Record<ShardComponent | 'templates', SchemaDefName> = {
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

const COMPONENT_FILES: Partial<Record<ShardComponent, { file: string; encoding: 'json-array' | 'jsonl' }>> = {
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

let ajvInstance: Ajv2020 | undefined
const validators = new Map<SchemaDefName, ValidateFunction>()

export function getKnowledgeShardSchema(): unknown {
  return schema
}

function getAjv(): Ajv2020 {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    })
    ajvInstance.addSchema(schema)
  }
  return ajvInstance
}

function validatorFor(defName: SchemaDefName): ValidateFunction {
  const cached = validators.get(defName)
  if (cached) return cached
  const validator = getAjv().getSchema(`${schema.$id}#/$defs/${defName}`)
    ?? getAjv().compile({ $ref: `${schema.$id}#/$defs/${defName}` })
  validators.set(defName, validator)
  return validator
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || '(root)'
    return `${path} ${error.message ?? 'is invalid'}`
  })
}

export function validateShardManifest(value: unknown): ShardSchemaValidationResult {
  const validate = validatorFor('manifest')
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}

function parseJsonArray(bytes: Uint8Array | undefined, path: string): { records: unknown[]; errors: string[] } {
  if (!bytes) return { records: [], errors: [] }
  try {
    const value = JSON.parse(decoder.decode(bytes)) as unknown
    if (!Array.isArray(value)) return { records: [], errors: [`${path} must be a JSON array`] }
    return { records: value, errors: [] }
  } catch (error) {
    return { records: [], errors: [`${path} failed to parse: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

function parseJsonl(bytes: Uint8Array | undefined, path: string): { records: unknown[]; errors: string[] } {
  if (!bytes) return { records: [], errors: [] }
  const text = decoder.decode(bytes).trim()
  if (!text) return { records: [], errors: [] }
  const records: unknown[] = []
  const errors: string[] = []
  for (const [index, line] of text.split('\n').entries()) {
    try {
      records.push(JSON.parse(line) as unknown)
    } catch (error) {
      errors.push(`${path}:${index + 1} failed to parse: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { records, errors }
}

function unpackShardFiles(input: Uint8Array | ArrayBuffer | ShardFiles): ShardFiles {
  if (input instanceof Map) return input
  return unpackTarGz(input instanceof ArrayBuffer ? new Uint8Array(input) : input)
}

function validateComponentRecords(
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

export function validateShardArchive(input: Uint8Array | ArrayBuffer | ShardFiles): ShardSchemaValidationResult {
  let files: ShardFiles
  try {
    files = unpackShardFiles(input)
  } catch (error) {
    return {
      valid: false,
      errors: [`archive failed to unpack: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) return { valid: false, errors: ['manifest.json is missing'] }

  let manifest: ShardManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  } catch (error) {
    return {
      valid: false,
      errors: [`manifest.json failed to parse: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  const errors: string[] = []
  const manifestResult = validateShardManifest(manifest)
  if (!manifestResult.valid) {
    errors.push(...manifestResult.errors.map((error) => `manifest.json ${error}`))
  }

  const componentsToValidate = new Set<ShardComponent>(manifest.components)
  for (const [component, spec] of Object.entries(COMPONENT_FILES) as Array<[ShardComponent, { file: string; encoding: 'json-array' | 'jsonl' }]>) {
    if (files.has(spec.file)) componentsToValidate.add(component)
  }

  for (const component of componentsToValidate) {
    const spec = COMPONENT_FILES[component]
    if (!spec) continue
    if (component === 'notes' && manifest.layout?.clusters?.notes?.length) {
      for (const cluster of manifest.layout.clusters.notes) {
        const parsed = parseJsonl(files.get(cluster.href), cluster.href)
        errors.push(...parsed.errors)
        errors.push(...validateComponentRecords('notes', parsed.records, cluster.href))
      }
      continue
    }
    const parsed = spec.encoding === 'json-array'
      ? parseJsonArray(files.get(spec.file), spec.file)
      : parseJsonl(files.get(spec.file), spec.file)
    errors.push(...parsed.errors)
    errors.push(...validateComponentRecords(component, parsed.records, spec.file))
  }

  return { valid: errors.length === 0, errors }
}

export function validateShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
): ShardSchemaValidationResult {
  const defName = COMPONENT_SCHEMA_DEFS[component]
  const validate = validatorFor(defName)
  const valid = validate(value)
  return { valid, errors: formatErrors(validate.errors) }
}

export function assertShardComponentRecord(
  component: ShardComponent | 'templates',
  value: unknown,
): void {
  const result = validateShardComponentRecord(component, value)
  if (!result.valid) {
    throw new Error(`Invalid shard ${component} record:\n${result.errors.join('\n')}`)
  }
}
