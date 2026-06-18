import { describe, expect, it } from 'vitest'
import { openShard } from '../shard/shard-reader.js'
import { createCosineSemanticProvider } from '../shard/semantic-providers.js'
import { packTarGz } from '../shard/shard-tar.js'
import { CURRENT_SHARD_VERSION, SHARD_FORMAT } from '../shard/types.js'
import type {
  ShardClusterRef,
  ShardLink,
  ShardManifest,
  ShardNote,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
  ShardSkosConcept,
  ShardSkosRelation,
} from '../shard/types.js'

const encoder = new TextEncoder()

function note(overrides: Partial<ShardNote> & Pick<ShardNote, 'id'>): ShardNote {
  return {
    id: overrides.id,
    title: overrides.title ?? null,
    original_content: overrides.original_content ?? '',
    revised_content: overrides.revised_content ?? null,
    format: overrides.format ?? 'markdown',
    source: overrides.source ?? 'manual',
    starred: overrides.starred ?? false,
    archived: overrides.archived ?? false,
    tags: overrides.tags ?? [],
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
    deleted_at: overrides.deleted_at ?? null,
  }
}

const NOTES: ShardNote[] = [
  note({ id: 'n1', title: 'Founder Breakfast', original_content: 'Notes from the founder breakfast meeting.', tags: ['event', 'founders'], source: 'import' }),
  note({ id: 'n2', title: 'Breakfast menu', original_content: 'Pancakes and coffee for the morning.', tags: ['food'], source: 'manual' }),
  note({ id: 'n3', title: 'Founder bios', original_content: 'Biographies of each founder.', tags: ['founders'], source: 'manual' }),
  note({ id: 'n4', title: 'Archived idea', original_content: 'An old archived founder breakfast idea.', tags: ['event'], source: 'manual', archived: true }),
  note({ id: 'n5', title: 'Deleted note', original_content: 'founder breakfast', tags: [], deleted_at: '2026-02-01T00:00:00.000Z' }),
]

const LINKS: ShardLink[] = [
  { id: 'l1', from_note_id: 'n1', to_note_id: 'n3', kind: 'related', score: 0.9, created_at: '2026-01-01T00:00:00.000Z' },
  { id: 'l2', from_note_id: 'n2', to_note_id: 'n1', kind: 'mentions', score: null, created_at: '2026-01-01T00:00:00.000Z' },
]

const NOTE_SKOS: ShardNoteSkosTag[] = [
  { id: 's1', note_id: 'n1', concept_id: 'c1', created_at: '2026-01-01T00:00:00.000Z' },
]
const CONCEPTS: ShardSkosConcept[] = [
  { id: 'c1', scheme_id: 'sch1', pref_label: 'Networking', alt_labels: [], definition: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
  { id: 'c2', scheme_id: 'sch1', pref_label: 'Events', alt_labels: [], definition: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
]
const RELATIONS: ShardSkosRelation[] = [
  { id: 'r1', source_concept_id: 'c1', target_concept_id: 'c2', relation_type: 'broader', created_at: '2026-01-01T00:00:00.000Z' },
]
const PROVENANCE: ShardProvenanceEdge[] = [
  {
    id: 'p2',
    entity_type: 'note',
    entity_id: 'n1',
    activity: 'frontmatter_backfilled',
    agent: 'codex',
    started_at: '2026-05-23T18:31:05-04:00',
    ended_at: null,
    attributes: { ref_id: 'REF-033', source: 'section9/research-papers' },
  },
  {
    id: 'p1',
    entity_type: 'note',
    entity_id: 'n1',
    activity: 'inducted',
    agent: 'research-corpus',
    started_at: '2026-01-25T03:11:13-05:00',
    ended_at: null,
    attributes: { ref_id: 'REF-033', title: 'SKOS Simple Knowledge Organization System Reference' },
  },
  {
    id: 'p3',
    entity_type: 'collection',
    entity_id: 'n1',
    activity: 'inducted',
    agent: 'research-corpus',
    started_at: '2026-01-25T02:36:43-05:00',
    ended_at: null,
    attributes: { ref_id: 'REF-062', title: 'W3C PROV Data Model' },
  },
]

function manifest(overrides: Partial<ShardManifest> = {}): ShardManifest {
  return {
    version: CURRENT_SHARD_VERSION,
    matric_version: '1.0.0',
    format: SHARD_FORMAT,
    created_at: '2026-01-01T00:00:00.000Z',
    components: ['notes', 'links', 'note_skos_tags', 'skos_concepts', 'skos_relations', 'provenance_edges'],
    counts: { notes: NOTES.length },
    checksums: {},
    min_reader_version: '1.0.0',
    ...overrides,
  }
}

function baseFiles(m: ShardManifest): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  files.set('manifest.json', encoder.encode(JSON.stringify(m)))
  files.set('links.jsonl', encoder.encode(LINKS.map((l) => JSON.stringify(l)).join('\n')))
  files.set('note_skos_tags.jsonl', encoder.encode(NOTE_SKOS.map((t) => JSON.stringify(t)).join('\n')))
  files.set('skos_concepts.json', encoder.encode(JSON.stringify(CONCEPTS)))
  files.set('skos_relations.jsonl', encoder.encode(RELATIONS.map((r) => JSON.stringify(r)).join('\n')))
  files.set('provenance_edges.jsonl', encoder.encode(PROVENANCE.map((p) => JSON.stringify(p)).join('\n')))
  return files
}

function monolithicShard(): Uint8Array {
  const files = baseFiles(manifest())
  files.set('notes.jsonl', encoder.encode(NOTES.map((n) => JSON.stringify(n)).join('\n')))
  return packTarGz(files)
}

function clusteredShard(clusterSize = 2): { bytes: Uint8Array; clusters: ShardClusterRef[] } {
  const clusters: ShardClusterRef[] = []
  const m = manifest()
  const files = baseFiles(m)
  for (let offset = 0; offset < NOTES.length; offset += clusterSize) {
    const slice = NOTES.slice(offset, offset + clusterSize)
    const href = `notes/${String(offset).padStart(3, '0')}.jsonl`
    clusters.push({ href, offset, count: slice.length })
    files.set(href, encoder.encode(slice.map((n) => JSON.stringify(n)).join('\n')))
  }
  m.layout = { clusters: { notes: clusters } }
  files.set('manifest.json', encoder.encode(JSON.stringify(m)))
  return { bytes: packTarGz(files), clusters }
}

describe('openShard — in-place read surface (monolithic)', () => {
  it('browses with soft-delete excluded and archived included by default', async () => {
    const reader = await openShard(monolithicShard())
    const { items, total } = await reader.listNotes()
    expect(total).toBe(4) // n5 (deleted) excluded
    expect(items.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
    const noArchived = await reader.listNotes({ includeArchived: false })
    expect(noArchived.total).toBe(3)
    expect(noArchived.items.some((n) => n.id === 'n4')).toBe(false)
  })

  it('gets a single note by id (mapped to the browser shape)', async () => {
    const reader = await openShard(monolithicShard())
    const n1 = await reader.getNote('n1')
    expect(n1?.title).toBe('Founder Breakfast')
    expect(n1?.is_archived).toBe(false)
    expect(await reader.getNote('missing')).toBeNull()
  })

  it('full-text search uses AND (multi-word) semantics like plainto_tsquery', async () => {
    const reader = await openShard(monolithicShard())
    const both = await reader.search('founder breakfast')
    // n1 (both) and n4 (archived, both) match; n2 has only breakfast, n3 only founder, n5 deleted.
    expect(both.items.map((n) => n.id).sort()).toEqual(['n1', 'n4'])
    const single = await reader.search('founder')
    expect(single.items.map((n) => n.id).sort()).toEqual(['n1', 'n3', 'n4'])
  })

  it('ranks title hits above body hits and returns snippets', async () => {
    const reader = await openShard(monolithicShard())
    const result = await reader.search('founder breakfast', { rank: true, snippets: true, snippetLength: 40 })
    expect(result.rankedItems?.[0]?.note.id).toBe('n1') // 'Founder Breakfast' in title outranks n4
    expect(result.rankedItems?.[0]?.rank).toBeGreaterThan(result.rankedItems?.[1]?.rank ?? 0)
    expect(result.rankedItems?.[0]?.snippet).toContain('founder')
  })

  it('computes tag + source facets over the matched set', async () => {
    const reader = await openShard(monolithicShard())
    const result = await reader.search('founder') // matches n1, n3, n4
    expect(result.facets.tags.founders).toBe(2) // n1, n3
    expect(result.facets.tags.event).toBe(2) // n1, n4
    expect(result.facets.source.manual).toBe(2) // n3, n4
    expect(result.facets.source.import).toBe(1) // n1
  })

  it('filters by tag and source', async () => {
    const reader = await openShard(monolithicShard())
    const byTag = await reader.search('', { tags: ['founders'] })
    expect(byTag.items.map((n) => n.id).sort()).toEqual(['n1', 'n3'])
    const bySource = await reader.search('', { source: ['import'] })
    expect(bySource.items.map((n) => n.id)).toEqual(['n1'])
  })

  it('resolves links, concepts, SKOS relations, provenance, and the full record lazily', async () => {
    const reader = await openShard(monolithicShard())
    const links = await reader.linksOf('n1')
    expect(links.map((l) => l.id).sort()).toEqual(['l1', 'l2'])
    const concepts = await reader.conceptsOf('n1')
    expect(concepts.map((c) => c.pref_label)).toEqual(['Networking'])
    const relations = await reader.relationsOf('c1')
    expect(relations.map((r) => r.id)).toEqual(['r1'])
    const provenance = await reader.provenanceOf('n1')
    expect(provenance.map((p) => p.id)).toEqual(['p1', 'p2'])
    const full = await reader.getNoteFull('n1')
    expect(full?.note.id).toBe('n1')
    expect(full?.links).toHaveLength(2)
    expect(full?.concepts).toHaveLength(1)
    expect(full?.provenance.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(await reader.getNoteFull('missing')).toBeNull()
  })

  it('reuses the scan across pages of the same query (match cache)', async () => {
    const reader = await openShard(monolithicShard())
    const page1 = await reader.search('founder', { limit: 1, offset: 0 })
    expect(page1.fetchedClusters).toBe(1) // cold: read notes.jsonl
    const page2 = await reader.search('founder', { limit: 1, offset: 1 })
    expect(page2.fetchedClusters).toBe(0) // served from match cache, no re-read
    expect(page2.total).toBe(page1.total)
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id)
  })

  it('returns nothing from semantic() when no provider is configured', async () => {
    const reader = await openShard(monolithicShard())
    expect(await reader.semantic('founder')).toEqual([])
  })
})

describe('openShard — clustered layout', () => {
  it('reads notes from cluster files and matches the monolithic result', async () => {
    const reader = await openShard(clusteredShard(2).bytes)
    const all = await reader.listNotes()
    expect(all.items.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
    const search = await reader.search('founder breakfast', { rank: true })
    expect(search.items.map((n) => n.id).sort()).toEqual(['n1', 'n4'])
  })

  it('fetches all clusters on the cold scan, then serves pages from cache', async () => {
    // Fresh reader so no prior listNotes/search has warmed the cluster cache.
    const reader = await openShard(clusteredShard(2).bytes)
    const cold = await reader.search('founder breakfast', { rank: true })
    expect(cold.fetchedClusters).toBe(3) // 5 notes / clusterSize 2 → clusters at 0,2,4
    const page2 = await reader.search('founder breakfast', { rank: true, offset: 1, limit: 1 })
    expect(page2.fetchedClusters).toBe(0)
  })
})

describe('openShard — static base URL source', () => {
  it('lazily fetches the manifest + components from a base URL', async () => {
    const files = baseFiles(manifest())
    files.set('notes.jsonl', encoder.encode(NOTES.map((n) => JSON.stringify(n)).join('\n')))
    const requested: string[] = []
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const href = String(url).replace('https://cdn.example/shard/', '')
      requested.push(href)
      const bytes = files.get(href)
      if (!bytes) return new Response(null, { status: 404 })
      const ab = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(ab).set(bytes)
      return new Response(ab, { status: 200 })
    }) as typeof fetch

    const reader = await openShard({ baseUrl: 'https://cdn.example/shard/', fetchImpl })
    const result = await reader.search('founder breakfast')
    expect(result.items.map((n) => n.id).sort()).toEqual(['n1', 'n4'])
    expect(requested).toContain('manifest.json')
    expect(requested).toContain('notes.jsonl')
    // links/skos not touched by a text search → lazy
    expect(requested).not.toContain('links.jsonl')
    expect(requested).not.toContain('skos_relations.jsonl')
    expect(requested).not.toContain('provenance_edges.jsonl')

    await reader.provenanceOf('n1')
    await reader.relationsOf('c1')
    expect(requested).toContain('provenance_edges.jsonl')
    expect(requested).toContain('skos_relations.jsonl')
  })
})

describe('openShard — pluggable semantic (cosine provider)', () => {
  it('ranks notes by cosine of a host-supplied query embedding', async () => {
    // 2D toy vectors: query ~ [1,0]; n1 closest, n3 next, n2 orthogonal.
    const provider = createCosineSemanticProvider({
      embedQuery: () => [1, 0],
      vectors: [
        { id: 'n1', vector: [1, 0.1] },
        { id: 'n3', vector: [0.8, 0.6] },
        { id: 'n2', vector: [0, 1] },
      ],
    })
    const reader = await openShard(monolithicShard(), { semantic: provider })
    const hits = await reader.semantic('founders', 2)
    expect(hits.map((h) => h.note.id)).toEqual(['n1', 'n3'])
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1)
  })

  it('loads vectors from a static vectors.jsonl when not pre-supplied', async () => {
    const files = baseFiles(manifest())
    files.set('notes.jsonl', encoder.encode(NOTES.map((n) => JSON.stringify(n)).join('\n')))
    files.set('vectors.jsonl', encoder.encode([
      JSON.stringify({ id: 'n3', vector: [1, 0] }),
      JSON.stringify({ id: 'n1', vector: [0, 1] }),
    ].join('\n')))
    const provider = createCosineSemanticProvider({ embedQuery: () => [1, 0] })
    const reader = await openShard(packTarGz(files), { semantic: provider })
    const hits = await reader.semantic('x', 5)
    expect(hits[0]?.note.id).toBe('n3')
  })
})

describe('openShard — reader version guard', () => {
  it('throws when the shard needs a newer reader than this build', async () => {
    const files = baseFiles(manifest({ min_reader_version: '99.0.0' }))
    files.set('notes.jsonl', encoder.encode(NOTES.map((n) => JSON.stringify(n)).join('\n')))
    await expect(openShard(packTarGz(files))).rejects.toThrow(/requires reader version/)
  })
})
