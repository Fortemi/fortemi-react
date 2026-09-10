import { z } from 'zod'
import type { BackendConcept, BackendLink, BackendNote, BackendNoteFull } from './data-backend.js'
import { RemoteBackendError, remoteProjection } from './remote-error.js'

const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const metadata = z.object({
  id: uuid, title: z.string().nullable(),
  created_at_utc: z.string().datetime({ offset: true }),
  updated_at_utc: z.string().datetime({ offset: true }),
  starred: z.boolean(), archived: z.boolean(), source: z.string().optional(),
})
const summary = metadata.extend({ tags: z.array(z.string()) })
const list = z.object({ notes: z.array(summary.extend({ title: z.string() })), total: z.number().int().nonnegative() })
  .refine((result) => result.notes.length <= result.total)
const detail = z.object({
  note: metadata.extend({ source: z.string() }),
  tags: z.array(z.string()),
  original: z.object({ content: z.string() }),
  revised: z.object({ content: z.string() }),
})

function projectNote(note: z.infer<typeof summary>): BackendNote {
  return {
    id: note.id, title: note.title, tags: note.tags,
    createdAt: note.created_at_utc, updatedAt: note.updated_at_utc,
    starred: note.starred, archived: note.archived,
    ...(note.source === undefined ? {} : { source: note.source }),
  }
}

export function parseRemoteNoteList(value: unknown): { items: BackendNote[]; total: number } {
  return remoteProjection(() => {
    const result = list.parse(value)
    return { items: result.notes.map(projectNote), total: result.total }
  })
}

export function parseRemoteNoteDetail(value: unknown): BackendNoteFull {
  return remoteProjection(() => {
    const result = detail.parse(value)
    return { ...projectNote({ ...result.note, tags: result.tags }), content: result.revised.content }
  })
}

const timestamp = z.string().datetime({ offset: true })

export function remoteNoteId(value: string): string {
  const parsed = uuid.safeParse(value)
  if (!parsed.success) throw new RemoteBackendError('invalid-request')
  return parsed.data
}
const link = z.object({
  id: uuid, from_note_id: uuid, to_note_id: uuid.nullable(), to_url: z.string().nullable(),
  kind: z.string(), score: z.number().finite(), created_at_utc: timestamp,
  snippet: z.string().nullable(), metadata: z.unknown().refine((value) => value !== undefined),
})
const directionalLinks = z.object({ outgoing: z.array(link), incoming: z.array(link) })

export function parseRemoteLinks(value: unknown, noteId: string): BackendLink[] {
  return remoteProjection(() => {
    const result = directionalLinks.parse(value)
    const project = (item: z.infer<typeof link>, direction: 'outgoing' | 'incoming'): BackendLink => {
      if ((direction === 'outgoing' ? item.from_note_id : item.to_note_id) !== noteId) {
        throw new Error('Invalid link direction')
      }
      return {
        id: item.id, fromNoteId: item.from_note_id, toNoteId: item.to_note_id,
        toUrl: item.to_url, kind: item.kind, score: item.score,
        createdAt: item.created_at_utc, direction, snippet: item.snippet, remoteMetadata: item.metadata,
        ...(item.metadata !== null && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? { metadata: item.metadata as Record<string, unknown> } : {}),
      }
    }
    return [
      ...result.outgoing.map((item) => project(item, 'outgoing')),
      ...result.incoming.map((item) => project(item, 'incoming')),
    ]
  })
}

const conceptAssignment = z.tuple([
  z.object({ note_id: uuid, concept_id: uuid, source: z.string(), relevance_score: z.number().finite(),
    is_primary: z.boolean(), created_at: timestamp, confidence: z.number().finite().optional(), created_by: z.string().optional() }),
  z.object({ id: uuid, primary_scheme_id: uuid, pref_label: z.string(),
    created_at: timestamp, updated_at: timestamp }),
])

export function parseRemoteConcepts(value: unknown, noteId: string): BackendConcept[] {
  return remoteProjection(() => z.array(conceptAssignment).parse(value).map(([assignment, concept]) => {
    if (assignment.note_id !== noteId || assignment.concept_id !== concept.id) {
      throw new Error('Invalid concept assignment')
    }
    return {
      id: concept.id, schemeId: concept.primary_scheme_id, prefLabel: concept.pref_label,
      createdAt: concept.created_at, updatedAt: concept.updated_at,
      altLabels: [], definition: null, unavailableFields: ['altLabels', 'definition'],
      assignment: { noteId: assignment.note_id, source: assignment.source,
        relevanceScore: assignment.relevance_score, isPrimary: assignment.is_primary,
        createdAt: assignment.created_at,
        ...(assignment.confidence === undefined ? {} : { confidence: assignment.confidence }),
        ...(assignment.created_by === undefined ? {} : { createdBy: assignment.created_by }) },
    }
  }))
}

const provenanceActivity = z.object({
  id: uuid, note_id: uuid, revision_id: uuid.nullable(), activity_type: z.string(),
  model_name: z.string().nullable(), started_at: timestamp, ended_at: timestamp.nullable(),
  metadata: z.unknown().refine((value) => value !== undefined),
})
const provenanceEdge = z.object({
  id: uuid, revision_id: uuid, source_note_id: uuid.nullable(), source_url: z.string().nullable(),
  relation: z.string(), created_at_utc: timestamp,
})
const provenanceChain = z.object({
  note_id: uuid, revision_id: uuid, activity: provenanceActivity.nullable(), edges: z.array(provenanceEdge),
})
const provenanceGraph = z.object({
  note_id: uuid, current_chain: provenanceChain.nullable(),
  all_activities: z.array(provenanceActivity), all_edges: z.array(provenanceEdge),
  derived_notes: z.array(uuid), derived_count: z.number().int().nonnegative(),
})

/** Producer field names intentionally distinguish this graph from local PGlite PROV edges. */
export type RemoteProvenanceGraph = z.infer<typeof provenanceGraph>

export function parseRemoteProvenance(value: unknown, noteId: string): RemoteProvenanceGraph {
  return remoteProjection(() => {
    const graph = provenanceGraph.parse(value)
    if (graph.note_id !== noteId || graph.derived_count !== graph.derived_notes.length
      || graph.all_activities.some((activity) => activity.note_id !== noteId)
      || (graph.current_chain !== null && (graph.current_chain.note_id !== noteId
        || graph.current_chain.edges.some((edge) => edge.revision_id !== graph.current_chain!.revision_id)
        || (graph.current_chain.activity !== null
          && (graph.current_chain.activity.note_id !== noteId
            || graph.current_chain.activity.revision_id !== graph.current_chain.revision_id))))) {
      throw new Error('Invalid provenance graph')
    }
    return graph
  })
}

const searchMode = z.enum(['fts', 'semantic', 'hybrid'])
const searchOptions = z.object({
  mode: searchMode.default('fts'), limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().optional(), source: z.array(z.string()).optional(),
  tags: z.array(z.string().min(1).refine((tag) => tag === tag.trim() && !tag.includes(','))).optional(),
}).strict()
export type RemoteSearchMode = z.infer<typeof searchMode>

export function remoteSearchParameters(query: string, options: unknown) {
  const parsed = searchOptions.safeParse(options ?? {})
  if (typeof query !== 'string' || !parsed.success) throw new RemoteBackendError('invalid-request')
  const value = parsed.data
  if ((value.offset ?? 0) !== 0 || (value.source?.length ?? 0) > 0) throw new RemoteBackendError('unsupported-operation')
  return { q: query, mode: value.mode, limit: value.limit,
    ...(value.tags?.length ? { tags: value.tags.join(',') } : {}) }
}

const searchHit = z.object({
  note_id: uuid, score: z.number().finite(), snippet: z.string().nullable(),
  title: z.string().optional(), tags: z.array(z.string()).optional(),
  embedding_status: z.enum(['ready', 'pending', 'failed', 'none']).optional(),
  chain_info: z.object({
    chain_id: uuid, original_title: z.string(), chunks_matched: z.number().int().nonnegative(),
    best_chunk_sequence: z.number().int().nonnegative(), total_chunks: z.number().int().nonnegative(),
  }).optional(),
})
const searchDegradation = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), effective_mode: searchMode,
})
const searchResponse = z.object({
  query: z.string(), results: z.array(searchHit), total: z.number().int().nonnegative(),
  degraded: z.boolean(), degradation: searchDegradation.optional(),
})
export type RemoteSearchDegradation = z.infer<typeof searchDegradation>
export type RemoteSearchMetadata = Pick<z.infer<typeof searchHit>, 'title' | 'tags' | 'embedding_status' | 'chain_info'>

export function parseRemoteSearch(value: unknown, query: string, limit: number) {
  return remoteProjection(() => {
    const result = searchResponse.parse(value)
    if (result.query !== query || result.total !== result.results.length || result.results.length > limit
      || result.degraded !== (result.degradation !== undefined)) throw new Error('Invalid search envelope')
    return result
  })
}

const lifecycleAction = z.enum(['delete', 'restore', 'archive', 'unarchive', 'star', 'unstar'])
const manageInput = z.union([
  z.object({ action: z.literal('create'), content: z.string(), title: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(), source: z.string().optional() }).strict(),
  z.object({ action: z.literal('update'), note_id: uuid, content: z.string().optional(),
    tags: z.array(z.string()).optional() }).strict().refine((value) => value.content !== undefined || value.tags !== undefined),
  z.object({ action: lifecycleAction, note_id: uuid }).strict(),
])
export type RemoteManageNoteInput = z.infer<typeof manageInput>

export function parseRemoteManageInput(input: unknown): RemoteManageNoteInput {
  const parsed = manageInput.safeParse(input)
  if (!parsed.success) throw new RemoteBackendError('invalid-request')
  return parsed.data
}

export function parseRemoteCreated(value: unknown): string {
  return remoteProjection(() => z.object({ id: uuid }).parse(value).id)
}

export function parseRemoteRestored(value: unknown, id: string): void {
  remoteProjection(() => {
    const result = z.object({ restored: z.literal(true), id: uuid }).parse(value)
    if (result.id !== id) throw new Error('Invalid restore identity')
  })
}
