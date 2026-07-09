import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import schema from '../../schemas/knowledge-shard.schema.json' with { type: 'json' }
import type { ShardComponent } from './types.js'

export interface ShardSchemaValidationResult {
  valid: boolean
  errors: string[]
}

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

