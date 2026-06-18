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
}

export interface BackendLink {
  id: string
  fromNoteId: string
  toNoteId: string
  kind: string
  score: number | null
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface BackendConcept {
  id: string
  schemeId: string
  prefLabel: string
  altLabels: string[]
  definition: string | null
  createdAt: string
  updatedAt: string
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

interface RemoteNoteRecord {
  id: string
  title: string | null
  tags?: string[]
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  source?: string
  starred?: boolean
  is_starred?: boolean
  archived?: boolean
  is_archived?: boolean
  content?: string
  current?: { content?: string }
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

function remoteNoteToBackend(n: RemoteNoteRecord): BackendNote {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags ?? [],
    createdAt: n.createdAt ?? n.created_at ?? '',
    updatedAt: n.updatedAt ?? n.updated_at ?? '',
    source: n.source,
    starred: n.starred ?? n.is_starred,
    archived: n.archived ?? n.is_archived,
  }
}

function remoteFullToBackend(n: RemoteNoteRecord): BackendNoteFull {
  return {
    ...remoteNoteToBackend(n),
    content: n.content ?? n.current?.content ?? '',
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

function shardLinkToBackend(link: ShardLink): BackendLink {
  return {
    id: link.id,
    fromNoteId: link.from_note_id,
    toNoteId: link.to_note_id,
    kind: link.kind,
    score: link.score,
    createdAt: link.created_at,
    ...(link.metadata ? { metadata: link.metadata } : {}),
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

function remoteLinkToBackend(link: Partial<BackendLink> & {
  id: string
  from_note_id?: string
  source_note_id?: string
  to_note_id?: string
  target_note_id?: string
  kind?: string
  link_type?: string
  score?: number | null
  confidence?: number | null
  created_at?: string
}): BackendLink {
  return {
    id: link.id,
    fromNoteId: link.fromNoteId ?? link.from_note_id ?? link.source_note_id ?? '',
    toNoteId: link.toNoteId ?? link.to_note_id ?? link.target_note_id ?? '',
    kind: link.kind ?? link.link_type ?? '',
    score: link.score ?? link.confidence ?? null,
    createdAt: link.createdAt ?? link.created_at ?? '',
    ...(link.metadata ? { metadata: link.metadata } : {}),
  }
}

function remoteConceptToBackend(concept: BackendConcept | Parameters<typeof conceptToBackend>[0]): BackendConcept {
  if ('schemeId' in concept) return concept
  return conceptToBackend(concept)
}

function remoteProvenanceToBackend(
  edge: BackendProvenanceEdge | Parameters<typeof provenanceToBackend>[0],
): BackendProvenanceEdge {
  if ('entityType' in edge) return edge
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
    return [...result.outbound, ...result.inbound].map(linkToBackend)
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
  manageNote: string
  semantic: string
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
  manageNote: '/api/v1/tools/manage-note',
  semantic: '/api/v1/semantic/search',
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

async function remoteJson<T>(config: RemoteBackendConfig, path: string, init: RequestInit = {}): Promise<T> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(remoteUrl(config.baseUrl, path), init)
  if (!response.ok) {
    throw new Error(`Remote backend request failed (${response.status}): ${path}`)
  }
  return response.json() as Promise<T>
}

export function createRemoteBackend(config: RemoteBackendConfig): DataBackend {
  const paths = { ...DEFAULT_REMOTE_PATHS, ...config.paths }

  async function getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return remoteJson<T>(config, remoteUrl(config.baseUrl, path, params), {
      method: 'GET',
      headers: await remoteHeaders(config),
    })
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    return remoteJson<T>(config, path, {
      method: 'POST',
      headers: await remoteHeaders(config, true),
      body: JSON.stringify(body),
    })
  }

  async function getNoteFull(id: string): Promise<BackendNoteFull | null> {
    try {
      const note = await getJson<RemoteNoteRecord>(remotePath(paths.note, id), { full: true })
      const [links, concepts, provenance] = await Promise.all([
        linksOf(id),
        conceptsOf(id),
        provenanceOf(id),
      ])
      return { ...remoteFullToBackend(note), links, concepts, provenance }
    } catch {
      return null
    }
  }

  async function linksOf(id: string): Promise<BackendLink[]> {
    const links = await getJson<Array<Parameters<typeof remoteLinkToBackend>[0]>>(remotePath(paths.links, id))
    return links.map(remoteLinkToBackend)
  }

  async function conceptsOf(id: string): Promise<BackendConcept[]> {
    const concepts = await getJson<Array<BackendConcept | Parameters<typeof conceptToBackend>[0]>>(
      remotePath(paths.concepts, id),
    )
    return concepts.map(remoteConceptToBackend)
  }

  async function provenanceOf(id: string): Promise<BackendProvenanceEdge[]> {
    const edges = await getJson<Array<BackendProvenanceEdge | Parameters<typeof provenanceToBackend>[0]>>(
      remotePath(paths.provenance, id),
    )
    return edges.map(remoteProvenanceToBackend)
  }

  return {
    id: config.id ?? 'remote-server',
    capabilities: {
      read: true,
      write: true,
      merge: true,
      multiUser: true,
      semantic: 'server',
      startupCost: 'network',
    },

    async listNotes(o) {
      const result = await getJson<{ items: RemoteNoteRecord[]; total: number }>(paths.notes, o ? { ...o } : undefined)
      return { items: result.items.map(remoteNoteToBackend), total: result.total }
    },

    async getNote(id) {
      try {
        return remoteNoteToBackend(await getJson<RemoteNoteRecord>(remotePath(paths.note, id)))
      } catch {
        return null
      }
    },

    async search(query, o) {
      const result = await getJson<{
        results?: Array<{ note?: RemoteNoteRecord; rank?: number; snippet?: string } & RemoteNoteRecord>
        hits?: BackendSearchHit[]
        total: number
        facets?: BackendSearchResult['facets']
      }>(paths.search, { query, ...o })
      if (result.hits) return { hits: result.hits, total: result.total, facets: result.facets }
      return {
        hits: (result.results ?? []).map((hit) => ({
          note: remoteNoteToBackend(hit.note ?? hit),
          rank: hit.rank,
          snippet: hit.snippet,
        })),
        total: result.total,
        facets: result.facets,
      }
    },

    getNoteFull,
    linksOf,
    conceptsOf,
    provenanceOf,

    async semantic(query, k) {
      const result = await getJson<{ hits: BackendSearchHit[] }>(paths.semantic, { query, k })
      return result.hits
    },

    async manageNote(input) {
      return postJson<unknown>(paths.manageNote, input)
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
