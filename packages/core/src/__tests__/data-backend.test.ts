import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../migration-runner.js'
import { allMigrations } from '../migrations/index.js'
import { NotesRepository } from '../repositories/notes-repository.js'
import { openShard } from '../shard/shard-reader.js'
import { packTarGz } from '../shard/shard-tar.js'
import { CURRENT_SHARD_VERSION, SHARD_FORMAT } from '../shard/types.js'
import type { ShardManifest, ShardNote } from '../shard/types.js'
import {
  selectBackend,
  createPGliteBackend,
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

function packShard(notes: ShardNote[]): Uint8Array {
  const manifest: ShardManifest = {
    version: CURRENT_SHARD_VERSION,
    matric_version: '1.0.0',
    format: SHARD_FORMAT,
    created_at: '2026-01-01T00:00:00.000Z',
    components: ['notes'],
    counts: { notes: notes.length },
    checksums: {},
    min_reader_version: '1.0.0',
  }
  const files = new Map<string, Uint8Array>()
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  files.set('notes.jsonl', encoder.encode(notes.map((n) => JSON.stringify(n)).join('\n')))
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
        await repo.create({ title: 'Beta gadgets', content: 'Beta body about gadgets', source: 'user' })
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
      } finally {
        await db.close()
      }
    },
  )
})
