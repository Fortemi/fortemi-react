import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import { openShard } from '../shard/shard-reader.js'
import { packTarGz } from '../shard/shard-tar.js'
import { CURRENT_SHARD_VERSION, SHARD_FORMAT } from '../shard/types.js'
import type {
  ShardLink,
  ShardManifest,
  ShardNote,
  ShardNoteSkosTag,
  ShardProvenanceEdge,
  ShardSkosConcept,
} from '../shard/types.js'
import {
  selectBackend,
  createPGliteBackend,
  createRemoteBackend,
  createShardBackend,
  type DataBackend,
  type BackendCapabilities,
} from '../data-backend.js'

const encoder = new TextEncoder()

// ── Fixtures ──────────────────────────────────────────────────────────────

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

const SHARD_LINKS: ShardLink[] = [
  {
    id: 'link-1',
    from_note_id: 'n1',
    to_note_id: 'n3',
    to_url: null,
    kind: 'related',
    score: 0.75,
    created_at: '2026-01-02T00:00:00.000Z',
    metadata: null,
  },
]

const SHARD_CONCEPTS: ShardSkosConcept[] = [
  {
    id: 'concept-1',
    scheme_id: 'scheme-1',
    pref_label: 'Founders',
    alt_labels: ['operators'],
    definition: 'Founder-related notes',
    created_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-01-04T00:00:00.000Z',
  },
]

const SHARD_NOTE_SKOS: ShardNoteSkosTag[] = [
  {
    id: 'note-concept-1',
    note_id: 'n1',
    concept_id: 'concept-1',
    created_at: '2026-01-05T00:00:00.000Z',
  },
]

const SHARD_PROVENANCE: ShardProvenanceEdge[] = [
  {
    id: 'prov-1',
    entity_type: 'note',
    entity_id: 'n1',
    activity: 'inducted',
    agent: 'research-corpus',
    started_at: '2026-01-25T03:11:13-05:00',
    ended_at: null,
    attributes: { ref_id: 'REF-033', source: 'section9/research-papers' },
  },
]

function packShard(notes: ShardNote[]): Uint8Array {
  const manifest: ShardManifest = {
    version: CURRENT_SHARD_VERSION,
    matric_version: '1.0.0',
    format: SHARD_FORMAT,
    created_at: '2026-01-01T00:00:00.000Z',
    components: ['notes', 'links', 'skos_concepts', 'note_skos_tags', 'provenance_edges'],
    counts: {
      notes: notes.length,
      links: SHARD_LINKS.length,
      skos_concepts: SHARD_CONCEPTS.length,
      note_skos_tags: SHARD_NOTE_SKOS.length,
      provenance_edges: SHARD_PROVENANCE.length,
    },
    checksums: {},
    min_reader_version: '1.0.0',
  }
  const files = new Map<string, Uint8Array>()
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  files.set('notes.jsonl', encoder.encode(notes.map((n) => JSON.stringify(n)).join('\n')))
  files.set('links.jsonl', encoder.encode(SHARD_LINKS.map((l) => JSON.stringify(l)).join('\n')))
  files.set('skos_concepts.json', encoder.encode(JSON.stringify(SHARD_CONCEPTS)))
  files.set('note_skos_tags.jsonl', encoder.encode(SHARD_NOTE_SKOS.map((t) => JSON.stringify(t)).join('\n')))
  files.set('provenance_edges.jsonl', encoder.encode(SHARD_PROVENANCE.map((p) => JSON.stringify(p)).join('\n')))
  return packTarGz(files)
}

/** Minimal fake backend for selector tests — only capabilities matter. */
function fakeBackend(id: string, capabilities: BackendCapabilities): DataBackend {
  return {
    id,
    capabilities,
    listNotes: () => Promise.reject(new Error('unused')),
    getNote: () => Promise.reject(new Error('unused')),
    search: () => Promise.reject(new Error('unused')),
  }
}

const SHARD_CAPS: BackendCapabilities = {
  read: true,
  write: false,
  merge: false,
  multiUser: false,
  semantic: 'none',
  startupCost: 'instant',
}
const PGLITE_CAPS: BackendCapabilities = {
  read: true,
  write: true,
  merge: true,
  multiUser: false,
  semantic: 'ann-full',
  startupCost: 'index-build',
}
const REMOTE_CAPS: BackendCapabilities = {
  read: true,
  write: true,
  merge: true,
  multiUser: true,
  semantic: 'server',
  startupCost: 'network',
}

// ── selectBackend (pure negotiation) ───────────────────────────────────────

describe('selectBackend — capability negotiation (#191)', () => {
  it('returns a null backend when none are available', () => {
    const sel = selectBackend({ read: true }, [])
    expect(sel.backend).toBeNull()
    expect(sel.capabilities).toBeNull()
    expect(sel.candidates).toEqual([])
  })

  it('prefers the lightest backend when several fully satisfy', () => {
    const shard = fakeBackend('static-file', SHARD_CAPS)
    const pglite = fakeBackend('pglite', PGLITE_CAPS)
    // Both satisfy a read-only request; static-file is instant vs index-build.
    const sel = selectBackend({ read: true }, [pglite, shard])
    expect(sel.backend?.id).toBe('static-file')
    expect(sel.missing).toEqual([])
  })

  it('chooses the only backend that satisfies a write request', () => {
    const shard = fakeBackend('static-file', SHARD_CAPS)
    const pglite = fakeBackend('pglite', PGLITE_CAPS)
    const sel = selectBackend({ read: true, write: true }, [shard, pglite])
    expect(sel.backend?.id).toBe('pglite')
    expect(sel.missing).toEqual([])
    // The static-file candidate is reported as missing write.
    const shardCandidate = sel.candidates.find((c) => c.backend.id === 'static-file')
    expect(shardCandidate?.missing).toEqual(['write'])
  })

  it('treats a higher semantic tier as satisfying a lower request and prefers the lighter one', () => {
    const cosineShard = fakeBackend('static-file', { ...SHARD_CAPS, semantic: 'cosine-small' })
    const pglite = fakeBackend('pglite', PGLITE_CAPS) // ann-full
    const sel = selectBackend({ read: true, semantic: 'cosine-small' }, [pglite, cosineShard])
    // ann-full >= cosine-small, so both satisfy; instant beats index-build.
    expect(sel.backend?.id).toBe('static-file')
    expect(sel.missing).toEqual([])
  })

  it('flags the semantic gap when no backend meets the tier, returning fewest-missing', () => {
    const shard = fakeBackend('static-file', SHARD_CAPS) // semantic: none
    const sel = selectBackend({ read: true, semantic: 'ann-full' }, [shard])
    expect(sel.backend?.id).toBe('static-file')
    expect(sel.missing).toEqual(['semantic:ann-full'])
  })

  it('selects the remote backend for server-tier requests', () => {
    const shard = fakeBackend('static-file', SHARD_CAPS)
    const pglite = fakeBackend('pglite', PGLITE_CAPS)
    const remote = fakeBackend('remote-server', REMOTE_CAPS)
    const sel = selectBackend({ read: true, write: true, merge: true, multiUser: true, semantic: 'server' }, [
      shard,
      pglite,
      remote,
    ])
    expect(sel.backend?.id).toBe('remote-server')
    expect(sel.missing).toEqual([])
  })
})

// ── Static-file adapter (wraps openShard — no DB) ──────────────────────────

describe('createShardBackend — static-file adapter (#191)', () => {
  it('maps reader read operations to neutral records', async () => {
    const archive = packShard([
      note({ id: 'n1', title: 'Founder Breakfast', original_content: 'Notes from the founder breakfast.', tags: ['event', 'founders'], source: 'import', starred: true }),
      note({ id: 'n2', title: 'Menu', original_content: 'Pancakes and coffee.', tags: ['food'], source: 'manual' }),
      note({ id: 'n3', title: 'Founder bios', revised_content: 'Edited founder biographies.', original_content: 'Biographies of each founder.', tags: ['founders'], source: 'manual' }),
    ])
    const reader = await openShard(archive)
    const backend = createShardBackend(reader)

    expect(backend.id).toBe('static-file')
    expect(backend.capabilities.read).toBe(true)
    expect(backend.capabilities.write).toBe(false)
    expect(backend.capabilities.semantic).toBe('none')
    expect(backend.capabilities.startupCost).toBe('instant')

    const listed = await backend.listNotes()
    expect(listed.total).toBe(3)
    const n1 = listed.items.find((n) => n.id === 'n1')!
    expect(n1.title).toBe('Founder Breakfast')
    expect(n1.source).toBe('import')
    expect(n1.starred).toBe(true)
    expect(n1.tags).toEqual(['event', 'founders'])

    const got = await backend.getNote('n2')
    expect(got?.title).toBe('Menu')
    expect(await backend.getNote('missing')).toBeNull()

    const result = await backend.search('founder')
    expect(result.total).toBe(2) // n1 + n3
    expect(result.hits.every((h) => typeof h.rank === 'number')).toBe(true)
    expect(result.facets?.tags.founders).toBe(2)

    // Full content prefers revised over original.
    const full = await backend.getNoteFull!('n3')
    expect(full?.content).toBe('Edited founder biographies.')
    const fullOriginal = await backend.getNoteFull!('n1')
    expect(fullOriginal?.content).toBe('Notes from the founder breakfast.')
    expect(fullOriginal?.links?.map((l) => l.id)).toEqual(['link-1'])
    expect(fullOriginal?.concepts?.map((c) => c.prefLabel)).toEqual(['Founders'])
    expect(fullOriginal?.provenance?.map((p) => p.activity)).toEqual(['inducted'])

    const links = await backend.linksOf!('n1')
    expect(links[0]).toMatchObject({ id: 'link-1', fromNoteId: 'n1', toNoteId: 'n3', kind: 'related', score: 0.75 })
    const concepts = await backend.conceptsOf!('n1')
    expect(concepts[0]).toMatchObject({ id: 'concept-1', schemeId: 'scheme-1', prefLabel: 'Founders' })
    const provenance = await backend.provenanceOf!('n1')
    expect(provenance[0]).toMatchObject({
      id: 'prov-1',
      entityType: 'note',
      entityId: 'n1',
      attributes: { ref_id: 'REF-033', source: 'section9/research-papers' },
    })

    reader.close()
  })

  it('honours a declared semantic tier override', async () => {
    const reader = await openShard(packShard([note({ id: 'n1', original_content: 'x' })]))
    const backend = createShardBackend(reader, { id: 'cosine-shard', semantic: 'cosine-small' })
    expect(backend.id).toBe('cosine-shard')
    expect(backend.capabilities.semantic).toBe('cosine-small')
    reader.close()
  })
})

// ── PGlite adapter (wraps repositories/tools — real DB) ────────────────────

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

describe('createPGliteBackend — PGlite adapter (#191)', () => {
  it(
    'serves list/get/search and writes via manageNote',
    { timeout: 30_000 },
    async () => {
      const db = await setupDb()
      try {
        const repo = new NotesRepository(db)
        const alpha = await repo.create({ title: 'Alpha widgets', content: 'Alpha body about widgets', source: 'user' })
        const beta = await repo.create({ title: 'Beta gadgets', content: 'Beta body about gadgets', source: 'user' })
        await db.query(
          `INSERT INTO link (id, source_note_id, target_note_id, link_type, confidence, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          ['link-alpha-beta', alpha.id, beta.id, 'related', 0.8, '2026-01-02T00:00:00.000Z'],
        )
        await db.query(
          `INSERT INTO link_url_target (id, source_note_id, to_url, link_type, confidence, metadata_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            'link-alpha-url',
            alpha.id,
            'https://example.test/alpha',
            'reference',
            0.6,
            JSON.stringify({ label: 'Alpha URL' }),
            '2026-01-02T00:00:01.000Z',
          ],
        )
        await db.query(
          `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          ['scheme-backend', 'Backend concepts', null, '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z'],
        )
        await db.query(
          `INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            'concept-widget',
            'scheme-backend',
            'Widgets',
            JSON.stringify(['widgetry']),
            'Widget notes',
            '2026-01-05T00:00:00.000Z',
            '2026-01-06T00:00:00.000Z',
          ],
        )
        await db.query(
          `INSERT INTO note_skos_tag (id, note_id, concept_id, created_at)
           VALUES ($1, $2, $3, $4)`,
          ['note-concept-alpha', alpha.id, 'concept-widget', '2026-01-07T00:00:00.000Z'],
        )
        await db.query(
          `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'prov-alpha',
            'note',
            alpha.id,
            'inducted',
            'research-corpus',
            '2026-01-25T02:36:43-05:00',
            null,
            JSON.stringify({ ref_id: 'REF-062', source: 'section9/research-papers' }),
          ],
        )
        const backend = createPGliteBackend(db)

        expect(backend.id).toBe('pglite')
        expect(backend.capabilities.read).toBe(true)
        expect(backend.capabilities.write).toBe(true)
        expect(backend.capabilities.merge).toBe(true)
        expect(backend.capabilities.semantic).toBe('none') // no embeddings
        expect(backend.capabilities.startupCost).toBe('index-build')

        const listed = await backend.listNotes()
        expect(listed.total).toBe(2)
        expect(listed.items.map((n) => n.title).sort()).toEqual(['Alpha widgets', 'Beta gadgets'])

        const got = await backend.getNote(alpha.id)
        expect(got?.title).toBe('Alpha widgets')
        expect(got?.source).toBe('user')
        expect(await backend.getNote('nope')).toBeNull()

        const result = await backend.search('widgets')
        expect(result.total).toBeGreaterThanOrEqual(1)
        expect(result.hits.some((h) => h.note.id === alpha.id)).toBe(true)
        expect(result.hits[0]?.rank).toBeTypeOf('number')

        // Write op exists and round-trips through the current revision.
        expect(typeof backend.manageNote).toBe('function')
        await backend.manageNote!({ action: 'update', note_id: alpha.id, content: 'Refined alpha content' })
        const full = await backend.getNoteFull!(alpha.id)
        expect(full?.content).toBe('Refined alpha content')
        expect(full?.links?.map((l) => l.id)).toEqual(['link-alpha-beta', 'link-alpha-url'])
        expect(full?.concepts?.map((c) => c.prefLabel)).toEqual(['Widgets'])
        expect(full?.provenance?.map((p) => p.activity)).toEqual(['inducted'])

        const links = await backend.linksOf!(alpha.id)
        expect(links[0]).toMatchObject({ id: 'link-alpha-beta', fromNoteId: alpha.id, toNoteId: beta.id, kind: 'related', score: 0.8 })
        expect(links[1]).toMatchObject({
          id: 'link-alpha-url',
          fromNoteId: alpha.id,
          toNoteId: null,
          toUrl: 'https://example.test/alpha',
          kind: 'reference',
          score: 0.6,
          metadata: { label: 'Alpha URL' },
        })
        const concepts = await backend.conceptsOf!(alpha.id)
        expect(concepts[0]).toMatchObject({ id: 'concept-widget', schemeId: 'scheme-backend', prefLabel: 'Widgets', altLabels: ['widgetry'] })
        const provenance = await backend.provenanceOf!(alpha.id)
        expect(provenance[0]).toMatchObject({
          id: 'prov-alpha',
          entityType: 'note',
          entityId: alpha.id,
          attributes: { ref_id: 'REF-062', source: 'section9/research-papers' },
        })
      } finally {
        await db.close()
      }
    },
  )
})

// ── Remote server adapter (HTTP proxy — #197) ───────────────────────────────

describe('createRemoteBackend — server-tier HTTP adapter (#197)', () => {
  it('maps HTTP responses to DataBackend operations', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const href = String(url)
      calls.push({ url: href, init })
      const parsed = new URL(href)
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

      if (parsed.pathname === '/api/v1/notes' && parsed.searchParams.get('limit') === '10') {
        return json({
          items: [
            {
              id: 'remote-1',
              title: 'Remote note',
              tags: ['remote'],
              created_at: '2026-01-25T02:36:43-05:00',
              updated_at: '2026-05-23T18:31:05-04:00',
              source: 'server',
              is_starred: true,
              is_archived: false,
            },
          ],
          total: 1,
        })
      }
      if (parsed.pathname === '/api/v1/notes/remote-1' && parsed.searchParams.get('full') === 'true') {
        return json({
          id: 'remote-1',
          title: 'Remote note',
          tags: ['remote'],
          created_at: '2026-01-25T02:36:43-05:00',
          updated_at: '2026-05-23T18:31:05-04:00',
          source: 'server',
          content: 'Remote content',
        })
      }
      if (parsed.pathname === '/api/v1/notes/remote-1') {
        return json({
          id: 'remote-1',
          title: 'Remote note',
          tags: ['remote'],
          created_at: '2026-01-25T02:36:43-05:00',
          updated_at: '2026-05-23T18:31:05-04:00',
          source: 'server',
        })
      }
      if (parsed.pathname === '/api/v1/search') {
        return json({
          results: [
            {
              id: 'remote-1',
              title: 'Remote note',
              tags: ['remote'],
              created_at: '2026-01-25T02:36:43-05:00',
              updated_at: '2026-05-23T18:31:05-04:00',
              rank: 1.5,
              snippet: 'Remote',
            },
          ],
          total: 1,
        })
      }
      if (parsed.pathname === '/api/v1/notes/remote-1/links') {
        return json([
          {
            id: 'remote-link',
            from_note_id: 'remote-1',
            to_note_id: 'remote-2',
            kind: 'related',
            score: 0.9,
            created_at: '2026-05-23T18:31:05-04:00',
          },
        ])
      }
      if (parsed.pathname === '/api/v1/notes/remote-1/concepts') {
        return json([
          {
            id: 'remote-concept',
            scheme_id: 'remote-scheme',
            pref_label: 'Remote SKOS',
            alt_labels: ['server taxonomy'],
            definition: null,
            created_at: '2026-01-25T03:11:13-05:00',
            updated_at: '2026-05-23T18:31:05-04:00',
          },
        ])
      }
      if (parsed.pathname === '/api/v1/notes/remote-1/provenance') {
        return json([
          {
            id: 'remote-prov',
            entity_type: 'note',
            entity_id: 'remote-1',
            activity: 'inducted',
            agent: 'research-corpus',
            started_at: '2026-01-25T02:36:43-05:00',
            ended_at: null,
            attributes: { ref_id: 'REF-062', source: 'section9/research-papers' },
          },
        ])
      }
      if (parsed.pathname === '/api/v1/semantic/search') {
        return json({ hits: [{ note: { id: 'remote-1', title: 'Remote note', tags: [], createdAt: '', updatedAt: '' }, rank: 2 }] })
      }
      if (parsed.pathname === '/api/v1/tools/manage-note' && init?.method === 'POST') {
        return json({ action: 'update', note_id: 'remote-1' })
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as typeof fetch

    const backend = createRemoteBackend({
      baseUrl: 'https://fortemi.example',
      fetchImpl,
      authToken: 'test-token',
    })

    expect(backend.capabilities).toMatchObject({
      read: true,
      write: true,
      merge: true,
      multiUser: true,
      semantic: 'server',
      startupCost: 'network',
    })

    const listed = await backend.listNotes({ limit: 10 })
    expect(listed.items[0]).toMatchObject({ id: 'remote-1', title: 'Remote note', starred: true })

    const got = await backend.getNote('remote-1')
    expect(got?.source).toBe('server')

    const search = await backend.search('Remote')
    expect(search.hits[0]).toMatchObject({ rank: 1.5, snippet: 'Remote' })

    const full = await backend.getNoteFull!('remote-1')
    expect(full?.content).toBe('Remote content')
    expect(full?.links?.[0]).toMatchObject({ id: 'remote-link', fromNoteId: 'remote-1' })
    expect(full?.concepts?.[0]).toMatchObject({ id: 'remote-concept', prefLabel: 'Remote SKOS' })
    expect(full?.provenance?.[0]).toMatchObject({
      id: 'remote-prov',
      attributes: { ref_id: 'REF-062', source: 'section9/research-papers' },
    })

    await expect(backend.semantic!('Remote', 1)).resolves.toHaveLength(1)
    await expect(backend.manageNote!({ action: 'update', note_id: 'remote-1' })).resolves.toMatchObject({
      action: 'update',
      note_id: 'remote-1',
    })
    expect(calls.some((call) => new Headers(call.init?.headers).get('Authorization') === 'Bearer test-token')).toBe(true)
  })
})
