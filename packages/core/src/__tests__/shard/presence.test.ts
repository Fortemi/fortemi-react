import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/presence-semantics-v2.0.json' with { type: 'json' }
import fieldSemantics from '../../../schemas/knowledge-shard/2.0.0/field-semantics.json' with { type: 'json' }
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import {
  assertStoredPresence,
  capturePresence,
  classifyOwnProperty,
  concretePresencePointers,
  presenceLosses,
  presencePointers,
  restoreStoredPresence,
} from '../../shard/presence.js'
import { readStoredPresence, replaceStoredPresence } from '../../shard/presence-store.js'
import { validateShardComponentRecord, validateShardManifest } from '../../shard/schema-validator.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { sha256Hex } from '../../shard/checksum.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { MemoryRecordStore } from '../../records/memory-record-store.js'
import { createRecordStore } from '../../records/idb-record-store.js'
import type { NoteRecord0, RecordStore } from '../../records/types.js'

type JsonObject = Record<string, unknown>
type AuthorityField = (typeof fieldSemantics.fields)[number]

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

function concretePointer(pointer: string): string {
  return pointer.replace('/*/', '/0/')
}

function documentFor(pointer: string, value: unknown, present: boolean): JsonObject {
  const parts = concretePointer(pointer).slice(1).split('/')
  const document: JsonObject = {}
  let current: JsonObject | unknown[] = document
  for (const [index, part] of parts.slice(0, -1).entries()) {
    const nextIsIndex = /^\d+$/.test(parts[index + 1])
    if (Array.isArray(current)) {
      const itemIndex = Number(part)
      current[itemIndex] ??= nextIsIndex ? [] : {}
      current = current[itemIndex] as JsonObject | unknown[]
    } else {
      current[part] ??= nextIsIndex ? [] : {}
      current = current[part] as JsonObject | unknown[]
    }
  }
  const key = parts.at(-1)!
  if (present) {
    if (Array.isArray(current)) current[Number(key)] = structuredClone(value)
    else current[key] = structuredClone(value)
  }
  return document
}

function representativeValue(field: AuthorityField): unknown {
  const types = field.types as string[]
  if (types.includes('string')) return 'authority-value'
  if (types.includes('integer')) return 7
  if (types.includes('number')) return 0.75
  if (types.includes('boolean')) return true
  if (types.includes('array')) return ['authority-value']
  return { authority: 'value' }
}

const stateVectors = (field: AuthorityField) => [
  { label: 'absent', present: false, value: undefined, supported: field.states.absent === 'preserve' },
  { label: 'null', present: true, value: null, supported: field.states.null === 'preserve' },
  { label: 'empty-string', present: true, value: '', supported: field.states.empty.includes('empty-string') },
  { label: 'empty-array', present: true, value: [], supported: field.states.empty.includes('empty-array') },
  { label: 'empty-object', present: true, value: {}, supported: field.states.empty.includes('empty-object') },
  { label: 'value', present: true, value: representativeValue(field), supported: field.states.value === 'preserve' },
] as const

function authorityLabel(field: AuthorityField, state: string): string {
  return `${field.profile}/${field.component}${field.pointer}:${state}`
}

async function verifyRecordStoreRoundTrips(
  label: string,
  store: RecordStore,
): Promise<void> {
  let ordinal = 0
  for (const field of fieldSemantics.fields) {
    for (const state of stateVectors(field).filter((entry) => entry.supported)) {
      const document = documentFor(field.pointer, state.value, state.present)
      const id = `${label}-${ordinal++}`
      const record = {
        id,
        payload: document,
      } as unknown as NoteRecord0
      await store.put('note', record)
      const restored = await store.get('note', id) as unknown as JsonObject
      const pointer = concretePointer(field.pointer)
      expect(
        classifyOwnProperty(restored.payload, pointer),
        authorityLabel(field, `${state.label}:${label}`),
      ).toBe(classifyOwnProperty(document, pointer))
      expect(restored, authorityLabel(field, `${state.label}:${label}:json`))
        .toEqual(record)
    }
  }
  await store.close()
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
      expect(
        presencePointers(
          field.profile as 'core-v1' | 'record-v1' | 'full-v1',
          field.component as Parameters<typeof presencePointers>[1],
        ),
        `${field.profile}/${field.component}${field.pointer}`,
      ).toContain(field.pointer)
    }
  })

  it('applies every authority state rule, including concrete wildcard members', () => {
    let assertions = 0
    for (const field of fieldSemantics.fields) {
      for (const state of stateVectors(field)) {
        const document = documentFor(field.pointer, state.value, state.present)
        const pointer = concretePointer(field.pointer)
        expect(
          concretePresencePointers(document, field.pointer),
          authorityLabel(field, `${state.label}:expansion`),
        ).toEqual([pointer])
        const losses = presenceLosses(
          field.profile as Parameters<typeof presenceLosses>[0],
          field.component as Parameters<typeof presenceLosses>[1],
          document,
          'authority-matrix',
        ).filter((loss) => loss.field_path === pointer)
        expect(
          losses.length === 0,
          authorityLabel(field, state.label),
        ).toBe(state.supported)
        if (!state.supported) {
          expect(losses, authorityLabel(field, `${state.label}:machine-loss`)).toEqual([
            expect.objectContaining({
              code: 'unsupported-presence-state',
              field_path: pointer,
              action: 'reject',
              reason: 'authority-field-semantics',
            }),
          ])
        }
        assertions += 1
      }
    }
    expect(assertions).toBe(1320)
  })

  it('round-trips every supported authority state through the PGlite presence store', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    let ordinal = 0
    for (const field of fieldSemantics.fields.filter((entry) => entry.component !== 'manifest')) {
      for (const state of stateVectors(field).filter((entry) => entry.supported)) {
        const document = documentFor(field.pointer, state.value, state.present)
        const pointers = concretePresencePointers(document, field.pointer)
        const presence = capturePresence(document, [field.pointer])
        const id = `authority-${ordinal++}`
        await replaceStoredPresence(
          db,
          '2.0.0',
          field.profile as Parameters<typeof replaceStoredPresence>[2],
          field.component as Parameters<typeof replaceStoredPresence>[3],
          id,
          presence,
        )
        const stored = await readStoredPresence(
          db,
          '2.0.0',
          field.profile as Parameters<typeof readStoredPresence>[2],
          field.component as Parameters<typeof readStoredPresence>[3],
          id,
          document,
        )
        for (const pointer of pointers) {
          expect(stored[pointer], authorityLabel(field, `${state.label}:pglite`))
            .toBe(presence[pointer])
        }
        expect(
          restoreStoredPresence(document, presence),
          authorityLabel(field, `${state.label}:restore`),
        ).toEqual(document)
      }
    }
    await db.close()
  }, 30_000)

  it('round-trips every supported authority state through MemoryRecordStore', async () => {
    await verifyRecordStoreRoundTrips('memory', new MemoryRecordStore())
  })

  it('round-trips every supported authority state through IndexedDB RecordStore', async () => {
    await verifyRecordStoreRoundTrips(
      'indexeddb',
      await createRecordStore('presence-authority-matrix', { indexedDB: new IDBFactory() }),
    )
  })

  it('captures and restores every attachment member independently', () => {
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    note.attachments = [
      { extracted_text: null, reason: 'first' },
      { extracted_text: '', reason: null },
    ]
    const presence = capturePresence(note, presencePointers('core-v1', 'notes'))
    expect(presence).toMatchObject({
      '/attachments/0/extracted_text': 'null',
      '/attachments/0/reason': 'value',
      '/attachments/1/extracted_text': 'empty',
      '/attachments/1/reason': 'null',
    })
    expect(presence).not.toHaveProperty('/attachments/*/extracted_text')
    expect(restoreStoredPresence(note, presence)).toEqual(note)
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

  it('preserves concrete attachment extraction values through PGlite re-export', async () => {
    const db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    const note = structuredClone(fixtures.prototypes['core-note']) as JsonObject
    note.attachments = [{
      extracted_text: '',
      extraction_status: 'failed',
      reason: 'extractor_failed',
      attachment: {
        id: '018f2d2d-bc00-7cc8-8ad2-f147d6a2e77c',
        path: 'presence.txt',
        mime: 'text/plain',
        checksum: 'blake3:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        bytes: 7,
      },
    }]
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

    const imported = await importShard(db, archive, { conflictStrategy: 'replace' })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    const stored = await readStoredPresence(
      db,
      '2.0.0',
      'core-v1',
      'notes',
      String(note.id),
      note,
    )
    expect(stored).toMatchObject({
      '/attachments/0/extracted_text': 'empty',
      '/attachments/0/reason': 'value',
    })

    const exported = await exportShardWithReport(db, {
      profile: 'core-v1',
      schemaVersion: '2.0.0',
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    const returnedNote = JSON.parse(new TextDecoder().decode(
      unpackTarGz(exported.archive!).get('notes.jsonl'),
    )) as { attachments: Array<Record<string, unknown>> }
    expect(returnedNote.attachments[0]).toMatchObject({
      extracted_text: '',
      extraction_status: 'failed',
      reason: 'extractor_failed',
    })
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
