import type { QueryExecutor } from '../storage-backend.js'
import { generateId } from '../uuid.js'
import { nativeUuid, selectNativeFields, upsertNativeFields, type NativeFields, type NativeApplyProgress } from './native-fields.js'

interface SkosEmbedding {
  embedding: number[] | null
  embedding_model: string | null
  embedded_at: string | null
}
export interface NativeSkosScheme extends SkosEmbedding {
  id: string
  uri: string | null
  notation: string
  title: string
  description: string | null
  creator: string | null
  publisher: string | null
  rights: string | null
  version: string | null
  is_active: boolean
  is_system: boolean
  created_at: string
  updated_at: string
  issued_at: string | null
  modified_at: string | null
}
export interface NativeSkosConcept extends SkosEmbedding {
  id: string
  primary_scheme_id: string
  uri: string | null
  notation: string | null
  facet_type: 'personality' | 'matter' | 'energy' | 'space' | 'time' | null
  facet_source: string | null
  facet_domain: string | null
  facet_scope: string | null
  status: 'candidate' | 'approved' | 'deprecated' | 'obsolete'
  promoted_at: string | null
  deprecated_at: string | null
  deprecation_reason: string | null
  replaced_by_id: string | null
  note_count: number
  first_used_at: string | null
  last_used_at: string | null
  depth: number
  broader_count: number
  narrower_count: number
  related_count: number
  antipatterns: ('orphan' | 'over_tagged' | 'under_used' | 'too_broad' | 'too_deep' | 'polyhierarchy_excess' | 'missing_labels' | 'circular_hierarchy')[] | null
  antipattern_checked_at: string | null
  created_at: string
  updated_at: string
}
export interface NativeSkosLabel {
  id: string
  concept_id: string
  label_type: 'pref_label' | 'alt_label' | 'hidden_label'
  value: string
  language: string
  created_at: string
}
export interface NativeSkosNote {
  id: string
  concept_id: string
  note_type: 'definition' | 'scope_note' | 'example' | 'history_note' | 'editorial_note' | 'change_note' | 'note'
  value: string
  language: string
  author: string | null
  source: string | null
  created_at: string
  updated_at: string
}
export interface NativeSkosRelation {
  id: string
  subject_id: string
  object_id: string
  relation_type: 'broader' | 'narrower' | 'related'
  inference_score: number | null
  is_inferred: boolean
  is_validated: boolean
  created_at: string
  created_by: string | null
}
export interface NativeSkosMapping {
  id: string
  concept_id: string
  target_uri: string
  target_scheme_uri: string | null
  target_label: string | null
  relation_type: 'exact_match' | 'close_match' | 'broad_match' | 'narrow_match' | 'related_match'
  confidence: number | null
  is_validated: boolean
  created_at: string
  validated_at: string | null
  validated_by: string | null
}
export interface NativeSkosMembership {
  concept_id: string
  scheme_id: string
  is_top_concept: boolean
  added_at: string
}
export interface NativeNoteSkosTag {
  note_id: string
  concept_id: string
  source: string
  confidence: number | null
  relevance_score: number | null
  is_primary: boolean
  created_at: string
  created_by: string | null
}
export interface NativeSkosCollection {
  id: string
  uri: string | null
  pref_label: string
  definition: string | null
  is_ordered: boolean
  scheme_id: string | null
  created_at: string
  updated_at: string
}
export interface NativeSkosCollectionMember {
  collection_id: string
  concept_id: string
  position: number | null
  added_at: string
}
export interface NativeSkos {
  skos_schemes: NativeSkosScheme[]
  skos_concepts: NativeSkosConcept[]
  skos_labels: NativeSkosLabel[]
  skos_notes: NativeSkosNote[]
  skos_relations: NativeSkosRelation[]
  skos_mapping_relations: NativeSkosMapping[]
  skos_scheme_memberships: NativeSkosMembership[]
  note_skos_tags: NativeNoteSkosTag[]
  skos_collections: NativeSkosCollection[]
  skos_collection_members: NativeSkosCollectionMember[]
}
type Component = keyof NativeSkos
type RecordFor<K extends Component> = NativeSkos[K][number]
const embeddingFields: NativeFields<SkosEmbedding> = {
  embedding: { kind: 'vector' }, embedding_model: {}, embedded_at: { kind: 'timestamp' },
}
const storage: { [K in Component]: { table: string; fields: NativeFields<RecordFor<K>>; keys: string[] } } = {
  skos_schemes: { table: 'skos_scheme', keys: ['id'], fields: {
    id: { kind: 'uuid' }, uri: {}, notation: {}, title: {}, description: {}, creator: {}, publisher: {}, rights: {}, version: {},
    is_active: {}, is_system: {}, created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
    issued_at: { kind: 'timestamp' }, modified_at: { kind: 'timestamp' }, ...embeddingFields,
  } },
  skos_concepts: { table: 'skos_concept', keys: ['id'], fields: {
    id: { kind: 'uuid' }, primary_scheme_id: { column: 'scheme_id', kind: 'uuid' }, uri: {}, notation: {}, facet_type: {},
    facet_source: {}, facet_domain: {}, facet_scope: {}, status: {}, promoted_at: { kind: 'timestamp' },
    deprecated_at: { kind: 'timestamp' }, deprecation_reason: {}, replaced_by_id: { kind: 'uuid' }, note_count: {},
    first_used_at: { kind: 'timestamp' }, last_used_at: { kind: 'timestamp' }, depth: {}, broader_count: {}, narrower_count: {},
    related_count: {}, antipatterns: {}, antipattern_checked_at: { kind: 'timestamp' }, created_at: { kind: 'timestamp' },
    updated_at: { kind: 'timestamp' }, ...embeddingFields,
  } },
  skos_labels: { table: 'skos_concept_label', keys: ['id'], fields: {
    id: { kind: 'uuid' }, concept_id: { kind: 'uuid' }, label_type: {}, value: {}, language: {}, created_at: { kind: 'timestamp' },
  } },
  skos_notes: { table: 'skos_concept_note', keys: ['id'], fields: {
    id: { kind: 'uuid' }, concept_id: { kind: 'uuid' }, note_type: {}, value: {}, language: {}, author: {}, source: {},
    created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
  } },
  skos_relations: { table: 'skos_concept_relation', keys: ['id'], fields: {
    id: { kind: 'uuid' }, subject_id: { column: 'source_concept_id', kind: 'uuid' },
    object_id: { column: 'target_concept_id', kind: 'uuid' }, relation_type: {}, inference_score: {}, is_inferred: {},
    is_validated: {}, created_at: { kind: 'timestamp' }, created_by: {},
  } },
  skos_mapping_relations: { table: 'skos_mapping_relation', keys: ['id'], fields: {
    id: { kind: 'uuid' }, concept_id: { kind: 'uuid' }, target_uri: {}, target_scheme_uri: {}, target_label: {},
    relation_type: {}, confidence: {}, is_validated: {}, created_at: { kind: 'timestamp' }, validated_at: { kind: 'timestamp' }, validated_by: {},
  } },
  skos_scheme_memberships: { table: 'skos_scheme_membership', keys: ['concept_id', 'scheme_id'], fields: {
    concept_id: { kind: 'uuid' }, scheme_id: { kind: 'uuid' }, is_top_concept: {}, added_at: { kind: 'timestamp' },
  } },
  note_skos_tags: { table: 'note_skos_tag', keys: ['note_id', 'concept_id'], fields: {
    note_id: { kind: 'uuid' }, concept_id: { kind: 'uuid' }, source: {}, confidence: {}, relevance_score: {}, is_primary: {},
    created_at: { kind: 'timestamp' }, created_by: {},
  } },
  skos_collections: { table: 'skos_collection', keys: ['id'], fields: {
    id: { kind: 'uuid' }, uri: {}, pref_label: {}, definition: {}, is_ordered: {}, scheme_id: { kind: 'uuid' },
    created_at: { kind: 'timestamp' }, updated_at: { kind: 'timestamp' },
  } },
  skos_collection_members: { table: 'skos_collection_member', keys: ['collection_id', 'concept_id'], fields: {
    collection_id: { kind: 'uuid' }, concept_id: { kind: 'uuid' }, position: {}, added_at: { kind: 'timestamp' },
  } },
}

/** Remove only omitted selected-owner children; retained native references survive upsert. */
export async function removeOmittedNativeSkos(tx: QueryExecutor, state: NativeSkos, selectedNoteIds: string[]): Promise<void> {
  const concepts = state.skos_concepts.map((row) => nativeUuid(row.id)!)
  const owned: Array<[Component, string, string[]]> = [
    ['skos_labels', 'concept_id', concepts], ['skos_notes', 'concept_id', concepts],
    ['skos_relations', 'source_concept_id', concepts], ['skos_mapping_relations', 'concept_id', concepts],
    ['skos_scheme_memberships', 'concept_id', concepts], ['note_skos_tags', 'note_id', selectedNoteIds.map((id) => nativeUuid(id)!)],
    ['skos_collection_members', 'collection_id', state.skos_collections.map((row) => nativeUuid(row.id)!)],
  ]
  for (const [component, owner, selected] of owned) {
    if (selected.length === 0) continue
    const { table, keys } = storage[component]
    const incoming = state[component] as unknown as Record<string, string>[]
    await tx.query(`DELETE FROM ${table} existing WHERE existing.${owner} = ANY($1::text[])
      AND NOT EXISTS (SELECT 1 FROM UNNEST(${keys.map((_, index) => `$${index + 2}::text[]`).join(', ')}) incoming(${keys.join(', ')})
        WHERE ${keys.map((key) => `incoming.${key} = existing.${key}`).join(' AND ')})`,
    [selected, ...keys.map((key) => incoming.map((row) => nativeUuid(row[key])))])
  }
}

/** Internal stage; caller validates the whole archive, resolves conflicts and
 * selected-row deletion, and owns the surrounding transaction. */
export async function applyValidatedNativeSkos(tx: QueryExecutor, state: NativeSkos, progress?: NativeApplyProgress): Promise<void> {
  async function apply<K extends Component>(component: K): Promise<void> {
    const { table, fields, keys } = storage[component]
    for (const row of state[component]) {
      const extra = component === 'note_skos_tags' ? { id: generateId() }
        : component === 'skos_concepts' ? { pref_label: (row as NativeSkosConcept).notation ?? (row as NativeSkosConcept).id, deleted_at: null }
          : component === 'skos_schemes' ? { deleted_at: null } : {}
      await upsertNativeFields(tx, table, row, fields, keys, extra, component === 'note_skos_tags' ? ['id'] : [])
      await progress?.(component)
    }
  }
  for (const component of Object.keys(storage) as Component[]) await apply(component)
  for (const row of state.skos_concepts) await tx.query('SELECT refresh_skos_concept_display($1)', [nativeUuid(row.id)])
}

/** Native typed reads with fixed, parameterized field filters. */
export async function readNativeSkosComponent<K extends Component>(
  tx: QueryExecutor, component: K, filter: Partial<Record<keyof RecordFor<K>, string>> = {},
): Promise<RecordFor<K>[]> {
  const { table, fields, keys } = storage[component]
  const params: unknown[] = []
  const predicates = Object.entries(filter).map(([name, value]) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`Unknown SKOS filter: ${name}`)
    const field = fields[name as keyof typeof fields]
    params.push(field.kind === 'uuid' ? nativeUuid(value as string) : value)
    return `${field.column ?? name} = $${params.length}`
  })
  if (component === 'skos_schemes' || component === 'skos_concepts') predicates.push('deleted_at IS NULL')
  const rows = await tx.query<RecordFor<K>>(`SELECT ${selectNativeFields(fields)} FROM ${table}
    ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY ${keys.join(', ')}`, params)
  return rows.rows
}

/** Unscoped internal reader fails on tombstones, which full-v1 cannot encode. */
export async function readNativeSkos(tx: QueryExecutor, deferValidation = false): Promise<NativeSkos> {
  const tombstones = await tx.query(`SELECT id FROM skos_scheme WHERE deleted_at IS NOT NULL
    UNION ALL SELECT id FROM skos_concept WHERE deleted_at IS NOT NULL LIMIT 1`)
  if (!deferValidation && tombstones.rows.length) throw new Error('unrepresentable-live-tombstone: native SKOS full-v1')
  return {
    skos_schemes: await readNativeSkosComponent(tx, 'skos_schemes'),
    skos_concepts: await readNativeSkosComponent(tx, 'skos_concepts'),
    skos_labels: await readNativeSkosComponent(tx, 'skos_labels'),
    skos_notes: await readNativeSkosComponent(tx, 'skos_notes'),
    skos_relations: await readNativeSkosComponent(tx, 'skos_relations'),
    skos_mapping_relations: await readNativeSkosComponent(tx, 'skos_mapping_relations'),
    skos_scheme_memberships: await readNativeSkosComponent(tx, 'skos_scheme_memberships'),
    note_skos_tags: await readNativeSkosComponent(tx, 'note_skos_tags'),
    skos_collections: await readNativeSkosComponent(tx, 'skos_collections'),
    skos_collection_members: await readNativeSkosComponent(tx, 'skos_collection_members'),
  }
}
