import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { sha256Hex } from '../../shard/checksum.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { validateCoreV1ShardArchive } from '../../shard/schema-validator.js'
import type { ShardManifest } from '../../shard/types.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const testDir = fileURLToPath(new URL('.', import.meta.url))
const fixturePath = resolve(testDir, 'fixtures/pglite-core-v1-2026.7.13.shard')
const legacyRoot = resolve(testDir, 'fixtures/canonical-core-v1-v1.0')
const COMPONENT_FILES = [
  'notes.jsonl',
  'collections.json',
  'tags.json',
  'templates.json',
  'links.jsonl',
] as const

async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

function fixtureBytes(): Uint8Array {
  return readFileSync(fixturePath)
}

function canonicalCurrentMinusTwoArchive(): Uint8Array {
  return packTarGz(new Map(
    ['manifest.json', ...COMPONENT_FILES].map((name) => [
      name,
      readFileSync(resolve(legacyRoot, name)),
    ]),
  ))
}

async function rowCounts(db: PGlite): Promise<Record<string, number>> {
  const result = await db.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*)::int FROM collection) AS collections,
      (SELECT COUNT(*)::int FROM note) AS notes,
      (SELECT COUNT(*)::int FROM note_tag) AS tags,
      (SELECT COUNT(*)::int FROM template) AS templates,
      (SELECT COUNT(*)::int FROM link) AS links
  `)
  return result.rows[0]
}

async function malformedRecordArchive(): Promise<Uint8Array> {
  const files = unpackTarGz(fixtureBytes())
  const notes = decoder.decode(files.get('notes.jsonl')!).trim().split('\n')
  const note = JSON.parse(notes[0]) as Record<string, unknown>
  note.id = 'not-a-uuid'
  notes[0] = JSON.stringify(note)
  const noteBytes = encoder.encode(`${notes.join('\n')}\n`)
  files.set('notes.jsonl', noteBytes)
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')!)) as ShardManifest
  manifest.checksums['notes.jsonl'] = await sha256Hex(noteBytes)
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  return packTarGz(files)
}

function nextMajorArchive(): Uint8Array {
  const files = unpackTarGz(fixtureBytes())
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')!)) as ShardManifest
  manifest.version = '3.0.0'
  manifest.min_reader_version = '3.0.0'
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)))
  return packTarGz(files)
}

function resourceLimitArchive(): Uint8Array {
  const archive = fixtureBytes().slice()
  const footer = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  footer.setUint32(archive.byteLength - 4, 256 * 1024 * 1024 + 1, true)
  return archive
}

function semanticRecords(
  files: Map<string, Uint8Array>,
  name: typeof COMPONENT_FILES[number],
): Array<Record<string, unknown>> {
  const text = decoder.decode(files.get(name)!).trim()
  const records = name.endsWith('.jsonl')
    ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : JSON.parse(text)
  return (records as Array<Record<string, unknown>>)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

describe('PGlite core-v1 canonical self-cell', { timeout: 30_000 }, () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('imports the current fixture twice and semantically re-exports every component', async () => {
    const source = fixtureBytes()
    const sourceFiles = unpackTarGz(source)
    expect(await validateCoreV1ShardArchive(sourceFiles)).toEqual({
      valid: true,
      errors: [],
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const imported = await importShard(db, source, { conflictStrategy: 'replace' })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
    }
    expect(await rowCounts(db)).toEqual({
      collections: 2,
      notes: 2,
      tags: 2,
      templates: 1,
      links: 1,
    })

    const semantic = await db.query<{
      parent_id: string
      deleted_at: string
      confidence: number | null
      active_metadata: unknown
      tombstone_metadata: unknown
    }>(`
      SELECT
        (SELECT parent_id::text FROM collection
          WHERE id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e702') AS parent_id,
        (SELECT to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          FROM note WHERE id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712') AS deleted_at,
        (SELECT confidence FROM link
          WHERE id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e751') AS confidence,
        (SELECT ai_metadata FROM note_revised_current
          WHERE note_id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e711') AS active_metadata,
        (SELECT ai_metadata FROM note_revised_current
          WHERE note_id = '018f2d2d-bc00-7cc8-8ad2-f147d6a2e712') AS tombstone_metadata
    `)
    expect(semantic.rows[0]).toEqual({
      parent_id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e701',
      deleted_at: '2026-07-26T14:14:00Z',
      confidence: null,
      active_metadata: {
        conformance: {
          producer: '@fortemi/core',
          profile: 'core-v1',
          version: '2026.7.13',
        },
      },
      tombstone_metadata: null,
    })

    const reexported = await exportShardWithReport(db, { profile: 'core-v1' })
    expect(reexported.success, reexported.errors.join('; ')).toBe(true)
    const reexportedFiles = unpackTarGz(reexported.archive!)
    expect(await validateCoreV1ShardArchive(reexportedFiles)).toEqual({
      valid: true,
      errors: [],
    })
    for (const name of COMPONENT_FILES) {
      expect(semanticRecords(reexportedFiles, name), name)
        .toEqual(semanticRecords(sourceFiles, name))
    }
    const sourceManifest = JSON.parse(decoder.decode(sourceFiles.get('manifest.json')!)) as ShardManifest
    const reexportedManifest = JSON.parse(
      decoder.decode(reexportedFiles.get('manifest.json')!),
    ) as ShardManifest
    expect(reexportedManifest.counts).toEqual(sourceManifest.counts)
  })

  it('accepts the current-minus-two core-v1 authority into a clean destination', async () => {
    const imported = await importShard(db, canonicalCurrentMinusTwoArchive(), {
      conflictStrategy: 'replace',
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    expect(imported.capability_report.requested_profile).toBe('core-v1')
    expect((await rowCounts(db)).notes).toBe(1)
  })

  it.each([
    ['malformed record', malformedRecordArchive, 'Canonical core-v1 validation failed'],
    ['next major', async () => nextMajorArchive(), 'unsupported canonical core-v1 schema version'],
    ['resource limit', async () => resourceLimitArchive(), 'exceeds cap'],
  ])('rejects %s before any PGlite mutation', async (_name, archive, expectedError) => {
    const result = await importShard(db, await archive(), { conflictStrategy: 'replace' })
    expect(result.success).toBe(false)
    expect(result.errors.join('\n')).toContain(expectedError)
    expect(await rowCounts(db)).toEqual({
      collections: 0,
      notes: 0,
      tags: 0,
      templates: 0,
      links: 0,
    })
  })
})
