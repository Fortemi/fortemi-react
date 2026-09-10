/**
 * Backend seam (#191) — a uniform tool-intent operation interface that lets the
 * PGlite database backend (#187) and the static-file shard backend (#189) be
 * selected and dispatched against the same way, plus a capability-negotiation
 * API so a caller asks for the operations it needs and gets the lightest backend
 * that provides them.
 *
 * The seam sits one level above SQL: every adapter exposes the same read
 * operations (and optional relationship, write, semantic, and full-content ops)
 * regardless of whether the data lives in a queryable PGlite instance, a set of
 * static shard files fetched over HTTP, or the Fortemi server tier.
 */

import type { DatabaseClient } from './storage-backend.js'
import { NotesRepository } from './repositories/notes-repository.js'
import { SearchRepository } from './repositories/search-repository.js'
import { LinksRepository } from './repositories/links-repository.js'
import type { LinkRow } from './repositories/links-repository.js'
import type { NoteSummary, NoteFull, SearchResult } from './repositories/types.js'
import { manageNote } from './tools/manage-note.js'
import type { ShardReader, ShardReaderNote } from './shard/shard-reader.js'
import type { ShardLink, ShardProvenanceEdge, ShardSkosConcept } from './shard/types.js'
import { RemoteBackendError, isRemoteNoteNotFound, remoteHttpError } from './remote-error.js'
import { parseRemoteConcepts, parseRemoteCreated, parseRemoteLinks, parseRemoteManageInput, parseRemoteNoteDetail, parseRemoteNoteList, parseRemoteProvenance, parseRemoteRestored, parseRemoteSearch, remoteNoteId, remoteSearchParameters } from './remote-contract.js'
import type { RemoteProvenanceGraph, RemoteSearchDegradation, RemoteSearchMetadata, RemoteSearchMode } from './remote-contract.js'

// ── Capabilities ──────────────────────────────────────────────────────────

/**
 * Semantic-search tier a backend offers, in increasing capability:
 * - `none`     — no vector search (text / facets only)
 * - `cosine-small` — brute-force cosine over a small static vector set (#189)
 * - `ann-full` — prebuilt/queryable approximate-nearest-neighbour over the full
 *   corpus (PGlite + pgvector, or a prebuilt ANN snapshot)
 * - `server`   — delegated to the remote Fortemi server backend
 */
export type BackendSemanticTier = 'none' | 'cosine-small' | 'ann-full' | 'server'

/** Relative startup cost of bringing a backend online. */
export type BackendStartupCost = 'instant' | 'index-build' | 'network'

/** What a backend can do — the unit of capability negotiation. */
export interface BackendCapabilities {
  /** Can answer list / get / search read operations. */
  read: boolean
  /** Can mutate notes (manageNote). */
  write: boolean
  /** Can merge external shards into its store. */
  merge: boolean
  /** Coordinates concurrent multi-user writes. */
  multiUser: boolean
  /** Highest semantic-search tier available. */
  semantic: BackendSemanticTier
  /** Relative cost to bring the backend online. */
  startupCost: BackendStartupCost
}

// ── Neutral record shapes ─────────────────────────────────────────────────

/**
 * Backend-neutral note record. `source`/`starred`/`archived` are optional
 * because lean read paths (PGlite full-text search) do not return them; list,
 * get, and every shard path populate all fields.
 */
export interface BackendNote {
  id: string
  title: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  source?: string
  starred?: boolean
  archived?: boolean
}

/** A note plus its current rendered content. */
export interface BackendNoteFull extends BackendNote {
  content: string
  links?: BackendLink[]
  concepts?: BackendConcept[]
  provenance?: BackendProvenanceEdge[]
  /** Server revision/activity graph; not interchangeable with local provenance edges. */
  provenanceGraph?: RemoteProvenanceGraph
}

export interface BackendLink {
  id: string
  fromNoteId: string
  toNoteId: string | null
  toUrl?: string | null
  kind: string
  score: number | null
  createdAt: string
  metadata?: Record<string, unknown>
  /** Exact server JSON metadata, including non-object values and null. */
  remoteMetadata?: unknown
  /** Relative to the requested note; remote self-links can appear in both directions. */
  direction?: 'outgoing' | 'incoming'
  snippet?: string | null
}

export interface BackendConcept {
  id: string
  schemeId: string
  prefLabel: string
  altLabels: string[]
  definition: string | null
  createdAt: string
  updatedAt: string
  /** Placeholder values for these fields are unavailable, not evidence of absence. */
  unavailableFields?: Array<'altLabels' | 'definition'>
  assignment?: { noteId: string; source: string; relevanceScore: number; isPrimary: boolean; createdAt: string; confidence?: number; createdBy?: string }
}

export interface BackendProvenanceEdge {
  id: string
  entityType: string
  entityId: string
  activity: string
  agent: string
  startedAt: string
  endedAt: string | null
  attributes: Record<string, unknown> | null
}

/** One search hit — note plus optional rank/snippet when the backend ranks. */
export interface BackendSearchHit {
  note: BackendNote
  rank?: number
  snippet?: string
  /** Original remote search metadata; detail enrichment is a separate read. */
  remoteSearch?: RemoteSearchMetadata
}

/** Search response with optional facet counts. */
export interface BackendSearchResult {
  hits: BackendSearchHit[]
  total: number
  facets?: {
    tags: Record<string, number>
    source?: Record<string, number>
  }
}

export interface BackendListOptions {
  offset?: number
  limit?: number
}

export interface BackendSearchQueryOptions extends BackendListOptions {
  /** AND-filter: note must carry every listed tag. */
  tags?: string[]
  /** OR-filter on note source. */
  source?: string[]
}

// ── The uniform operation interface ───────────────────────────────────────

/**
 * Uniform tool-intent operation interface. Every backend implements the read
 * core; `getNoteFull`, `semantic`, and `manageNote` are optional and present
 * only on backends whose capabilities advertise them.
 */
export interface DataBackend {
  readonly id: string
  readonly capabilities: BackendCapabilities

  listNotes(options?: BackendListOptions): Promise<{ items: BackendNote[]; total: number }>
  getNote(id: string): Promise<BackendNote | null>
  search(query: string, options?: BackendSearchQueryOptions): Promise<BackendSearchResult>

  /** Lazy full content (present when capabilities.read). */
  getNoteFull?(id: string): Promise<BackendNoteFull | null>
  /** Note links (present when capabilities.read). */
  linksOf?(id: string): Promise<BackendLink[]>
  /** SKOS concepts assigned to a note (present when capabilities.read). */
  conceptsOf?(id: string): Promise<BackendConcept[]>
  /** W3C PROV edges for a note (present when capabilities.read). */
  provenanceOf?(id: string): Promise<BackendProvenanceEdge[]>
  /** Remote revision/activity graph, preserving the server model and field names. */
  provenanceGraphOf?(id: string): Promise<RemoteProvenanceGraph>
  /** Vector search (present when capabilities.semantic !== 'none'). */
  semantic?(query: string, k?: number): Promise<BackendSearchHit[]>
  /** Write op (present when capabilities.write). */
  manageNote?(input: unknown): Promise<unknown>
}

// ── Capability negotiation ────────────────────────────────────────────────

/** What a caller needs. Booleans require `true`; `semantic` is a minimum tier. */
export interface BackendRequest {
  read?: boolean
  write?: boolean
  merge?: boolean
  multiUser?: boolean
  /** Minimum acceptable semantic tier (a higher tier satisfies a lower request). */
  semantic?: BackendSemanticTier
}

export interface BackendCandidate {
  backend: DataBackend
  /** Requested capabilities this backend cannot satisfy ([] = fully satisfies). */
  missing: string[]
}

export interface BackendSelection {
  /** Chosen backend — fully-satisfying-and-lightest, else fewest-missing. Null only when no backends are available. */
  backend: DataBackend | null
  capabilities: BackendCapabilities | null
  /** Requested capabilities the chosen backend cannot satisfy. */
  missing: string[]
  /** Every candidate with its own missing set, ordered as evaluated. */
  candidates: BackendCandidate[]
}

const SEMANTIC_RANK: Record<BackendSemanticTier, number> = {
  none: 0,
  'cosine-small': 1,
  'ann-full': 2,
  server: 3,
}

const STARTUP_RANK: Record<BackendStartupCost, number> = {
  instant: 0,
  'index-build': 1,
  network: 2,
}

function missingFor(request: BackendRequest, caps: BackendCapabilities): string[] {
  const missing: string[] = []
  if (request.read && !caps.read) missing.push('read')
  if (request.write && !caps.write) missing.push('write')
  if (request.merge && !caps.merge) missing.push('merge')
  if (request.multiUser && !caps.multiUser) missing.push('multiUser')
  if (request.semantic && SEMANTIC_RANK[caps.semantic] < SEMANTIC_RANK[request.semantic]) {
    missing.push(`semantic:${request.semantic}`)
  }
  return missing
}

/**
 * Pick the backend that best satisfies `request` from `available`. Prefers a
 * fully-satisfying backend with the lightest startup cost; if none fully
 * satisfy, returns the one missing the fewest capabilities (lightest on ties) so
 * the caller can degrade with eyes open via `selection.missing`.
 */
export function selectBackend(request: BackendRequest, available: DataBackend[]): BackendSelection {
  const candidates: BackendCandidate[] = available.map((backend) => ({
    backend,
    missing: missingFor(request, backend.capabilities),
  }))

  if (candidates.length === 0) {
    return { backend: null, capabilities: null, missing: [], candidates }
  }

  const lighter = (a: DataBackend, b: DataBackend): number =>
    STARTUP_RANK[a.capabilities.startupCost] - STARTUP_RANK[b.capabilities.startupCost]

  const fullySatisfying = candidates.filter((c) => c.missing.length === 0)
  const pool = fullySatisfying.length > 0 ? fullySatisfying : candidates

  const chosen = [...pool].sort((a, b) => {
    // Fewest missing first, then lightest startup, preserving input order on ties.
    if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length
    return lighter(a.backend, b.backend)
  })[0]

  return {
    backend: chosen.backend,
    capabilities: chosen.backend.capabilities,
    missing: chosen.missing,
    candidates,
  }
}

// ── PGlite adapter (#187 — wraps the repositories/tools) ──────────────────

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d)
}

function summaryToBackend(s: NoteSummary): BackendNote {
  return {
    id: s.id,
    title: s.title,
    tags: s.tags,
    createdAt: toIso(s.created_at),
    updatedAt: toIso(s.updated_at),
    source: s.source,
    starred: s.is_starred,
    archived: s.is_archived,
  }
}

function searchResultToBackend(r: SearchResult): BackendNote {
  // PGlite full-text rows are lean — no source/starred/archived.
  return {
    id: r.id,
    title: r.title,
    tags: r.tags,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  }
}

function linkToBackend(link: LinkRow): BackendLink {
  return {
    id: link.id,
    fromNoteId: link.source_note_id,
    toNoteId: link.target_note_id,
    kind: link.link_type,
    score: link.confidence,
    createdAt: toIso(link.created_at),
  }
}

function urlLinkToBackend(link: {
  id: string
  source_note_id: string
  to_url: string
  link_type: string
  confidence: number | null
  metadata_json?: Record<string, unknown> | string | null
  created_at: Date | string
}): BackendLink {
  const metadata = typeof link.metadata_json === 'string'
    ? JSON.parse(link.metadata_json) as Record<string, unknown>
    : link.metadata_json ?? undefined
  return {
    id: link.id,
    fromNoteId: link.source_note_id,
    toNoteId: null,
    toUrl: link.to_url,
    kind: link.link_type,
    score: link.confidence,
    createdAt: toIso(link.created_at),
    ...(metadata ? { metadata } : {}),
  }
}

function shardLinkToBackend(link: ShardLink): BackendLink {
  const metadata = (
    link.metadata
    && typeof link.metadata === 'object'
    && !Array.isArray(link.metadata)
  )
    ? link.metadata as Record<string, unknown>
    : undefined
  return {
    id: link.id,
    fromNoteId: link.from_note_id,
    toNoteId: link.to_note_id,
    toUrl: link.to_url,
    kind: link.kind,
    score: link.score,
    createdAt: link.created_at,
    ...(metadata ? { metadata } : {}),
  }
}

function conceptToBackend(concept: {
  id: string
  scheme_id: string
  pref_label: string
  alt_labels: string[] | string
  definition: string | null
  created_at: Date | string
  updated_at: Date | string
}): BackendConcept {
  const altLabels = typeof concept.alt_labels === 'string'
    ? JSON.parse(concept.alt_labels) as string[]
    : concept.alt_labels
  return {
    id: concept.id,
    schemeId: concept.scheme_id,
    prefLabel: concept.pref_label,
    altLabels,
    definition: concept.definition,
    createdAt: toIso(concept.created_at),
    updatedAt: toIso(concept.updated_at),
  }
}

function shardConceptToBackend(concept: ShardSkosConcept): BackendConcept {
  return conceptToBackend(concept)
}

function parseAttributes(attributes: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (attributes === null) return null
  if (typeof attributes === 'string') return JSON.parse(attributes) as Record<string, unknown>
  return attributes
}

function provenanceToBackend(edge: {
  id: string
  entity_type: string
  entity_id: string
  activity: string
  agent: string
  started_at: Date | string
  ended_at: Date | string | null
  attributes: Record<string, unknown> | string | null
}): BackendProvenanceEdge {
  return {
    id: edge.id,
    entityType: edge.entity_type,
    entityId: edge.entity_id,
    activity: edge.activity,
    agent: edge.agent,
    startedAt: toIso(edge.started_at),
    endedAt: edge.ended_at ? toIso(edge.ended_at) : null,
    attributes: parseAttributes(edge.attributes),
  }
}

function shardProvenanceToBackend(edge: ShardProvenanceEdge): BackendProvenanceEdge {
  return provenanceToBackend(edge)
}

export interface PGliteBackendOptions {
  id?: string
  /** Whether embeddings exist so search can use the semantic path. */
  semanticAvailable?: boolean
}

/**
 * Wrap a PGlite-backed `DatabaseClient` as a `DataBackend`. Read ops delegate to
 * the repositories; writes go through the `manageNote` tool. Advertises full
 * read+write+merge with `ann-full` semantic when embeddings are present.
 */
export function createPGliteBackend(db: DatabaseClient, options: PGliteBackendOptions = {}): DataBackend {
  const semanticAvailable = options.semanticAvailable ?? false
  const notes = new NotesRepository(db)
  const search = new SearchRepository(db, semanticAvailable)
  const links = new LinksRepository(db)

  async function linksOf(id: string): Promise<BackendLink[]> {
    const result = await links.listForNote(id)
    const urlLinks = await db.query<{
      id: string
      source_note_id: string
      to_url: string
      link_type: string
      confidence: number | null
      metadata_json: Record<string, unknown> | string | null
      created_at: Date
    }>(
      `SELECT * FROM link_url_target WHERE source_note_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id],
    )
    return [
      ...result.outbound.map(linkToBackend),
      ...result.inbound.map(linkToBackend),
      ...urlLinks.rows.map(urlLinkToBackend),
    ]
  }

  async function conceptsOf(id: string): Promise<BackendConcept[]> {
    const result = await db.query<{
      id: string
      scheme_id: string
      pref_label: string
      alt_labels: string[] | string
      definition: string | null
      created_at: Date | string
      updated_at: Date | string
    }>(
      `SELECT c.*
       FROM skos_concept c
       INNER JOIN note_skos_tag nst ON nst.concept_id = c.id
       WHERE nst.note_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.pref_label`,
      [id],
    )
    return result.rows.map(conceptToBackend)
  }

  async function provenanceOf(id: string): Promise<BackendProvenanceEdge[]> {
    const result = await db.query<{
      id: string
      entity_type: string
      entity_id: string
      activity: string
      agent: string
      started_at: Date | string
      ended_at: Date | string | null
      attributes: Record<string, unknown> | string | null
    }>(
      `SELECT *
       FROM provenance_edge
       WHERE entity_type = 'note' AND entity_id = $1
       ORDER BY started_at`,
      [id],
    )
    return result.rows.map(provenanceToBackend)
  }

  return {
    id: options.id ?? 'pglite',
    capabilities: {
      read: true,
      write: true,
      merge: true,
      multiUser: false,
      semantic: semanticAvailable ? 'ann-full' : 'none',
      startupCost: 'index-build',
    },

    async listNotes(o) {
      const r = await notes.list({ offset: o?.offset, limit: o?.limit })
      return { items: r.items.map(summaryToBackend), total: r.total }
    },

    async getNote(id) {
      try {
        const f: NoteFull = await notes.get(id)
        return summaryToBackend(f)
      } catch {
        return null
      }
    },

    async search(query, o) {
      const r = await search.search(query, {
        limit: o?.limit,
        offset: o?.offset,
        tags: o?.tags,
        source: o?.source?.[0],
        include_facets: true,
      })
      const hits: BackendSearchHit[] = r.results.map((res) => ({
        note: searchResultToBackend(res),
        rank: res.rank,
        snippet: res.snippet,
      }))
      const facets = r.facets
        ? {
            tags: Object.fromEntries(r.facets.tags.map((t) => [t.tag, t.count])),
          }
        : undefined
      return { hits, total: r.total, facets }
    },

    async getNoteFull(id) {
      try {
        const f: NoteFull = await notes.get(id)
        const [noteLinks, concepts, provenance] = await Promise.all([
          linksOf(id),
          conceptsOf(id),
          provenanceOf(id),
        ])
        return { ...summaryToBackend(f), content: f.current.content, links: noteLinks, concepts, provenance }
      } catch {
        return null
      }
    },

    linksOf,
    conceptsOf,
    provenanceOf,

    async manageNote(input) {
      return manageNote(db, input)
    },
  }
}

// ── Remote server adapter (#197 — HTTP proxy to the full Fortemi server) ─────

export interface RemoteBackendPaths {
  notes: string
  note: string
  search: string
  links: string
  concepts: string
  provenance: string
  restore: string
  /** @deprecated Tool-intent path overrides cannot adapt the REST contract and are rejected. */
  manageNote?: string
  /** @deprecated Semantic search uses the search path and mode parameter. Overrides are rejected. */
  semantic?: string
}

export interface RemoteSearchOptions extends BackendSearchQueryOptions {
  mode?: RemoteSearchMode
}

export interface RemoteSearchResult extends BackendSearchResult {
  /** The server total counts returned hits, not the corpus or a pagination estimate. */
  totalKind: 'returned-hits'
  requestedMode: RemoteSearchMode
  effectiveMode: RemoteSearchMode
  degraded: boolean
  degradation?: RemoteSearchDegradation
}

export interface RemoteManageNoteResult {
  action: 'create' | 'update' | 'delete' | 'restore' | 'archive' | 'unarchive' | 'star' | 'unstar'
  note_id: string
  /** Present only when the mutation itself returns a note envelope. */
  note?: BackendNoteFull
}

export interface RemoteDataBackend extends DataBackend {
  search(query: string, options?: RemoteSearchOptions): Promise<RemoteSearchResult>
  semanticWithReport(query: string, k?: number): Promise<RemoteSearchResult>
  manageNote(input: unknown): Promise<RemoteManageNoteResult>
}

export interface RemoteBackendConfig {
  baseUrl: string
  id?: string
  fetchImpl?: typeof fetch
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  authToken?: string
  paths?: Partial<RemoteBackendPaths>
}

const DEFAULT_REMOTE_PATHS: RemoteBackendPaths = {
  notes: '/api/v1/notes',
  note: '/api/v1/notes/:id',
  search: '/api/v1/search',
  links: '/api/v1/notes/:id/links',
  concepts: '/api/v1/notes/:id/concepts',
  provenance: '/api/v1/notes/:id/provenance',
  restore: '/api/v1/notes/:id/restore',
}

function remotePath(template: string, id?: string): string {
  return id ? template.replace(':id', encodeURIComponent(id)) : template
}

function remoteUrl(baseUrl: string, path: string, params?: Record<string, unknown>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item))
    } else {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function remoteHeaders(config: RemoteBackendConfig, json = false): Promise<HeadersInit> {
  const configured = typeof config.headers === 'function' ? await config.headers() : config.headers
  const headers = new Headers(configured)
  if (config.authToken) headers.set('Authorization', `Bearer ${config.authToken}`)
  if (json) headers.set('Content-Type', 'application/json')
  return headers
}

async function remoteJson<T>(config: RemoteBackendConfig, path: string, init: RequestInit = {}, expectedStatus = 200): Promise<T> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(remoteUrl(config.baseUrl, path), init)
  } catch (error) {
    throw new RemoteBackendError(error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'transport')
  }
  if (!response.ok) {
    throw await remoteHttpError(response)
  }
  if (response.status !== expectedStatus) throw new RemoteBackendError('invalid-response', response.status)
  if (expectedStatus === 204) return undefined as T
  try { return await response.json() as T } catch {
    throw new RemoteBackendError('invalid-response', response.status)
  }
}

export function createRemoteBackend(config: RemoteBackendConfig): RemoteDataBackend {
  if (config.paths?.manageNote !== undefined || config.paths?.semantic !== undefined) {
    throw new RemoteBackendError('unsupported-operation')
  }
  const paths = { ...DEFAULT_REMOTE_PATHS, ...config.paths }

  async function getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return remoteJson<T>(config, remoteUrl(config.baseUrl, path, params), {
      method: 'GET',
      headers: await remoteHeaders(config),
    })
  }

  async function writeJson<T>(method: string, path: string, body?: unknown, expectedStatus = 200): Promise<T> {
    return remoteJson<T>(config, path, {
      method,
      headers: await remoteHeaders(config, body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, expectedStatus)
  }

  async function detailOf(id: string): Promise<BackendNoteFull> {
    id = remoteNoteId(id)
    const note = parseRemoteNoteDetail(await getJson<unknown>(remotePath(paths.note, id)))
    if (note.id !== id) throw new RemoteBackendError('invalid-response')
    return note
  }

  async function searchRemote(query: string, options?: RemoteSearchOptions, requireSemantic = false): Promise<RemoteSearchResult> {
    const params = remoteSearchParameters(query, options)
    const result = parseRemoteSearch(await getJson<unknown>(paths.search, params), query, params.limit)
    if (requireSemantic && result.degraded) throw new RemoteBackendError('degraded-search')
    const hits: BackendSearchHit[] = []
    // At most 100 sequential detail reads: bounded enrichment, preserving rank order.
    const notes = new Map<string, BackendNoteFull>()
    for (const hit of result.results) {
      let detail = notes.get(hit.note_id)
      if (!detail) { detail = await detailOf(hit.note_id); notes.set(hit.note_id, detail) }
      hits.push({
        note: { id: detail.id, title: hit.title ?? detail.title, tags: hit.tags ?? [],
          createdAt: detail.createdAt, updatedAt: detail.updatedAt, source: detail.source,
          starred: detail.starred, archived: detail.archived },
        rank: hit.score, ...(hit.snippet === null ? {} : { snippet: hit.snippet }),
        remoteSearch: { ...(hit.title === undefined ? {} : { title: hit.title }),
          ...(hit.tags === undefined ? {} : { tags: hit.tags }),
          ...(hit.embedding_status === undefined ? {} : { embedding_status: hit.embedding_status }),
          ...(hit.chain_info === undefined ? {} : { chain_info: hit.chain_info }) },
      })
    }
    return { hits, total: result.total, totalKind: 'returned-hits', requestedMode: params.mode,
      effectiveMode: result.degradation?.effective_mode ?? params.mode, degraded: result.degraded,
      ...(result.degradation ? { degradation: result.degradation } : {}) }
  }

  async function getNoteFull(id: string): Promise<BackendNoteFull | null> {
    id = remoteNoteId(id)
    let note: unknown
    try {
      note = await getJson<unknown>(remotePath(paths.note, id))
    } catch (error) {
      if (isRemoteNoteNotFound(error)) return null
      throw error
    }
    const full = parseRemoteNoteDetail(note)
    if (full.id !== id) throw new RemoteBackendError('invalid-response')
    const [links, concepts, provenanceGraph] = await Promise.all([
      linksOf(id), conceptsOf(id), provenanceGraphOf(id),
    ])
    return { ...full, links, concepts, provenanceGraph }
  }

  async function linksOf(id: string): Promise<BackendLink[]> {
    id = remoteNoteId(id)
    return parseRemoteLinks(await getJson<unknown>(remotePath(paths.links, id)), id)
  }

  async function conceptsOf(id: string): Promise<BackendConcept[]> {
    id = remoteNoteId(id)
    return parseRemoteConcepts(await getJson<unknown>(remotePath(paths.concepts, id)), id)
  }

  async function provenanceGraphOf(id: string): Promise<RemoteProvenanceGraph> {
    id = remoteNoteId(id)
    return parseRemoteProvenance(await getJson<unknown>(remotePath(paths.provenance, id)), id)
  }

  return {
    id: config.id ?? 'remote-server',
    capabilities: {
      read: true,
      write: true,
      merge: false,
      multiUser: true,
      semantic: 'server',
      startupCost: 'network',
    },

    async listNotes(o) {
      const result = await getJson<unknown>(paths.notes, o ? { ...o } : undefined)
      return parseRemoteNoteList(result)
    },

    async getNote(id) {
      id = remoteNoteId(id)
      try {
        const full = parseRemoteNoteDetail(await getJson<unknown>(remotePath(paths.note, id)))
        if (full.id !== id) throw new RemoteBackendError('invalid-response')
        return {
          id: full.id, title: full.title, tags: full.tags,
          createdAt: full.createdAt, updatedAt: full.updatedAt,
          source: full.source, starred: full.starred, archived: full.archived,
        }
      } catch (error) {
        if (isRemoteNoteNotFound(error)) return null
        throw error
      }
    },

    search: searchRemote,

    getNoteFull,
    linksOf,
    conceptsOf,
    provenanceGraphOf,
    async provenanceOf() {
      throw new RemoteBackendError('unsupported-operation')
    },

    async semantic(query, k) {
      const result = await searchRemote(query, { mode: 'semantic', limit: k }, true)
      return result.hits
    },

    async semanticWithReport(query, k) {
      return searchRemote(query, { mode: 'semantic', limit: k })
    },

    async manageNote(rawInput) {
      const input = parseRemoteManageInput(rawInput)
      if (input.action === 'create') {
        const result = await writeJson<unknown>('POST', paths.notes, {
          content: input.content, ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(input.source === undefined ? {} : { source: input.source }), revision_mode: 'none', pipeline: [],
        }, 201)
        return { action: input.action, note_id: parseRemoteCreated(result) }
      }
      const id = input.note_id
      if (input.action === 'delete') {
        await writeJson<void>('DELETE', remotePath(paths.note, id), undefined, 204)
        return { action: input.action, note_id: id }
      }
      if (input.action === 'restore') {
        const result = await writeJson<unknown>('POST', remoteUrl(config.baseUrl, remotePath(paths.restore, id), { revision_mode: 'none' }))
        parseRemoteRestored(result, id)
        return { action: input.action, note_id: id }
      }
      const body = input.action === 'update'
        ? { ...(input.content === undefined ? {} : { content: input.content, revision_mode: 'none' }),
          ...(input.tags === undefined ? {} : { tags: input.tags }) }
        : input.action === 'star' || input.action === 'unstar'
          ? { starred: input.action === 'star' } : { archived: input.action === 'archive' }
      const note = parseRemoteNoteDetail(await writeJson<unknown>('PATCH', remotePath(paths.note, id), body))
      if (note.id !== id) throw new RemoteBackendError('invalid-response')
      return { action: input.action, note_id: id, note }
    },
  }
}

// ── Static-file adapter (#189 — wraps the shard reader) ───────────────────

function shardNoteToBackend(n: ShardReaderNote): BackendNote {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags,
    createdAt: toIso(n.created_at),
    updatedAt: toIso(n.updated_at),
    source: n.source,
    starred: n.is_starred,
    archived: n.is_archived,
  }
}

export interface ShardBackendOptions {
  id?: string
  /** Declared semantic tier this shard provides (default `none`). Set to `cosine-small` when the reader has a vector provider. */
  semantic?: BackendSemanticTier
}

/**
 * Wrap a `ShardReader` (#189) as a read-only `DataBackend`. Startup is instant
 * (no index build) and the semantic tier is whatever the reader's provider
 * offers — `none` for text/facets-only shards, `cosine-small` when a vector
 * provider is attached.
 */
export function createShardBackend(reader: ShardReader, options: ShardBackendOptions = {}): DataBackend {
  const semantic = options.semantic ?? 'none'

  return {
    id: options.id ?? 'static-file',
    capabilities: {
      read: true,
      write: false,
      merge: false,
      multiUser: false,
      semantic,
      startupCost: 'instant',
    },

    async listNotes(o) {
      const r = await reader.listNotes(o)
      return { items: r.items.map(shardNoteToBackend), total: r.total }
    },

    async getNote(id) {
      const n = await reader.getNote(id)
      return n ? shardNoteToBackend(n) : null
    },

    async search(query, o) {
      // Request ranking + snippets so hits carry rank/snippet uniformly with the
      // PGlite backend (whose ts_rank always ranks).
      const r = await reader.search(query, { ...o, rank: true, snippets: true })
      const hits: BackendSearchHit[] = r.rankedItems
        ? r.rankedItems.map((it) => ({
            note: shardNoteToBackend(it.note),
            rank: it.rank,
            snippet: it.snippet,
          }))
        : r.items.map((note) => ({ note: shardNoteToBackend(note) }))
      return { hits, total: r.total, facets: r.facets }
    },

    async getNoteFull(id) {
      const f = await reader.getNoteFull(id)
      if (!f) return null
      return {
        ...shardNoteToBackend(f.note),
        content: f.note.revised_content ?? f.note.original_content,
        links: f.links.map(shardLinkToBackend),
        concepts: f.concepts.map(shardConceptToBackend),
        provenance: f.provenance.map(shardProvenanceToBackend),
      }
    },

    async linksOf(id) {
      return (await reader.linksOf(id)).map(shardLinkToBackend)
    },

    async conceptsOf(id) {
      return (await reader.conceptsOf(id)).map(shardConceptToBackend)
    },

    async provenanceOf(id) {
      return (await reader.provenanceOf(id)).map(shardProvenanceToBackend)
    },

    async semantic(query, k) {
      const r = await reader.semantic(query, k)
      return r.map(({ note, score }) => ({ note: shardNoteToBackend(note), rank: score }))
    },
  }
}
