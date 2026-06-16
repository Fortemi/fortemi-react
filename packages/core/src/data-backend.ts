/**
 * Backend seam (#191) — a uniform tool-intent operation interface that lets the
 * PGlite database backend (#187) and the static-file shard backend (#189) be
 * selected and dispatched against the same way, plus a capability-negotiation
 * API so a caller asks for the operations it needs and gets the lightest backend
 * that provides them.
 *
 * The seam sits one level above SQL: every adapter exposes the same read
 * operations (and optional write / semantic / full-content ops) regardless of
 * whether the data lives in a queryable PGlite instance or a set of static shard
 * files fetched over HTTP. A remote-server backend is a future adapter against
 * this same interface — deliberately deferred. See
 * `.aiwg/architecture/adr-backend-seam.md`.
 */

import type { DatabaseClient } from './storage-backend.js'
import { NotesRepository } from './repositories/notes-repository.js'
import { SearchRepository } from './repositories/search-repository.js'
import type { NoteSummary, NoteFull, SearchResult } from './repositories/types.js'
import { manageNote } from './tools/manage-note.js'
import type { ShardReader, ShardReaderNote } from './shard/shard-reader.js'

// ── Capabilities ──────────────────────────────────────────────────────────

/**
 * Semantic-search tier a backend offers, in increasing capability:
 * - `none`     — no vector search (text / facets only)
 * - `cosine-small` — brute-force cosine over a small static vector set (#189)
 * - `ann-full` — prebuilt/queryable approximate-nearest-neighbour over the full
 *   corpus (PGlite + pgvector, or a prebuilt ANN snapshot)
 * - `server`   — delegated to a remote service (future remote backend)
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
        return { ...summaryToBackend(f), content: f.current.content }
      } catch {
        return null
      }
    },

    async manageNote(input) {
      return manageNote(db, input)
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
      }
    },

    async semantic(query, k) {
      const r = await reader.semantic(query, k)
      return r.map(({ note, score }) => ({ note: shardNoteToBackend(note), rank: score }))
    },
  }
}
