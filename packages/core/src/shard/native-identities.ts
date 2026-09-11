import type { NativeState } from './native-full-v1-import.js'

export type NativeIdentity = { table: string; keys: string[]; uuid?: boolean[] }

// Fixed native identities, never identifiers supplied by archive data. Original
// and current records are keyed by note owner, not the original's nullable id.
export const nativeIdentities: Record<keyof NativeState, NativeIdentity> = {
  notes: { table: 'note', keys: ['id'] },
  collections: { table: 'collection', keys: ['id'] },
  tags: { table: 'tag', keys: ['name'], uuid: [false] },
  templates: { table: 'template', keys: ['id'] },
  links: { table: '(SELECT id FROM link UNION ALL SELECT id FROM link_url_target) native_link', keys: ['id'] },
  note_originals: { table: 'note_original', keys: ['note_id'] },
  note_original_history: { table: 'note_original_history', keys: ['id'] },
  note_revisions: { table: 'note_revision', keys: ['id'] },
  note_revised_current: { table: 'note_revised_current', keys: ['note_id'] },
  embedding_configs: { table: 'embedding_config', keys: ['id'] },
  embedding_sets: { table: 'embedding_set', keys: ['id'] },
  embedding_set_members: { table: 'embedding_set_member', keys: ['embedding_set_id', 'note_id'] },
  embeddings: { table: 'embedding', keys: ['id'] },
  skos_schemes: { table: 'skos_scheme', keys: ['id'] },
  skos_concepts: { table: 'skos_concept', keys: ['id'] },
  skos_labels: { table: 'skos_concept_label', keys: ['id'] },
  skos_notes: { table: 'skos_concept_note', keys: ['id'] },
  skos_relations: { table: 'skos_concept_relation', keys: ['id'] },
  skos_mapping_relations: { table: 'skos_mapping_relation', keys: ['id'] },
  skos_scheme_memberships: { table: 'skos_scheme_membership', keys: ['concept_id', 'scheme_id'] },
  note_skos_tags: { table: 'note_skos_tag', keys: ['note_id', 'concept_id'] },
  skos_collections: { table: 'skos_collection', keys: ['id'] },
  skos_collection_members: { table: 'skos_collection_member', keys: ['collection_id', 'concept_id'] },
  provenance_activities: { table: 'provenance_edge', keys: ['id'] },
  provenance_edges: { table: 'provenance_derivation', keys: ['id'] },
  named_locations: { table: 'named_location', keys: ['id'] },
  provenance_locations: { table: 'provenance_location', keys: ['id'] },
  provenance_devices: { table: 'provenance_device', keys: ['id'] },
  provenance_records: { table: 'provenance_record', keys: ['id'] },
  graph_sources: { table: 'graph_source', keys: ['id'], uuid: [false] },
  graph_edges: { table: 'graph_edge_artifact', keys: ['graph_source_id', 'from_note_id', 'to_note_id', 'kind'], uuid: [false, true, true, false] },
  communities: { table: 'community_set', keys: ['id'], uuid: [false] },
  community_assignments: { table: 'community_assignment', keys: ['community_set_id', 'note_id'], uuid: [false, true] },
}

export function nativeIdentityKey(spec: NativeIdentity, row: Record<string, unknown>): string {
  return JSON.stringify(spec.keys.map((name, i) => {
    const value = row[name]
    return (spec.uuid?.[i] ?? true) && typeof value === 'string' ? value.toLowerCase() : value
  }))
}
