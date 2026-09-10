import type { ShardComponent } from './types.js'

type Row = Record<string, unknown>
type Records = ReadonlyMap<ShardComponent, readonly unknown[]>
const uuid = (value: unknown): unknown => typeof value === 'string' ? value.toLowerCase() : value
const key = (...values: unknown[]): string => JSON.stringify(values)
const present = (value: unknown): boolean => value !== null && value !== undefined

/** Relationship checks run only after every component has passed its authority schema. */
export function fullV1ReferenceErrors(records: Records): string[] {
  const errors: string[] = []
  const rows = (component: ShardComponent): readonly Row[] => (records.get(component) ?? []) as readonly Row[]
  const check = (ok: unknown, component: ShardComponent, index: number, message: string): void => {
    if (!ok && errors.length < 100) errors.push(`${component}[${index}]: ${message}`)
  }
  const unique = (component: ShardComponent, identity: (row: Row) => unknown): Set<unknown> => {
    const seen = new Set<unknown>()
    rows(component).forEach((row, index) => {
      const value = identity(row)
      if (!present(value)) return
      check(!seen.has(value), component, index, 'duplicate identity or coordinates')
      seen.add(value)
    })
    return seen
  }
  const ids = (component: ShardComponent): Set<unknown> => unique(component, (row) => uuid(row.id))
  const ref = (row: Row, field: string, targets: Set<unknown>, component: ShardComponent,
    index: number, optional = false, normalize = true): void => {
    if (optional && !present(row[field])) return
    check(targets.has(normalize ? uuid(row[field]) : row[field]), component, index,
      `${field} does not reference a declared record`)
  }

  const notes = ids('notes')
  const collections = ids('collections')
  const collectionRows = new Map(rows('collections').map((row) => [uuid(row.id), row]))
  const completed = new Set<unknown>()
  rows('collections').forEach((row, index) => {
    ref(row, 'parent_id', collections, 'collections', index, true)
    const path = new Set<unknown>()
    let current: Row | undefined = row
    while (current && !completed.has(uuid(current.id))) {
      const id = uuid(current.id)
      if (path.has(id)) {
        check(false, 'collections', index, 'collection hierarchy contains a cycle')
        break
      }
      path.add(id)
      current = collectionRows.get(uuid(current.parent_id))
    }
    for (const id of path) completed.add(id)
  })
  ids('templates')
  rows('templates').forEach((row, index) => ref(row, 'collection_id', collections, 'templates', index, true))
  const attachmentIds = new Set<unknown>()
  const digests = new Map<unknown, string>()
  rows('notes').forEach((row, index) => {
    ref(row, 'collection_id', collections, 'notes', index, true)
    for (const projection of (row.attachments ?? []) as Row[]) {
      const attachment = projection.attachment as Row
      const id = uuid(attachment.id)
      check(!attachmentIds.has(id), 'notes', index, 'duplicate attachment identity')
      attachmentIds.add(id)
      const declaration = key(attachment.bytes, attachment.mime)
      check(!digests.has(attachment.checksum) || digests.get(attachment.checksum) === declaration,
        'notes', index, 'attachment digest declarations conflict')
      digests.set(attachment.checksum, declaration)
    }
  })
  ids('links')
  rows('links').forEach((row, index) => {
    ref(row, 'from_note_id', notes, 'links', index)
    ref(row, 'to_note_id', notes, 'links', index, true)
  })

  const noteRows = new Map(rows('notes').map((row) => [uuid(row.id), row]))
  const originals = new Map(rows('note_originals').map((row) => [uuid(row.note_id), row]))
  unique('note_originals', (row) => uuid(row.note_id))
  rows('note_originals').forEach((row, index) => {
    ref(row, 'note_id', notes, 'note_originals', index)
    const note = noteRows.get(uuid(row.note_id))
    // Match the producer's comparison only when both summary contents are strings.
    if (typeof note?.original_content === 'string' && typeof note.revised_content === 'string') {
      check(note.original_content === row.content, 'note_originals', index, 'current original content conflicts with note')
    }
  })
  ids('note_original_history')
  unique('note_original_history', (row) => key(uuid(row.note_id), row.version_number))
  rows('note_original_history').forEach((row, index) => {
    ref(row, 'note_id', notes, 'note_original_history', index)
    const current = originals.get(uuid(row.note_id))
    check(!current || Number(row.version_number) < Number(current.version_number),
      'note_original_history', index, 'original history version ordering is invalid')
  })
  const revisionIds = ids('note_revisions')
  unique('note_revisions', (row) => key(uuid(row.note_id), row.revision_number))
  const revisions = new Map(rows('note_revisions').map((row) => [uuid(row.id), row]))
  rows('note_revisions').forEach((row, index) => {
    ref(row, 'note_id', notes, 'note_revisions', index)
    if (present(row.parent_revision_id)) {
      const parent = revisions.get(uuid(row.parent_revision_id))
      check(parent && uuid(parent.note_id) === uuid(row.note_id)
        && Number(parent.revision_number) < Number(row.revision_number),
      'note_revisions', index, 'revision parent ownership or ordering is invalid')
    }
  })
  unique('note_revised_current', (row) => uuid(row.note_id))
  rows('note_revised_current').forEach((row, index) => {
    ref(row, 'note_id', notes, 'note_revised_current', index)
    const note = noteRows.get(uuid(row.note_id))
    if (typeof note?.original_content === 'string' && typeof note.revised_content === 'string') {
      check(note.revised_content === row.content, 'note_revised_current', index, 'current revised content conflicts with note')
    }
    if (present(row.last_revision_id)) {
      const last = revisions.get(uuid(row.last_revision_id))
      check(last && uuid(last.note_id) === uuid(row.note_id) && last.content === row.content,
        'note_revised_current', index, 'last revision ownership or content is invalid')
    }
  })

  ids('provenance_edges')
  rows('provenance_edges').forEach((row, index) => {
    ref(row, 'revision_id', revisionIds, 'provenance_edges', index, true)
    ref(row, 'source_note_id', notes, 'provenance_edges', index, true)
  })
  const activities = ids('provenance_activities')
  rows('provenance_activities').forEach((row, index) => {
    ref(row, 'note_id', notes, 'provenance_activities', index)
    if (present(row.revision_id)) {
      check(uuid(revisions.get(uuid(row.revision_id))?.note_id) === uuid(row.note_id),
        'provenance_activities', index, 'revision belongs to another or unknown note')
    }
  })
  const namedLocations = ids('named_locations')
  unique('named_locations', (row) => row.slug)
  const locations = ids('provenance_locations')
  rows('provenance_locations').forEach((row, index) => {
    ref(row, 'named_location_id', namedLocations, 'provenance_locations', index, true)
  })
  const devices = ids('provenance_devices')
  unique('provenance_devices', (row) => key(row.device_make, row.device_model, uuid(row.owner_id)))
  ids('provenance_records')
  unique('provenance_records', (row) => uuid(row.note_id))
  rows('provenance_records').forEach((row, index) => {
    check(present(row.note_id) || present(row.attachment_id), 'provenance_records', index, 'target is required')
    ref(row, 'note_id', notes, 'provenance_records', index, true)
    ref(row, 'attachment_id', attachmentIds, 'provenance_records', index, true)
    ref(row, 'location_id', locations, 'provenance_records', index, true)
    ref(row, 'original_location_id', locations, 'provenance_records', index, true)
    ref(row, 'device_id', devices, 'provenance_records', index, true)
    ref(row, 'activity_id', activities, 'provenance_records', index, true)
    for (const field of ['capture_time', 'original_capture_time']) {
      if (present(row[field])) check(validTimestampRange(row[field] as Row), 'provenance_records', index,
        `${field} bounds are inconsistent`)
    }
  })

  const configs = ids('embedding_configs')
  unique('embedding_configs', (row) => row.name)
  const configRows = new Map(rows('embedding_configs').map((row) => [uuid(row.id), row]))
  const sets = ids('embedding_sets')
  unique('embedding_sets', (row) => row.name)
  unique('embedding_sets', (row) => row.slug)
  const dimensions = new Map<unknown, number>()
  rows('embedding_sets').forEach((row, index) => {
    ref(row, 'embedding_config_id', configs, 'embedding_sets', index, true)
    const config = configRows.get(uuid(row.embedding_config_id))
    if (config) dimensions.set(uuid(row.id), Number(row.truncate_dim ?? config.dimension))
  })
  unique('embedding_set_members', (row) => key(uuid(row.embedding_set_id), uuid(row.note_id)))
  rows('embedding_set_members').forEach((row, index) => {
    ref(row, 'embedding_set_id', sets, 'embedding_set_members', index)
    ref(row, 'note_id', notes, 'embedding_set_members', index)
  })
  ids('embeddings')
  unique('embeddings', (row) => present(row.note_id) && present(row.embedding_set_id)
    ? key(uuid(row.note_id), uuid(row.embedding_set_id), row.chunk_index) : null)
  rows('embeddings').forEach((row, index) => {
    ref(row, 'note_id', notes, 'embeddings', index, true)
    ref(row, 'embedding_set_id', sets, 'embeddings', index, true)
    if (Array.isArray(row.vector) && dimensions.has(uuid(row.embedding_set_id))) {
      check(row.vector.length === dimensions.get(uuid(row.embedding_set_id)), 'embeddings', index,
        'vector dimension conflicts with the set configuration')
    }
  })

  const schemes = ids('skos_schemes')
  unique('skos_schemes', (row) => row.notation)
  unique('skos_schemes', (row) => row.uri)
  const concepts = ids('skos_concepts')
  unique('skos_concepts', (row) => row.uri)
  unique('skos_concepts', (row) => present(row.notation) ? key(uuid(row.primary_scheme_id), row.notation) : null)
  rows('skos_concepts').forEach((row, index) => {
    ref(row, 'primary_scheme_id', schemes, 'skos_concepts', index)
    ref(row, 'replaced_by_id', concepts, 'skos_concepts', index, true)
    check(uuid(row.replaced_by_id) !== uuid(row.id), 'skos_concepts', index, 'concept replaces itself')
  })
  ids('skos_labels')
  unique('skos_labels', (row) => key(uuid(row.concept_id), row.label_type, row.language, row.value))
  unique('skos_labels', (row) => row.label_type === 'pref_label' ? key(uuid(row.concept_id), row.language) : null)
  rows('skos_labels').forEach((row, index) => ref(row, 'concept_id', concepts, 'skos_labels', index))
  ids('skos_notes')
  rows('skos_notes').forEach((row, index) => ref(row, 'concept_id', concepts, 'skos_notes', index))
  ids('skos_relations')
  unique('skos_relations', (row) => key(uuid(row.subject_id), uuid(row.object_id), row.relation_type))
  rows('skos_relations').forEach((row, index) => {
    ref(row, 'subject_id', concepts, 'skos_relations', index)
    ref(row, 'object_id', concepts, 'skos_relations', index)
    check(uuid(row.subject_id) !== uuid(row.object_id), 'skos_relations', index, 'self relation is invalid')
  })
  ids('skos_mapping_relations')
  unique('skos_mapping_relations', (row) => key(uuid(row.concept_id), row.target_uri, row.relation_type))
  rows('skos_mapping_relations').forEach((row, index) => ref(row, 'concept_id', concepts, 'skos_mapping_relations', index))
  unique('skos_scheme_memberships', (row) => key(uuid(row.concept_id), uuid(row.scheme_id)))
  rows('skos_scheme_memberships').forEach((row, index) => {
    ref(row, 'concept_id', concepts, 'skos_scheme_memberships', index)
    ref(row, 'scheme_id', schemes, 'skos_scheme_memberships', index)
  })
  unique('note_skos_tags', (row) => key(uuid(row.note_id), uuid(row.concept_id)))
  rows('note_skos_tags').forEach((row, index) => {
    ref(row, 'note_id', notes, 'note_skos_tags', index)
    ref(row, 'concept_id', concepts, 'note_skos_tags', index)
  })
  const skosCollections = ids('skos_collections')
  unique('skos_collections', (row) => row.uri)
  rows('skos_collections').forEach((row, index) => ref(row, 'scheme_id', schemes, 'skos_collections', index, true))
  unique('skos_collection_members', (row) => key(uuid(row.collection_id), uuid(row.concept_id)))
  rows('skos_collection_members').forEach((row, index) => {
    ref(row, 'collection_id', skosCollections, 'skos_collection_members', index)
    ref(row, 'concept_id', concepts, 'skos_collection_members', index)
  })

  // Graph/community IDs are opaque strings, not UUIDs: preserve their case.
  const sources = unique('graph_sources', (row) => row.id)
  rows('graph_sources').forEach((row, index) => {
    if (present(row.dimension) && present(row.truncate_dimension)) {
      check(Number(row.truncate_dimension) <= Number(row.dimension), 'graph_sources', index,
        'truncate dimension exceeds source dimension')
    }
  })
  unique('graph_edges', (row) => key(row.graph_source_id, uuid(row.from_note_id), uuid(row.to_note_id), row.kind))
  rows('graph_edges').forEach((row, index) => {
    ref(row, 'graph_source_id', sources, 'graph_edges', index, false, false)
    ref(row, 'from_note_id', notes, 'graph_edges', index)
    ref(row, 'to_note_id', notes, 'graph_edges', index)
    check(uuid(row.from_note_id) !== uuid(row.to_note_id), 'graph_edges', index, 'self edge is invalid')
  })
  unique('communities', (row) => row.id)
  const communities = new Set<string>()
  rows('communities').forEach((row, index) => {
    ref(row, 'graph_source_id', sources, 'communities', index, false, false)
    for (const community of row.communities as Row[]) {
      const id = key(row.id, community.id)
      check(!communities.has(id), 'communities', index, 'duplicate community identity within set')
      communities.add(id)
      const representatives = new Set<unknown>()
      for (const noteId of (community.representative_note_ids ?? []) as unknown[]) {
        check(notes.has(uuid(noteId)) && !representatives.has(uuid(noteId)), 'communities', index,
          'unknown or duplicate representative note')
        representatives.add(uuid(noteId))
      }
    }
  })
  unique('community_assignments', (row) => key(row.community_set_id, uuid(row.note_id)))
  rows('community_assignments').forEach((row, index) => {
    check(communities.has(key(row.community_set_id, row.community_id)), 'community_assignments', index,
      'community does not belong to the declared set')
    ref(row, 'note_id', notes, 'community_assignments', index)
  })
  return errors
}

function validTimestampRange(range: Row): boolean {
  if (range.empty === true) return !present(range.lower) && !present(range.upper)
    && !range.lower_inclusive && !range.upper_inclusive && !range.lower_infinite && !range.upper_infinite
  if (range.lower_infinite ? present(range.lower) || range.lower_inclusive : !present(range.lower)) return false
  if (range.upper_infinite ? present(range.upper) || range.upper_inclusive : !present(range.upper)) return false
  if (!present(range.lower) || !present(range.upper)) return true
  const instant = (value: unknown): bigint | null => {
    const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i.exec(String(value))
    if (!match) return null
    const seconds = Date.parse(`${match[1]}${match[3]}`)
    if (!Number.isFinite(seconds)) return null
    return BigInt(seconds) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0').slice(0, 9))
  }
  const lower = instant(range.lower)
  const upper = instant(range.upper)
  return lower !== null && upper !== null && (lower < upper
    || (lower === upper && range.lower_inclusive === true && range.upper_inclusive === true))
}
