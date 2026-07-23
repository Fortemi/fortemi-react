import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/presence-semantics-v2.0.json' with { type: 'json' }
import fieldSemantics from '../../../schemas/knowledge-shard/2.0.0/field-semantics.json' with { type: 'json' }
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import {
  assertStoredPresence,
  capturePresence,
  classifyOwnProperty,
  presenceLosses,
  presencePointers,
} from '../../shard/presence.js'
import { readStoredPresence, replaceStoredPresence } from '../../shard/presence-store.js'
import { validateShardComponentRecord, validateShardManifest } from '../../shard/schema-validator.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { sha256Hex } from '../../shard/checksum.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { NotesRepository } from '../../repositories/notes-repository.js'

type JsonObject = Record<string, unknown>

const templateId = 'b3f4f33a-e3d7-4bb6-9bad-47abb6eeaac8'

async function templateArchive(description: string | null): Promise<Uint8Array> {
  const template = {
    id: templateId,
    name: 'Presence template',
    description,
    content: '# Template',
    format: 'markdown',
    default_tags: [],
    collection_id: null,
    created_at: '2026-07-22T20:00:00Z',
    updated_at: '2026-07-22T20:00:00Z',
  }
  const templatesBytes = new TextEncoder().encode(JSON.stringify([template]))
  const manifest = {
    ...structuredClone(fixtures.prototypes['core-manifest']),
    components: ['templates'],
    counts: {
      ...fixtures.prototypes['core-manifest'].counts,
      templates: 1,
    },
    checksums: { 'templates.json': await sha256Hex(templatesBytes) },
  }
  return packTarGz(new Map([
    ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['templates.json', templatesBytes],
  ]))
}

function parentAndKey(document: JsonObject, pointer: string): [JsonObject, string] {
  const parts = pointer.slice(1).split('/')
  let parent = document
  for (const part of parts.slice(0, -1)) parent = parent[part] as JsonObject
  return [parent, parts.at(-1)!]
}

describe('Knowledge Shard 2.0 presence semantics (#379)', () => {
  it('preserves own-property state through JSON serialization for canonical vectors', () => {
    for (const testCase of fixtures.cases) {
      const document = structuredClone(
        fixtures.prototypes[testCase.prototype as keyof typeof fixtures.prototypes],
      ) as JsonObject
      const [parent, key] = parentAndKey(document, testCase.pointer)
      if (testCase.operation === 'delete') delete parent[key]
      else parent[key] = structuredClone('value' in testCase ? testCase.value : undefined)

      expect(classifyOwnProperty(document, testCase.pointer), testCase.id).toBe(testCase.state)
      const roundTrip = JSON.parse(JSON.stringify(document)) as JsonObject
      expect(classifyOwnProperty(roundTrip, testCase.pointer), testCase.id).toBe(testCase.state)
      expect(roundTrip, testCase.id).toEqual(document)

      const validation = testCase.prototype === 'core-manifest'
        ? validateShardManifest(document)
        : validateShardComponentRecord(
            testCase.prototype === 'core-note' ? 'notes' : 'embeddings',
            document,
            testCase.prototype === 'core-note' ? 'core-v1' : 'full-v1',
            '2.0.0',
          )
      expect(validation.valid, `${testCase.id}: ${validation.errors.join('; ')}`)
        .toBe(testCase.valid)
      const losses = presenceLosses(
        testCase.prototype === 'full-embedding' ? 'full-v1' : 'core-v1',
        testCase.prototype === 'core-manifest' ? 'manifest'
          : testCase.prototype === 'core-note' ? 'notes' : 'embeddings',
        document,
        String(document.id ?? testCase.id),
      )
      expect(losses.length === 0, testCase.id).toBe(testCase.valid)
    }
  })

  it('loads every authority field into the profile/component presence inventory', () => {
    expect(fieldSemantics.fields).toHaveLength(220)
    for (const field of fieldSemantics.fields) {
      if (field.pointer.includes('/*')) continue
      expect(
        presencePointers(
          field.profile as 'core-v1' | 'record-v1' | 'full-v1',
          field.component as Parameters<typeof presencePointers>[1],
        ),
        `${field.profile}/${field.component}${field.pointer}`,
      ).toContain(field.pointer)
    }
  })

  it('validates schema-2.0 core records without changing schema-1.x behavior', () => {
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    expect(validateShardComponentRecord('notes', note, 'core-v1', '2.0.0')).toEqual({
      valid: true,
      errors: [],
    })
    note.deleted_at = ''
    expect(validateShardComponentRecord('notes', note, 'core-v1', '2.0.0').valid).toBe(false)
    expect(validateShardManifest(fixtures.prototypes['core-manifest']).valid).toBe(true)
  })

  it('uses the authority inventory and returns field-specific machine losses', () => {
    expect(presencePointers('core-v1', 'notes')).toContain('/deleted_at')
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    note.deleted_at = ''
    expect(presenceLosses('core-v1', 'notes', note, String(note.id))).toEqual([
      expect.objectContaining({
        code: 'unsupported-presence-state',
        component: 'notes',
        record_id: note.id,
        field_path: '/deleted_at',
        source_state: 'empty',
        action: 'reject',
      }),
    ])
  })

  it('rejects incoherent storage metadata', () => {
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    note.deleted_at = null
    expect(() => assertStoredPresence(note, { '/deleted_at': 'absent' })).toThrow(
      'stored=absent, actual=null',
    )
  })

  it('returns unsupported wire states as machine-readable import losses', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    note.deleted_at = ''
    const notesBytes = new TextEncoder().encode(JSON.stringify(note))
    const manifest = {
      ...structuredClone(fixtures.prototypes['core-manifest']),
      counts: { ...fixtures.prototypes['core-manifest'].counts, notes: 1 },
      checksums: { 'notes.jsonl': await sha256Hex(notesBytes) },
    }
    const archive = packTarGz(new Map([
      ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
      ['notes.jsonl', notesBytes],
    ]))

    const result = await importShard(db, archive, { conflictStrategy: 'replace' })
    expect(result.success).toBe(false)
    expect(result.capability_report.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported-presence-state', component: 'notes',
        record_id: note.id, field_path: '/deleted_at', source_state: 'empty', action: 'reject',
      }),
    ]))
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
    await db.close()
  })

  it('persists presence states transactionally in PGlite', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    const pointers = presencePointers('core-v1', 'notes')
    const presence = capturePresence(note, pointers)

    await db.transaction(async (tx) => {
      await replaceStoredPresence(tx, '2.0.0', 'core-v1', 'notes', String(note.id), presence)
    })
    expect(await readStoredPresence(db, '2.0.0', 'core-v1', 'notes', String(note.id))).toEqual(
      presence,
    )
    await db.close()
  })

  it('imports and re-exports an absent field without normalizing it to null', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    const notesBytes = new TextEncoder().encode(JSON.stringify(note))
    const manifest = {
      ...structuredClone(fixtures.prototypes['core-manifest']),
      counts: {
        ...fixtures.prototypes['core-manifest'].counts,
        notes: 1,
      },
      checksums: { 'notes.jsonl': await sha256Hex(notesBytes) },
    }
    const archive = packTarGz(new Map([
      ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
      ['notes.jsonl', notesBytes],
    ]))

    const imported = await importShard(db, archive, { conflictStrategy: 'replace' })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    expect(await readStoredPresence(db, '2.0.0', 'core-v1', 'notes', String(note.id))).toMatchObject({
      '/deleted_at': 'absent',
    })

    const exported = await exportShardWithReport(db, {
      profile: 'core-v1',
      schemaVersion: '2.0.0',
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    const files = unpackTarGz(exported.archive!)
    const exportedNote = JSON.parse(new TextDecoder().decode(files.get('notes.jsonl'))) as JsonObject
    expect(Object.hasOwn(exportedNote, 'deleted_at')).toBe(false)
    expect(classifyOwnProperty(exportedNote, '/deleted_at')).toBe('absent')

    const notes = new NotesRepository(db)
    await notes.delete(String(note.id))
    const deleted = await exportShardWithReport(db, {
      profile: 'core-v1', schemaVersion: '2.0.0',
    })
    const deletedNote = JSON.parse(new TextDecoder().decode(
      unpackTarGz(deleted.archive!).get('notes.jsonl'),
    )) as JsonObject
    expect(typeof deletedNote.deleted_at).toBe('string')

    await notes.restore(String(note.id))
    const restored = await exportShardWithReport(db, {
      profile: 'core-v1', schemaVersion: '2.0.0',
    })
    const restoredNote = JSON.parse(new TextDecoder().decode(
      unpackTarGz(restored.archive!).get('notes.jsonl'),
    )) as JsonObject
    expect(restoredNote.deleted_at).toBeNull()

    await notes.update(String(note.id), { title: '' })
    const retitled = await exportShardWithReport(db, {
      profile: 'core-v1', schemaVersion: '2.0.0',
    })
    const retitledNote = JSON.parse(new TextDecoder().decode(
      unpackTarGz(retitled.archive!).get('notes.jsonl'),
    )) as JsonObject
    expect(retitledNote.title).toBe('')
    await db.close()
  })

  it('does not replace presence metadata when conflictStrategy skips a template', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)

    const initial = await importShard(db, await templateArchive(null), {
      conflictStrategy: 'replace',
    })
    expect(initial.success, initial.errors.join('; ')).toBe(true)
    expect(await readStoredPresence(db, '2.0.0', 'core-v1', 'templates', templateId))
      .toMatchObject({ '/description': 'null' })

    const skipped = await importShard(db, await templateArchive('incoming replacement'), {
      conflictStrategy: 'skip',
    })
    expect(skipped.success, skipped.errors.join('; ')).toBe(true)
    expect(skipped.skipped.templates).toBe(1)
    expect((await db.query<{ description: string | null }>(
      'SELECT description FROM template WHERE id = $1', [templateId],
    )).rows[0].description).toBeNull()
    expect(await readStoredPresence(db, '2.0.0', 'core-v1', 'templates', templateId))
      .toMatchObject({ '/description': 'null' })
    await db.close()
  })

  it('rejects schema-2.0 export of legacy PGlite rows with indeterminate presence', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    await new NotesRepository(db).create({ content: 'legacy row', title: 'Legacy' })

    const exported = await exportShardWithReport(db, {
      profile: 'core-v1', schemaVersion: '2.0.0',
    })
    expect(exported.success).toBe(false)
    expect(exported.errors.join('\n')).toContain(
      'Cannot emit schema 2.0 with legacy-indeterminate state',
    )
    await db.close()
  })
})
