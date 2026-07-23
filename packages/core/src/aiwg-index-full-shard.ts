import type {
  AiwgFortemiIndexExport,
  AiwgFortemiRecord,
  AiwgFortemiSkosConcept,
} from './aiwg-index.js'
import authorityReceipt from '../schemas/knowledge-shard-v2.schema.receipt.json' with { type: 'json' }
import { sha256Hex } from './shard/checksum.js'
import { FULL_V1_COMPONENT_FILES, validateFullV1ShardArchive } from './shard/schema-validator.js'
import { packTarGz } from './shard/shard-tar.js'
import { SHARD_FORMAT } from './shard/types.js'
import type { ShardComponent, ShardLossEntry, ShardManifest } from './shard/types.js'
import { v5 as uuidv5 } from 'uuid'

const encoder = new TextEncoder()
const UUID_NAMESPACE = '7ab5d1f8-29d2-5e35-9e2f-3a45de171a9e'

export interface AiwgFullV1ConversionOptions {
  createdAt?: string
  matricVersion?: string
}

export interface AiwgFullV1ConversionResult {
  success: boolean
  archive: Uint8Array | null
  profile: 'full-v1'
  schema_version: '2.0.0'
  /** Structural validity is separate from semantic losslessness. */
  lossless: boolean
  losses: ShardLossEntry[]
  receipt: {
    schema_version: 'fortemi.aiwg-full-v1-conversion-receipt.v1'
    source_schema_version: 'aiwg.fortemi.index.export.v2'
    authority_repository: string
    authority_commit: string
    authority_contract_sha256: string
    authority_schema_bundle_sha256: string
    manifest_sha256: string | null
    component_checksums: Record<string, string>
    contract_valid: boolean
    signed: false
  }
}

function uuid(kind: string, id: string): string {
  return uuidv5(`${kind}:${id}`, UUID_NAMESPACE)
}

function own(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field)
}

function timestamp(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function addLoss(
  losses: ShardLossEntry[],
  code: string,
  message: string,
  details: Partial<ShardLossEntry> = {},
): void {
  losses.push({ code, message, ...details })
}

function encode(values: unknown[], encoding: 'json-array' | 'jsonl'): Uint8Array {
  return encoder.encode(encoding === 'json-array'
    ? JSON.stringify(values)
    : values.map((value) => JSON.stringify(value)).join('\n'))
}

function noteTitle(record: AiwgFortemiRecord, losses: ShardLossEntry[]): string | null {
  if (own(record, 'title')) return record.title ?? null
  const derived = record.search?.title ?? record.search?.name
  addLoss(losses, 'aiwg-title-not-native', derived
    ? 'Title was derived from the AIWG search projection.'
    : 'AIWG supplied no title; the nullable destination field is null.', {
    component: 'notes', record_id: record.id, field_path: '/title', source_state: 'absent',
    destination_capability: 'nullable-value', action: derived ? 'degrade' : 'default',
  })
  return derived ?? null
}

function noteContent(record: AiwgFortemiRecord, losses: ShardLossEntry[]): string {
  if (own(record, 'text')) return record.text ?? ''
  if (own(record.search ?? {}, 'body')) {
    addLoss(losses, 'aiwg-content-search-projection',
      'Content was derived from the AIWG search projection.', {
        component: 'notes', record_id: record.id, field_path: '/original_content',
        source_state: 'absent', destination_capability: 'required-string', action: 'degrade',
      })
    return record.search?.body ?? ''
  }
  if (record.chunks?.length) {
    addLoss(losses, 'aiwg-content-chunk-projection', 'Content was assembled from AIWG chunks.', {
      component: 'notes', record_id: record.id, field_path: '/original_content',
      source_state: 'absent', destination_capability: 'required-string', action: 'degrade',
    })
    return record.chunks.map((chunk) => {
      if (own(chunk, 'text')) return chunk.text ?? ''
      if (own(chunk, 'body')) return chunk.body ?? ''
      if (own(chunk, 'summary')) return chunk.summary ?? ''
      return ''
    }).join('\n\n')
  }
  addLoss(losses, 'aiwg-content-unavailable',
    'AIWG supplied no body; the required destination string is empty.', {
      component: 'notes', record_id: record.id, field_path: '/original_content',
      source_state: 'absent', destination_capability: 'required-string', action: 'default',
    })
  return ''
}

function createdAt(record: AiwgFortemiRecord, losses: ShardLossEntry[]): string {
  const source = timestamp(record.source.updated_at)
  if (source) return source
  addLoss(losses, 'aiwg-created-at-unavailable',
    'AIWG has no distinct creation timestamp; updated_at was used.', {
      component: 'notes', record_id: record.id, field_path: '/created_at',
      source_state: 'absent', destination_capability: 'required-date-time', action: 'default',
    })
  return new Date(record.updated_at).toISOString()
}

function safeUri(value: string | undefined): string | null {
  if (!value) return null
  try { return new URL(value).toString() } catch { return null }
}

function schemeName(concept: AiwgFortemiSkosConcept): string {
  return concept.scheme && concept.scheme.length > 0 ? concept.scheme : 'aiwg'
}

/** Build exact 2.0.0/full-v1 plus mandatory semantic-loss evidence. */
export async function convertAiwgIndexToFullV1(
  index: AiwgFortemiIndexExport,
  options: AiwgFullV1ConversionOptions = {},
): Promise<AiwgFullV1ConversionResult> {
  const losses: ShardLossEntry[] = []
  const exportedAt = timestamp(options.createdAt) ?? new Date(index.generated_at).toISOString()
  const records = [...index.items].sort((a, b) => a.id.localeCompare(b.id))
  const noteIds = new Map(records.map((record) => [record.id, uuid('record', record.id)]))
  const rows = new Map<ShardComponent, Array<Record<string, unknown>>>()
  for (const component of Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[]) rows.set(component, [])

  const tags = new Set<string>()
  for (const record of records) {
    const noteId = noteIds.get(record.id)!
    const content = noteContent(record, losses)
    const sourceCreatedAt = createdAt(record, losses)
    const updatedAt = new Date(record.updated_at).toISOString()
    const recordTags = [...new Set(record.tags)].sort()
    recordTags.forEach((tag) => tags.add(tag))
    if (record.binary_sources?.length) {
      addLoss(losses, 'aiwg-attachment-bytes-unavailable',
        'Attachment references have no bytes, so full-v1 attachment projections were omitted.', {
          component: 'notes', count: record.binary_sources.length, record_id: record.id,
          field_path: '/attachments', source_state: 'value',
          destination_capability: 'mandatory-blob-sidecar', action: 'omit',
        })
    }
    const unmappedRecordFields = [
      Object.keys(record.facets).length > 0 ? 'facets' : null,
      record.search !== undefined ? 'search' : null,
      record.chunks !== undefined ? 'chunks' : null,
      record.compatibility !== undefined ? 'compatibility' : null,
    ].filter((field): field is string => field !== null)
    if (unmappedRecordFields.length > 0) {
      addLoss(losses, 'aiwg-record-fields-unmapped',
        'AIWG fields without a native full-v1 component were not hidden in note metadata.', {
          component: 'notes', record_id: record.id, source_state: 'value', action: 'omit',
          destination_capability: 'native-full-v1-components',
          reason: unmappedRecordFields.join(','),
        })
    }
    rows.get('notes')!.push({
      id: noteId, title: noteTitle(record, losses), original_content: content,
      revised_content: content,
      metadata: { aiwg_source: { record_id: record.id, record_type: record.type,
        repository: index.source.repo, graph: index.source.graph ?? null,
        source: record.source, privacy: record.privacy } },
      format: 'markdown', source: 'aiwg-index', starred: false, archived: false,
      collection_id: null, created_at: sourceCreatedAt, updated_at: updatedAt,
      tags: recordTags, attachments: [],
    })
    const hash = await sha256Hex(encoder.encode(content))
    rows.get('note_originals')!.push({
      id: uuid('note-original', record.id), note_id: noteId, content,
      hash: `sha256:${hash}`, user_created_at: sourceCreatedAt,
      user_last_edited_at: updatedAt, version_number: 1,
    })
    rows.get('note_revised_current')!.push({
      note_id: noteId, content, last_revision_id: null, ai_metadata: null,
    })
  }
  rows.set('tags', [...tags].sort().map((name) => ({ name, created_at: exportedAt })))

  const relationshipInput: unknown[] = []
  for (const record of records) {
    for (const [position, relationship] of record.relationships.entries()) {
      const target = noteIds.get(relationship.target_id) ?? null
      const key = `${record.id}\0${position}\0${relationship.type}\0${relationship.target_id}`
      rows.get('links')!.push({
        id: uuid('relationship', key), from_note_id: noteIds.get(record.id)!, to_note_id: target,
        to_url: target ? null : `aiwg://record/${encodeURIComponent(relationship.target_id)}`,
        kind: relationship.type,
        score: own(relationship, 'confidence') ? relationship.confidence ?? null : null,
        created_at: new Date(record.updated_at).toISOString(),
        metadata: target
          ? relationship.metadata ?? null
          : {
              direction: relationship.direction ?? null,
              label: relationship.label ?? null,
              privacy: relationship.privacy ?? null,
              source_path: relationship.source_path ?? null,
              target_path: relationship.target_path ?? null,
              source_metadata: relationship.metadata ?? null,
            },
      })
      relationshipInput.push({ source: record.id, position, relationship })
      if (!target) continue
      let weight = relationship.confidence
      if (weight === undefined) {
        weight = 1
        addLoss(losses, 'aiwg-relationship-weight-unavailable',
          'Graph weight defaulted because relationship confidence is absent.', {
            component: 'graph_edges', record_id: record.id,
            field_path: `/relationships/${position}/confidence`, source_state: 'absent',
            destination_capability: 'required-number', action: 'default',
          })
      }
      rows.get('graph_edges')!.push({
        graph_source_id: 'aiwg-relationships', from_note_id: noteIds.get(record.id)!,
        to_note_id: target, weight, kind: 'manual', rank: position,
        metadata: { type: relationship.type, direction: relationship.direction ?? null,
          label: relationship.label ?? null, privacy: relationship.privacy ?? null,
          source_path: relationship.source_path ?? null, target_path: relationship.target_path ?? null,
          source_metadata: relationship.metadata ?? null },
      })
    }
  }
  if (rows.get('graph_edges')!.length) {
    rows.get('graph_sources')!.push({
      id: 'aiwg-relationships', name: 'AIWG relationships', kind: 'imported', source_table: 'manual',
      embedding_set_id: null, virtual_set_id: null, model: null, dimension: null,
      truncate_dimension: null, metric: null, algorithm: null, parameters: null,
      input_hash: `sha256:${await sha256Hex(encoder.encode(JSON.stringify(relationshipInput)))}`,
      freshness: { status: 'fresh', checked_at: exportedAt }, created_at: exportedAt,
    })
  }

  const concepts = new Map<string, AiwgFortemiSkosConcept>()
  const conceptMembers = new Map<string, AiwgFortemiRecord[]>()
  for (const record of records) {
    for (const id of record.concepts) {
      conceptMembers.set(id, [...(conceptMembers.get(id) ?? []), record])
    }
    for (const concept of record.skos_concepts ?? []) {
      const existing = concepts.get(concept.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(concept)) {
        addLoss(losses, 'aiwg-skos-concept-conflict',
          'Different metadata was supplied for one concept; the first sorted record won.', {
            component: 'skos_concepts', record_id: concept.id,
            destination_capability: 'single-concept-identity', action: 'degrade',
          })
      } else if (!existing) concepts.set(concept.id, concept)
    }
  }
  for (const id of conceptMembers.keys()) {
    if (!concepts.has(id)) {
      concepts.set(id, { id, prefLabel: id })
      addLoss(losses, 'aiwg-skos-metadata-unavailable',
        'A referenced concept had no SKOS metadata; its id is used as the label.', {
          component: 'skos_concepts', record_id: id, field_path: '/prefLabel',
          source_state: 'absent', destination_capability: 'required-label', action: 'default',
        })
    }
  }
  const schemeIds = new Map(
    [...new Set([...concepts.values()].map(schemeName))].sort()
      .map((name) => [name, uuid('skos-scheme', name)]),
  )
  for (const [name, id] of schemeIds) {
    rows.get('skos_schemes')!.push({
      id, uri: null, notation: name, title: name, description: null, creator: 'aiwg-index',
      publisher: null, rights: null, version: null, is_active: true, is_system: false,
      created_at: exportedAt, updated_at: exportedAt, issued_at: null, modified_at: null,
      embedding: null, embedding_model: null, embedded_at: null,
    })
  }
  const conceptIds = new Map([...concepts.keys()].sort().map((id) => [id, uuid('skos-concept', id)]))
  for (const [sourceId, concept] of [...concepts].sort(([a], [b]) => a.localeCompare(b))) {
    const id = conceptIds.get(sourceId)!
    const schemeId = schemeIds.get(schemeName(concept))!
    const memberCount = conceptMembers.get(sourceId)?.length ?? 0
    if (concept.uri && !safeUri(concept.uri)) addLoss(losses, 'aiwg-skos-uri-invalid',
      'AIWG concept URI is not a valid authority URI and was mapped to null.', {
        component: 'skos_concepts', record_id: sourceId, field_path: '/uri',
        source_state: 'value', destination_capability: 'uri', action: 'omit',
      })
    const unmappedConceptMetadata = Object.keys(concept.metadata ?? {}).filter((key) => key !== 'domain')
    if (unmappedConceptMetadata.length > 0) addLoss(losses, 'aiwg-skos-metadata-unmapped',
      'AIWG concept metadata without a native full-v1 field was omitted.', {
        component: 'skos_concepts', record_id: sourceId, source_state: 'value', action: 'omit',
        destination_capability: 'native-skos-fields', reason: unmappedConceptMetadata.join(','),
      })
    rows.get('skos_concepts')!.push({
      id, primary_scheme_id: schemeId, uri: safeUri(concept.uri),
      notation: concept.notation ?? sourceId, facet_type: null, facet_source: 'aiwg-index',
      facet_domain: typeof concept.metadata?.domain === 'string' ? concept.metadata.domain : null,
      facet_scope: null, status: 'candidate', promoted_at: null, deprecated_at: null,
      deprecation_reason: null, replaced_by_id: null, note_count: memberCount,
      first_used_at: memberCount ? exportedAt : null, last_used_at: memberCount ? exportedAt : null,
      depth: 0, broader_count: 0, narrower_count: 0, related_count: 0,
      antipatterns: null, antipattern_checked_at: null, created_at: exportedAt,
      updated_at: exportedAt, embedding: null, embedding_model: null, embedded_at: null,
    })
    rows.get('skos_scheme_memberships')!.push({
      concept_id: id, scheme_id: schemeId, is_top_concept: true, added_at: exportedAt,
    })
    rows.get('skos_labels')!.push({
      id: uuid('skos-label', `${sourceId}:pref:${concept.prefLabel}`), concept_id: id,
      label_type: 'pref_label', value: concept.prefLabel, language: 'und', created_at: exportedAt,
    })
    for (const label of concept.altLabels ?? []) rows.get('skos_labels')!.push({
      id: uuid('skos-label', `${sourceId}:alt:${label}`), concept_id: id,
      label_type: 'alt_label', value: label, language: 'und', created_at: exportedAt,
    })
    if (concept.definition !== undefined) rows.get('skos_notes')!.push({
      id: uuid('skos-note', `${sourceId}:definition`), concept_id: id,
      note_type: 'definition', value: concept.definition, language: 'und', author: null,
      source: concept.uri ?? null, created_at: exportedAt, updated_at: exportedAt,
    })
  }
  for (const record of records) {
    for (const [position, sourceId] of record.concepts.entries()) {
      const conceptId = conceptIds.get(sourceId)
      if (conceptId) rows.get('note_skos_tags')!.push({
        note_id: noteIds.get(record.id)!, concept_id: conceptId, source: 'aiwg-index',
        confidence: null, relevance_score: null, is_primary: position === 0,
        created_at: new Date(record.updated_at).toISOString(), created_by: 'aiwg-index',
      })
    }
    for (const relation of record.skos_relations ?? []) {
      const subject = conceptIds.get(relation.source_id)
      const object = conceptIds.get(relation.target_id)
      if (!subject || !object || !['broader', 'narrower', 'related'].includes(relation.type)) {
        addLoss(losses, 'aiwg-skos-relation-unrepresentable',
          'SKOS relation could not be mapped to the native full-v1 relation enum.', {
            component: 'skos_relations', record_id: record.id,
            destination_capability: 'broader-narrower-related', action: 'omit',
          })
        continue
      }
      const unmappedRelationFields = [
        relation.source_path !== undefined ? 'source_path' : null,
        relation.metadata !== undefined ? 'metadata' : null,
      ].filter((field): field is string => field !== null)
      if (unmappedRelationFields.length > 0) {
        addLoss(losses, 'aiwg-skos-relation-fields-unmapped',
          'AIWG SKOS relation fields have no native full-v1 destination fields.', {
            component: 'skos_relations', record_id: record.id,
            source_state: 'value', destination_capability: 'native-skos-relation-fields',
            action: 'omit', reason: unmappedRelationFields.join(','),
          })
        continue
      }
      rows.get('skos_relations')!.push({
        id: uuid('skos-relation', `${relation.source_id}:${relation.type}:${relation.target_id}`),
        subject_id: subject, object_id: object, relation_type: relation.type,
        inference_score: null, is_inferred: false, is_validated: false,
        created_at: new Date(record.updated_at).toISOString(), created_by: 'aiwg-index',
      })
    }
  }

  for (const record of records) {
    for (const [position, event] of (record.provenance_events ?? []).entries()) {
      const start = timestamp(event.started_at)
      if (!start) addLoss(losses, 'aiwg-provenance-start-unavailable',
        'Activity start defaulted to record updated_at.', {
          component: 'provenance_activities', record_id: event.id ?? `${record.id}:${position}`,
          field_path: '/started_at', source_state: 'absent', action: 'default',
        })
      rows.get('provenance_activities')!.push({
        id: uuid('provenance-event', event.id ?? `${record.id}:${position}`),
        note_id: noteIds.get(record.id)!, revision_id: null, activity_type: event.activity,
        model_name: event.agent ?? null, started_at: start ?? new Date(record.updated_at).toISOString(),
        ended_at: timestamp(event.ended_at) ?? null,
        metadata: { source: event.source ?? null, path: event.path ?? null,
          confidence: event.confidence ?? null, privacy: event.privacy ?? null,
          attributes: event.attributes ?? null },
      })
    }
    for (const [position, provenance] of record.provenance.entries()) {
      rows.get('provenance_activities')!.push({
        id: uuid('provenance-field', `${record.id}:${position}:${provenance.field}`),
        note_id: noteIds.get(record.id)!, revision_id: null,
        activity_type: `source:${provenance.field}`, model_name: provenance.source,
        started_at: new Date(record.updated_at).toISOString(), ended_at: null,
        metadata: { path: provenance.path, confidence: provenance.confidence, privacy: provenance.privacy },
      })
    }
  }

  const embeddingGroups = new Map<string, { config: string; set: string; count: number }>()
  for (const record of records) {
    for (const [position, embedding] of (record.embeddings ?? []).entries()) {
      const vector = embedding.embedding ?? embedding.vector
      if (!vector || vector.length !== 768) {
        addLoss(losses, 'aiwg-embedding-dimension-unrepresentable',
          'Only 768-dimensional vectors satisfy the full-v1 authority.', {
            component: 'embeddings', record_id: embedding.id ?? `${record.id}:${position}`,
            field_path: '/vector', source_state: vector ? 'value' : 'absent',
            destination_capability: '768-dimensional-vector', action: 'omit',
          })
        continue
      }
      const model = embedding.model ?? 'aiwg-unknown'
      if (!embedding.model) addLoss(losses, 'aiwg-embedding-model-unavailable',
        'Embedding model defaulted because AIWG did not supply one.', {
          component: 'embeddings', record_id: embedding.id ?? `${record.id}:${position}`,
          field_path: '/model', source_state: 'absent', action: 'default',
        })
      let group = embeddingGroups.get(model)
      if (!group) {
        group = { config: uuid('embedding-config', model), set: uuid('embedding-set', model), count: 0 }
        embeddingGroups.set(model, group)
      }
      group.count += 1
      const unmappedEmbeddingFields = [
        embedding.granularity !== undefined ? 'granularity' : null,
        embedding.source_path !== undefined ? 'source_path' : null,
        embedding.metadata !== undefined ? 'metadata' : null,
        embedding.input_hash !== undefined && !/^[0-9a-f]{64}$/.test(embedding.input_hash)
          ? 'input_hash' : null,
      ].filter((field): field is string => field !== null)
      if (unmappedEmbeddingFields.length > 0) addLoss(losses, 'aiwg-embedding-fields-unmapped',
        'AIWG embedding fields without a native full-v1 field were omitted.', {
          component: 'embeddings', record_id: embedding.id ?? `${record.id}:${position}`,
          source_state: 'value', action: 'omit', destination_capability: 'native-embedding-fields',
          reason: unmappedEmbeddingFields.join(','),
        })
      rows.get('embeddings')!.push({
        id: uuid('embedding', embedding.id ?? `${record.id}:${position}`),
        note_id: noteIds.get(record.id)!, embedding_set_id: group.set, chunk_index: position,
        text: record.text ?? '', vector, model,
        contract_fingerprint: /^[0-9a-f]{64}$/.test(embedding.input_hash ?? '') ? embedding.input_hash : null,
        created_at: new Date(record.updated_at).toISOString(),
      })
    }
  }
  for (const [model, group] of [...embeddingGroups].sort(([a], [b]) => a.localeCompare(b))) {
    rows.get('embedding_configs')!.push({
      id: group.config, name: model, description: null, model, dimension: 768,
      chunk_size: 1, chunk_overlap: 0, hnsw_m: null, hnsw_ef_construction: null,
      ivfflat_lists: null, is_default: null, supports_mrl: null, matryoshka_dims: null,
      default_truncate_dim: null, provider: null, provider_config: null, content_types: null,
      strengths: null, limitations: null, recommended_for: null, benchmark_scores: null,
      is_available: null, document_composition: {}, created_at: exportedAt, updated_at: exportedAt,
    })
    rows.get('embedding_sets')!.push({
      id: group.set, name: model, slug: uuid('embedding-slug', model), description: null,
      purpose: null, usage_hints: null, keywords: null, set_type: 'full', mode: 'manual',
      criteria: null, embedding_config_id: group.config, truncate_dim: null,
      auto_embed_rules: null, index_status: 'ready', index_type: null,
      last_indexed_at: exportedAt, document_count: null, embedding_count: group.count,
      embeddings_current: true, index_size_bytes: null, is_system: false, is_active: true,
      auto_refresh: false, refresh_interval: null, last_refresh_at: null, agent_metadata: null,
      created_at: exportedAt, updated_at: exportedAt, created_by: 'aiwg-index',
    })
    const noteIdSet = new Set(rows.get('embeddings')!
      .filter((item) => item.embedding_set_id === group.set).map((item) => item.note_id as string))
    for (const noteId of [...noteIdSet].sort()) rows.get('embedding_set_members')!.push({
      embedding_set_id: group.set, note_id: noteId, membership_type: 'materialized',
      added_at: exportedAt, added_by: 'aiwg-index',
    })
  }

  if (losses.length > 0) {
    return {
      success: false,
      archive: null,
      profile: 'full-v1',
      schema_version: '2.0.0',
      lossless: false,
      losses,
      receipt: {
        schema_version: 'fortemi.aiwg-full-v1-conversion-receipt.v1',
        source_schema_version: 'aiwg.fortemi.index.export.v2',
        authority_repository: authorityReceipt.source.repository,
        authority_commit: authorityReceipt.source.commit,
        authority_contract_sha256: authorityReceipt.source.contractSha256,
        authority_schema_bundle_sha256: authorityReceipt.schemaBundle.sha256,
        manifest_sha256: null,
        component_checksums: {},
        contract_valid: false,
        signed: false,
      },
    }
  }

  const files = new Map<string, Uint8Array>()
  const components = Object.keys(FULL_V1_COMPONENT_FILES) as ShardComponent[]
  const counts: ShardManifest['counts'] = { community_sets: 0 }
  for (const component of components) {
    const spec = FULL_V1_COMPONENT_FILES[component]
    const componentRows = rows.get(component) ?? []
    files.set(spec.file, encode(componentRows, spec.encoding))
    counts[component] = componentRows.length
  }
  const checksums: Record<string, string> = {}
  for (const [file, bytes] of files) checksums[file] = await sha256Hex(bytes)
  const manifest: ShardManifest = {
    version: '2.0.0', profile: 'full-v1',
    producer: { name: 'fortemi-core-aiwg-index', version: options.matricVersion ?? 'fortemi-core' },
    format: SHARD_FORMAT, created_at: exportedAt, components, counts, checksums,
    min_reader_version: '2.0.0',
  }
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2))
  files.set('manifest.json', manifestBytes)
  const validation = await validateFullV1ShardArchive(files)
  if (!validation.valid) {
    throw new Error(`Generated AIWG full-v1 shard failed authority validation: ${validation.errors.join('; ')}`)
  }
  return {
    success: true,
    archive: packTarGz(files), profile: 'full-v1', schema_version: '2.0.0',
    lossless: losses.length === 0, losses,
    receipt: {
      schema_version: 'fortemi.aiwg-full-v1-conversion-receipt.v1',
      source_schema_version: 'aiwg.fortemi.index.export.v2',
      authority_repository: authorityReceipt.source.repository,
      authority_commit: authorityReceipt.source.commit,
      authority_contract_sha256: authorityReceipt.source.contractSha256,
      authority_schema_bundle_sha256: authorityReceipt.schemaBundle.sha256,
      manifest_sha256: await sha256Hex(manifestBytes), component_checksums: checksums,
      contract_valid: true, signed: false,
    },
  }
}
