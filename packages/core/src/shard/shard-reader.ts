/**
 * In-place Knowledge Shard reader (issue #189) — the static-file backend.
 *
 * A shard is already a self-describing bundle of formatted component files
 * (`notes.jsonl`, `links.jsonl`, `note_skos_tags.jsonl`, `skos_concepts.json`, …)
 * plus a `manifest.json`. `importShard` loads all of it into PGlite; this reader
 * is the *second* access mode of the SAME format: open the manifest and query the
 * component (or clustered) files directly, with NO PGlite — read-only, lightest.
 *
 * Capabilities (read-only): browse + get note, full-text + facet search, lazy
 * links/tags/concepts + full record. Semantic is opt-in via a pluggable provider
 * (none / brute-force cosine / prebuilt ANN snapshot) — see `StaticSemanticProvider`.
 */

import type {
  ShardClusterRef,
  ShardComponent,
  ShardLink,
  ShardManifest,
  ShardNote,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
  ShardSkosConcept,
  ShardSkosRelation,
} from './types.js'
import { compareShardVersions, CURRENT_SHARD_VERSION } from './types.js'
import { noteFromShard, type BrowserNoteExport } from './field-mapper.js'
import { DEFAULT_MAX_DECOMPRESSED_BYTES, unpackTarGz } from './shard-tar.js'
import { sha256Hex } from './checksum.js'

const decoder = new TextDecoder()

/**
 * Reject manifest-controlled component filenames that could escape the shard
 * base URL (SEC4 — path traversal). Component names are relative paths that may
 * contain a cluster subdirectory (`notes/000.jsonl`), but never a `..` segment,
 * an absolute/root path, a backslash, a URL scheme, or a null byte — any of
 * which would let a hostile manifest read outside the shard on same-origin or
 * multi-tenant static hosting.
 */
export function assertSafeComponentName(filename: string): void {
  if (
    filename.length === 0 ||
    filename.startsWith('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename.includes(':') ||
    filename.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`Refusing to read unsafe shard component path: ${JSON.stringify(filename)}`)
  }
}

function parseJsonlBytes<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  return decoder.decode(data)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T)
}

function parseJsonArrayBytes<T>(data: Uint8Array | undefined): T[] {
  if (!data || data.byteLength === 0) return []
  return JSON.parse(decoder.decode(data)) as T[]
}

/** The public note shape — the same browser-insertable record `importShard` produces. */
export type ShardReaderNote = BrowserNoteExport

export interface ShardSearchWeights {
  title: number
  content: number
  tag: number
}

const DEFAULT_WEIGHTS: ShardSearchWeights = { title: 4, content: 1, tag: 2 }

export interface ShardListOptions {
  offset?: number
  limit?: number
  /** Include archived notes (default true). */
  includeArchived?: boolean
  /** Include soft-deleted notes (default false). */
  includeDeleted?: boolean
}

export interface ShardSearchOptions extends ShardListOptions {
  /** AND-filter: note must carry every listed tag. */
  tags?: string[]
  /** OR-filter on note source. */
  source?: string[]
  rank?: boolean
  snippets?: boolean
  snippetLength?: number
  weights?: Partial<ShardSearchWeights>
}

export interface ShardSearchRankedNote {
  note: ShardReaderNote
  rank: number
  snippet?: string
}

export interface ShardSearchResult {
  items: ShardReaderNote[]
  total: number
  facets: { tags: Record<string, number>; source: Record<string, number> }
  rankedItems?: ShardSearchRankedNote[]
  /** Cluster files fetched to serve this query (0 when served from cache). */
  fetchedClusters: number
}

export interface ShardNoteFull {
  note: ShardReaderNote
  links: ShardLink[]
  concepts: ShardSkosConcept[]
  provenance: ShardProvenanceEdge[]
}

/**
 * Opt-in semantic search over static files. The reader stays text/facets-only
 * unless a provider is supplied. Implementations span the tradeoff points:
 * brute-force cosine over a small static vector set, or a prebuilt ANN snapshot
 * for the full corpus. `prepare()` may lazily load whatever static asset it needs.
 */
export interface StaticSemanticProvider {
  prepare?(store: ShardComponentStore): Promise<void>
  search(query: string, k: number): Promise<Array<{ id: string; score: number }>>
}

export interface OpenShardOptions {
  /** Static base URL when `source` is unpacked component files. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Optional semantic provider; absent → `semantic()` returns []. */
  semantic?: StaticSemanticProvider
  /** Bounds the cross-page search match cache (total cached note records). Default 5000. */
  maxCachedMatches?: number
  /** Maximum bytes fetched for any unpacked component. Default 256 MiB. */
  maxComponentBytes?: number
}

/** Reads shard component/cluster files from a packed map or a static base URL. */
export interface ShardComponentStore {
  readonly manifest: ShardManifest
  read(filename: string): Promise<Uint8Array | undefined>
}

export type ShardReaderSource = Uint8Array | Blob | { baseUrl: string; fetchImpl?: typeof fetch }

async function toBytes(blobOrBytes: Uint8Array | Blob): Promise<Uint8Array> {
  if (blobOrBytes instanceof Uint8Array) return blobOrBytes
  return new Uint8Array(await blobOrBytes.arrayBuffer())
}

/** A store backed by a fully-unpacked in-memory file map (packed tar.gz source). */
class PackedComponentStore implements ShardComponentStore {
  readonly manifest: ShardManifest
  private files: Map<string, Uint8Array>
  constructor(files: Map<string, Uint8Array>, manifest: ShardManifest) {
    this.files = files
    this.manifest = manifest
  }
  async read(filename: string): Promise<Uint8Array | undefined> {
    const bytes = this.files.get(filename)
    const expectedChecksum = this.manifest.checksums?.[filename]
    if (bytes && expectedChecksum && await sha256Hex(bytes) !== expectedChecksum) {
      throw new Error(`Checksum validation failed for shard component: ${filename}`)
    }
    return bytes
  }
}

/** A store that lazily fetches component/cluster files from a static base URL. */
class UrlComponentStore implements ShardComponentStore {
  readonly manifest: ShardManifest
  private baseUrl: string
  private fetchImpl: typeof fetch
  private cache = new Map<string, Uint8Array | undefined>()
  private maxComponentBytes: number
  constructor(baseUrl: string, fetchImpl: typeof fetch, manifest: ShardManifest, maxComponentBytes: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
    this.manifest = manifest
    this.maxComponentBytes = maxComponentBytes
  }
  async read(filename: string): Promise<Uint8Array | undefined> {
    assertSafeComponentName(filename)
    if (this.cache.has(filename)) return this.cache.get(filename)
    const response = await this.fetchImpl(`${this.baseUrl}/${filename}`)
    if (!response.ok) {
      this.cache.set(filename, undefined)
      return undefined
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > this.maxComponentBytes) {
      throw new Error(`Shard component ${filename} exceeds cap ${this.maxComponentBytes} bytes`)
    }
    const chunks: Uint8Array[] = []
    let total = 0
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > this.maxComponentBytes) {
          await reader.cancel()
          throw new Error(`Shard component ${filename} exceeds cap ${this.maxComponentBytes} bytes`)
        }
        chunks.push(value)
      }
    } else {
      const value = new Uint8Array(await response.arrayBuffer())
      total = value.byteLength
      if (total > this.maxComponentBytes) {
        throw new Error(`Shard component ${filename} exceeds cap ${this.maxComponentBytes} bytes`)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const expectedChecksum = this.manifest.checksums?.[filename]
    if (expectedChecksum && await sha256Hex(bytes) !== expectedChecksum) {
      throw new Error(`Checksum validation failed for shard component: ${filename}`)
    }
    this.cache.set(filename, bytes)
    return bytes
  }
}

async function resolveStore(source: ShardReaderSource, maxComponentBytes: number): Promise<ShardComponentStore> {
  if (typeof source === 'object' && 'baseUrl' in source) {
    const fetchImpl = source.fetchImpl ?? (globalThis.fetch as typeof fetch)
    const base = source.baseUrl.replace(/\/$/, '')
    const manifestResponse = await fetchImpl(`${base}/manifest.json`)
    if (!manifestResponse.ok) {
      throw new Error(`Failed to fetch shard manifest (${manifestResponse.status}): ${base}/manifest.json`)
    }
    const manifest = (await manifestResponse.json()) as ShardManifest
    return new UrlComponentStore(base, fetchImpl, manifest, maxComponentBytes)
  }
  const bytes = await toBytes(source)
  const files = unpackTarGz(bytes)
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) throw new Error('Missing manifest.json in shard archive')
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as ShardManifest
  return new PackedComponentStore(files, manifest)
}

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/i).filter((token) => token.length > 0)
}

function noteSearchText(note: ShardNote): string {
  const extractedText = (note.attachments ?? note.binary_sources)
    ?.map((source) => source.extracted_text)
    .filter(Boolean)
    .join(' ') ?? ''
  return `${note.title ?? ''} ${note.original_content} ${note.revised_content ?? ''} ${extractedText}`.toLowerCase()
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function noteMatchesTokens(note: ShardNote, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const text = noteSearchText(note)
  const tagText = note.tags.join(' ').toLowerCase()
  // AND semantics, matching Postgres plainto_tsquery (all lexemes required).
  return tokens.every((token) => text.includes(token) || tagText.includes(token))
}

function rankNote(note: ShardNote, tokens: string[], weights: ShardSearchWeights): number {
  if (tokens.length === 0) return 0
  const title = (note.title ?? '').toLowerCase()
  const extractedText = (note.attachments ?? note.binary_sources)
    ?.map((source) => source.extracted_text)
    .filter(Boolean)
    .join(' ') ?? ''
  const content = `${note.original_content} ${note.revised_content ?? ''} ${extractedText}`.toLowerCase()
  const tagText = note.tags.join(' ').toLowerCase()
  let score = 0
  for (const token of tokens) {
    score += countOccurrences(title, token) * weights.title
    score += countOccurrences(content, token) * weights.content
    if (tagText.includes(token)) score += weights.tag
  }
  return score
}

function makeSnippet(note: ShardNote, tokens: string[], length: number): string {
  const extractedText = (note.attachments ?? note.binary_sources)
    ?.map((source) => source.extracted_text)
    .filter(Boolean)
    .join(' ') ?? ''
  const content = `${note.original_content} ${note.revised_content ?? ''} ${extractedText}`.trim()
  if (tokens.length === 0) return content.slice(0, length)
  const lower = content.toLowerCase()
  const firstAt = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstAt - Math.floor(length / 3))
  return (start > 0 ? '…' : '') + content.slice(start, start + length) + (start + length < content.length ? '…' : '')
}

function passesFilters(note: ShardNote, options: ShardSearchOptions): boolean {
  if (!options.includeDeleted && note.deleted_at) return false
  if (options.includeArchived === false && note.archived) return false
  if (options.tags && !options.tags.every((tag) => note.tags.includes(tag))) return false
  if (options.source && !options.source.includes(note.source)) return false
  return true
}

function facetCounts(notes: ShardNote[]): { tags: Record<string, number>; source: Record<string, number> } {
  const tags: Record<string, number> = {}
  const source: Record<string, number> = {}
  for (const note of notes) {
    for (const tag of note.tags) tags[tag] = (tags[tag] ?? 0) + 1
    source[note.source] = (source[note.source] ?? 0) + 1
  }
  return { tags, source }
}

export interface ShardReader {
  readonly manifest: ShardManifest
  listNotes(options?: ShardListOptions): Promise<{ items: ShardReaderNote[]; total: number }>
  getNote(id: string): Promise<ShardReaderNote | null>
  search(query: string, options?: ShardSearchOptions): Promise<ShardSearchResult>
  linksOf(id: string): Promise<ShardLink[]>
  conceptsOf(id: string): Promise<ShardSkosConcept[]>
  relationsOf(conceptId: string): Promise<ShardSkosRelation[]>
  provenanceOf(id: string): Promise<ShardProvenanceEdge[]>
  getNoteFull(id: string): Promise<ShardNoteFull | null>
  semantic(query: string, k?: number): Promise<Array<{ note: ShardReaderNote; score: number }>>
  close(): void
}

class ShardReaderImpl implements ShardReader {
  readonly manifest: ShardManifest
  private store: ShardComponentStore
  private options: OpenShardOptions
  private noteClusterCache = new Map<string, ShardNote[]>()
  private allNotes: ShardNote[] | null = null
  private links: ShardLink[] | null = null
  private noteSkos: ShardNoteSkosTag[] | null = null
  private concepts: Map<string, ShardSkosConcept> | null = null
  private relations: ShardSkosRelation[] | null = null
  private provenanceEdges: ShardProvenanceEdge[] | null = null
  private matchCache = new Map<string, ShardNote[]>()
  private maxCachedMatches: number
  private semanticPrepared = false

  constructor(store: ShardComponentStore, options: OpenShardOptions) {
    this.store = store
    this.manifest = store.manifest
    this.options = options
    this.maxCachedMatches = options.maxCachedMatches && options.maxCachedMatches > 0 ? options.maxCachedMatches : 5000
  }

  private noteClusters(): ShardClusterRef[] | null {
    return this.manifest.layout?.clusters?.notes ?? null
  }

  private async readCluster(ref: ShardClusterRef): Promise<{ notes: ShardNote[]; fetched: boolean }> {
    const cached = this.noteClusterCache.get(ref.href)
    if (cached) return { notes: cached, fetched: false }
    const notes = parseJsonlBytes<ShardNote>(await this.store.read(ref.href))
    this.noteClusterCache.set(ref.href, notes)
    return { notes, fetched: true }
  }

  /** Load every note (clustered or monolithic). Returns count of cluster files fetched. */
  private async loadAllNotes(): Promise<{ notes: ShardNote[]; fetched: number }> {
    const clusters = this.noteClusters()
    if (!clusters) {
      if (!this.allNotes) {
        this.allNotes = parseJsonlBytes<ShardNote>(await this.store.read('notes.jsonl'))
        return { notes: this.allNotes, fetched: 1 }
      }
      return { notes: this.allNotes, fetched: 0 }
    }
    const all: ShardNote[] = []
    let fetched = 0
    for (const ref of clusters) {
      const loaded = await this.readCluster(ref)
      if (loaded.fetched) fetched += 1
      all.push(...loaded.notes)
    }
    return { notes: all, fetched }
  }

  async listNotes(options: ShardListOptions = {}): Promise<{ items: ShardReaderNote[]; total: number }> {
    const offset = options.offset ?? 0
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER
    // Browse needs a stable, filtered total, so it loads all notes (clustered or
    // monolithic). Per-record exclusion (deleted/archived) would make a pure
    // range-skip miscount, so range-limited cluster fetch is reserved for search's
    // match cache rather than applied here.
    const { notes } = await this.loadAllNotes()
    const filtered = notes.filter((note) => passesFilters(note, options))
    const page = filtered.slice(offset, offset + limit)
    return { items: page.map(noteFromShard), total: filtered.length }
  }

  async getNote(id: string): Promise<ShardReaderNote | null> {
    const { notes } = await this.loadAllNotes()
    const found = notes.find((note) => note.id === id)
    return found ? noteFromShard(found) : null
  }

  private matchKey(query: string, options: ShardSearchOptions): string {
    return JSON.stringify({
      q: query.trim().toLowerCase(),
      tags: options.tags ?? null,
      source: options.source ?? null,
      includeArchived: options.includeArchived ?? true,
      includeDeleted: options.includeDeleted ?? false,
      weights: { ...DEFAULT_WEIGHTS, ...options.weights },
    })
  }

  private cacheMatches(key: string, notes: ShardNote[]): void {
    this.matchCache.delete(key)
    this.matchCache.set(key, notes)
    let total = 0
    for (const set of this.matchCache.values()) total += set.length
    while (total > this.maxCachedMatches && this.matchCache.size > 1) {
      const oldest = this.matchCache.keys().next().value
      if (oldest === undefined || oldest === key) break
      total -= this.matchCache.get(oldest)?.length ?? 0
      this.matchCache.delete(oldest)
    }
  }

  async search(query: string, options: ShardSearchOptions = {}): Promise<ShardSearchResult> {
    const tokens = tokenize(query)
    const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
    const offset = options.offset ?? 0
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER
    const key = this.matchKey(query, options)

    let matched = this.matchCache.get(key)
    let fetchedClusters = 0
    if (matched) {
      this.matchCache.delete(key)
      this.matchCache.set(key, matched)
    } else {
      const { notes, fetched } = await this.loadAllNotes()
      fetchedClusters = fetched
      matched = notes.filter((note) => passesFilters(note, options) && noteMatchesTokens(note, tokens))
      if (tokens.length > 0 && options.rank !== false) {
        matched = [...matched].sort((a, b) => rankNote(b, tokens, weights) - rankNote(a, tokens, weights))
      }
      this.cacheMatches(key, matched)
    }

    const page = matched.slice(offset, offset + limit)
    const result: ShardSearchResult = {
      items: page.map(noteFromShard),
      total: matched.length,
      facets: facetCounts(matched),
      fetchedClusters,
    }
    if (options.rank || options.snippets) {
      const snippetLength = options.snippetLength ?? 160
      result.rankedItems = page.map((note) => ({
        note: noteFromShard(note),
        rank: rankNote(note, tokens, weights),
        ...(options.snippets ? { snippet: makeSnippet(note, tokens, snippetLength) } : {}),
      }))
    }
    return result
  }

  private async loadLinks(): Promise<ShardLink[]> {
    if (!this.links) this.links = parseJsonlBytes<ShardLink>(await this.store.read('links.jsonl'))
    return this.links
  }

  async linksOf(id: string): Promise<ShardLink[]> {
    const links = await this.loadLinks()
    return links.filter((link) => link.from_note_id === id || link.to_note_id === id)
  }

  private async loadConcepts(): Promise<{ noteSkos: ShardNoteSkosTag[]; concepts: Map<string, ShardSkosConcept> }> {
    if (!this.noteSkos) {
      this.noteSkos = parseJsonlBytes<ShardNoteSkosTag>(await this.store.read('note_skos_tags.jsonl'))
    }
    if (!this.concepts) {
      const list = parseJsonArrayBytes<ShardSkosConcept>(await this.store.read('skos_concepts.json'))
      this.concepts = new Map(list.map((concept) => [concept.id, concept]))
    }
    return { noteSkos: this.noteSkos, concepts: this.concepts }
  }

  async conceptsOf(id: string): Promise<ShardSkosConcept[]> {
    const { noteSkos, concepts } = await this.loadConcepts()
    const out: ShardSkosConcept[] = []
    for (const tag of noteSkos) {
      if (tag.note_id !== id) continue
      const concept = concepts.get(tag.concept_id)
      if (concept) out.push(concept)
    }
    return out
  }

  private async loadRelations(): Promise<ShardSkosRelation[]> {
    if (!this.relations) {
      this.relations = parseJsonlBytes<ShardSkosRelation>(await this.store.read('skos_relations.jsonl'))
    }
    return this.relations
  }

  async relationsOf(conceptId: string): Promise<ShardSkosRelation[]> {
    const relations = await this.loadRelations()
    return relations.filter(
      (relation) => relation.source_concept_id === conceptId || relation.target_concept_id === conceptId,
    )
  }

  private async loadProvenanceEdges(): Promise<ShardProvenanceEdge[]> {
    if (!this.provenanceEdges) {
      this.provenanceEdges = parseJsonlBytes<ShardProvenanceEdge>(await this.store.read('provenance_edges.jsonl'))
    }
    return this.provenanceEdges
  }

  async provenanceOf(id: string): Promise<ShardProvenanceEdge[]> {
    const edges = await this.loadProvenanceEdges()
    return edges
      .filter((edge) => edge.entity_type === 'note' && edge.entity_id === id)
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
  }

  async getNoteFull(id: string): Promise<ShardNoteFull | null> {
    const note = await this.getNote(id)
    if (!note) return null
    const [links, concepts, provenance] = await Promise.all([
      this.linksOf(id),
      this.conceptsOf(id),
      this.provenanceOf(id),
    ])
    return { note, links, concepts, provenance }
  }

  async semantic(query: string, k = 10): Promise<Array<{ note: ShardReaderNote; score: number }>> {
    const provider = this.options.semantic
    if (!provider) return []
    if (!this.semanticPrepared) {
      await provider.prepare?.(this.store)
      this.semanticPrepared = true
    }
    const hits = await provider.search(query, k)
    const { notes } = await this.loadAllNotes()
    const byId = new Map(notes.map((note) => [note.id, note]))
    const out: Array<{ note: ShardReaderNote; score: number }> = []
    for (const hit of hits) {
      const note = byId.get(hit.id)
      if (note) out.push({ note: noteFromShard(note), score: hit.score })
    }
    return out
  }

  close(): void {
    this.noteClusterCache.clear()
    this.matchCache.clear()
    this.allNotes = null
    this.links = null
    this.noteSkos = null
    this.concepts = null
    this.relations = null
    this.provenanceEdges = null
  }
}

/**
 * Open a Knowledge Shard for in-place, read-only query — NO PGlite. `source` is a
 * packed tar.gz (`Uint8Array`/`Blob`) or a static base URL serving the unpacked
 * component/cluster files. Honors `min_reader_version`: a shard that needs a newer
 * reader than this build throws (the host should fall back to `importShard`).
 */
export async function openShard(
  source: ShardReaderSource,
  options: OpenShardOptions = {},
): Promise<ShardReader> {
  const store = await resolveStore(source, options.maxComponentBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES)
  if (store.manifest.min_reader_version && compareShardVersions(store.manifest.min_reader_version, CURRENT_SHARD_VERSION) > 0) {
    throw new Error(
      `Shard requires reader version ${store.manifest.min_reader_version}, ` +
      `but this build supports ${CURRENT_SHARD_VERSION}. Import the shard instead.`,
    )
  }
  return new ShardReaderImpl(store, options)
}

export { type ShardComponent }
