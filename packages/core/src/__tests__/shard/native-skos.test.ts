import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { SkosRepository } from '../../repositories/skos-repository.js'
import { applyValidatedNativeSkos, readNativeSkos, readNativeSkosComponent, type NativeSkos } from '../../shard/native-skos.js'
import { validateFullV1ShardArchive, validateShardComponentRecord } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
function records<T>(component: string): T[] {
  const json = files.get(`${component}.json`)
  const text = new TextDecoder().decode(json ?? files.get(`${component}.jsonl`))
  return json ? JSON.parse(text) as T[] : text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}
const source: NativeSkos = {
  skos_schemes: records('skos_schemes'), skos_concepts: records('skos_concepts'), skos_labels: records('skos_labels'),
  skos_notes: records('skos_notes'), skos_relations: records('skos_relations'), skos_mapping_relations: records('skos_mapping_relations'),
  skos_scheme_memberships: records('skos_scheme_memberships'), note_skos_tags: records('note_skos_tags'),
  skos_collections: records('skos_collections'), skos_collection_members: records('skos_collection_members'),
}
const normalize = (state: NativeSkos): NativeSkos => Object.fromEntries(Object.entries(state).map(([key, rows]) => [key,
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
])) as unknown as NativeSkos
const newId = (n: number): string => `018f4c11-9f14-7d33-8a21-1c80f649${n.toString().padStart(4, '0')}`
const timestamp = '2026-07-18T10:30:00.123456789Z'

describe('native SKOS stage, not public full-v1 restoration', () => {
  let db: PGlite
  let repo: SkosRepository
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    repo = new SkosRepository(db)
    for (const row of records<{ id: string }>('notes')) await db.query('INSERT INTO note (id, title) VALUES ($1, $1)', [row.id])
  })
  afterEach(async () => { await db.close() })
  async function apply(state = source): Promise<void> {
    for (const component of Object.keys(state) as (keyof NativeSkos)[]) for (const row of state[component]) {
      expect(validateShardComponentRecord(component, row, 'full-v1', '2.0.0').errors).toEqual([])
    }
    await db.transaction((tx) => applyValidatedNativeSkos(tx, state))
  }
  async function expectState(state: NativeSkos): Promise<void> {
    const actual = await readNativeSkos(db)
    // Property order is not part of the wire contract; component row order is not an identity.
    for (const component of Object.keys(state) as (keyof NativeSkos)[]) {
      expect(actual[component]).toHaveLength(state[component].length)
      expect(actual[component]).toEqual(expect.arrayContaining<unknown>(state[component]))
    }
  }

  it('restores all ten source components into native repositories without archival records or jobs', async () => {
    await apply()
    await expectState(source)
    const concept = source.skos_notes[0].concept_id
    expect(await repo.getSchemeRecord(source.skos_schemes[0].id)).toEqual(source.skos_schemes[0])
    expect(await repo.getConceptRecord(concept)).toEqual(source.skos_concepts.find((row) => row.id === concept))
    expect(await repo.getLabels(concept)).toEqual(source.skos_labels.filter((row) => row.concept_id === concept))
    expect(await repo.getNotes(concept)).toEqual(source.skos_notes)
    expect(await repo.getMappings(concept)).toEqual(source.skos_mapping_relations)
    expect(await repo.getSchemeMemberships(concept)).toEqual(source.skos_scheme_memberships.filter((row) => row.concept_id === concept))
    expect(await repo.getAssignments(source.note_skos_tags[0].note_id)).toEqual(source.note_skos_tags)
    expect(await repo.listCollections(source.skos_schemes[0].id)).toEqual(source.skos_collections)
    expect(await repo.getCollectionMembers(source.skos_collections[0].id)).toEqual(source.skos_collection_members)
    expect(await repo.getRelations(concept)).toEqual([expect.objectContaining({
      id: source.skos_relations[0].id, inference_score: source.skos_relations[0].inference_score,
      source_concept_id: source.skos_relations[0].subject_id, is_validated: true,
    })])
    expect(await repo.conceptsForNote(source.note_skos_tags[0].note_id)).toEqual([expect.objectContaining({
      id: source.note_skos_tags[0].concept_id, definition: source.skos_notes[0].value,
    })])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
  })

  it('retains rich metadata, nullable fields, false, zero, empty arrays and source precision', async () => {
    const state = structuredClone(source)
    Object.assign(state.skos_schemes[0], { creator: '', publisher: '', rights: '', version: '', is_active: false, is_system: false,
      issued_at: timestamp, modified_at: timestamp, embedding: Array(768).fill(Math.PI), embedding_model: 'native', embedded_at: timestamp })
    Object.assign(state.skos_concepts[0], { antipatterns: [], promoted_at: timestamp, deprecated_at: timestamp, note_count: 0,
      first_used_at: timestamp, last_used_at: timestamp, antipattern_checked_at: timestamp, facet_source: '', facet_scope: '',
      facet_domain: '', deprecation_reason: '', embedding: Array(768).fill(Math.PI), embedding_model: 'native', embedded_at: timestamp })
    Object.assign(state.skos_mapping_relations[0], { confidence: 0, is_validated: false, target_label: '', validated_by: '', validated_at: timestamp })
    Object.assign(state.skos_relations[0], { inference_score: -2, is_inferred: false, is_validated: false, created_by: '' })
    Object.assign(state.note_skos_tags[0], { confidence: 0, relevance_score: 0, is_primary: false, created_by: '' })
    Object.assign(state.skos_notes[0], { author: '', source: '' })
    for (const rows of Object.values(state)) for (const row of rows) {
      if ('created_at' in row) row.created_at = timestamp
      if ('updated_at' in row) row.updated_at = timestamp
      if ('added_at' in row) row.added_at = timestamp
    }
    await apply(state)
    await expectState(state)
    await db.query("UPDATE skos_scheme SET embedding = $1::vector, updated_at = updated_at + interval '1 second'", [JSON.stringify(Array(768).fill(0.5))])
    const current = await repo.getSchemeRecord(state.skos_schemes[0].id)
    expect(current!.embedding).toEqual(Array(768).fill(0.5))
    expect(current!.updated_at).toMatch(/^2026-07-18T10:30:01\./)
    await db.query('UPDATE skos_concept SET embedding = NULL, embedded_at = NULL WHERE id = $1', [state.skos_concepts[0].id])
    expect(await repo.getConceptRecord(state.skos_concepts[0].id)).toMatchObject({ embedding: null, embedded_at: null })
  })

  it('preserves multilingual identities and refreshes projections after edits, moves and deletion', async () => {
    const state = structuredClone(source)
    const owner = state.skos_notes[0].concept_id
    const peer = state.skos_concepts.find((row) => row.id !== owner)!.id
    state.skos_labels.push({ ...state.skos_labels[0], id: newId(1), concept_id: owner, language: 'fr', value: 'Francais' },
      { ...state.skos_labels[0], id: newId(2), concept_id: owner, label_type: 'hidden_label', value: 'Hidden' },
      { ...state.skos_labels[0], id: newId(3), concept_id: owner, label_type: 'alt_label', value: 'Alias' })
    state.skos_notes.push({ ...state.skos_notes[0], id: newId(4), language: 'fr', value: 'Definition francaise' })
    await apply(state)
    await expectState(state)
    await db.query('UPDATE skos_concept_note SET value = $1 WHERE id = $2', ['Changed definition', state.skos_notes[0].id])
    expect((await repo.listConcepts(state.skos_schemes[0].id)).find((row) => row.id === owner)!.definition).toBe('Changed definition')
    await db.query('UPDATE skos_concept_label SET concept_id = $1 WHERE id = $2', [peer, newId(3)])
    expect((await repo.listConcepts(state.skos_schemes[0].id)).find((row) => row.id === owner)!.alt_labels).toEqual([])
    expect((await repo.listConcepts(state.skos_schemes[0].id)).find((row) => row.id === peer)!.alt_labels).toEqual(['Alias'])
    await db.query('DELETE FROM skos_concept_note WHERE id = $1', [state.skos_notes[0].id])
    expect((await repo.listConcepts(state.skos_schemes[0].id)).find((row) => row.id === owner)!.definition).toBe('Definition francaise')
    expect((await readNativeSkos(db)).skos_labels.find((row) => row.id === newId(3))!.concept_id).toBe(peer)
  })

  it('does not invent undeclared labels, notes or memberships for imported concepts', async () => {
    const state = structuredClone(source)
    state.skos_labels = []; state.skos_notes = []; state.skos_scheme_memberships = []
    await apply(state)
    await expectState(state)
    expect((await repo.listConcepts(state.skos_schemes[0].id)).map((row) => row.pref_label).sort())
      .toEqual(state.skos_concepts.map((row) => row.notation ?? row.id).sort())
  })

  it('preserves the native tag ID on repeat while updating canonical composite metadata', async () => {
    await apply()
    const id = (await db.query<{ id: string }>('SELECT id FROM note_skos_tag')).rows[0].id
    const state = structuredClone(source)
    state.note_skos_tags[0].source = 'updated'
    await apply(state)
    await expectState(state)
    expect((await db.query('SELECT id FROM note_skos_tag')).rows).toEqual([{ id }])
    await repo.untagNote(state.note_skos_tags[0].note_id, state.note_skos_tags[0].concept_id)
    expect((await readNativeSkos(db)).note_skos_tags).toEqual([])
  })

  it('retains nullable collection schemes and positions with deterministic ordered membership', async () => {
    const state = structuredClone(source)
    state.skos_collections[0].scheme_id = null
    state.skos_collection_members[0].position = null
    const peer = state.skos_concepts.find((row) => row.id !== state.skos_collection_members[0].concept_id)!.id
    state.skos_collection_members.push({ ...state.skos_collection_members[0], concept_id: peer, position: 0 })
    await apply(state)
    await expectState(state)
    expect((await repo.getCollectionMembers(state.skos_collections[0].id)).map((row) => row.position)).toEqual([0, null])
    expect(await repo.listCollections()).toHaveLength(1)
    expect(await repo.listCollections(state.skos_schemes[0].id)).toEqual([])
  })

  it.each(['skos_scheme', 'skos_concept'])('rejects unrepresentable %s tombstones without archival fallback', async (table) => {
    await apply()
    await db.query(`UPDATE ${table} SET deleted_at = now()`)
    await expect(readNativeSkos(db)).rejects.toThrow('unrepresentable-live-tombstone')
  })

  it('rolls back all ten families and their display projections on a late failure', async () => {
    const before = await readNativeSkos(db)
    await expect(db.transaction(async (tx) => {
      await applyValidatedNativeSkos(tx, source)
      throw new Error('injected after SKOS apply')
    })).rejects.toThrow('injected after SKOS apply')
    expect(await readNativeSkos(db)).toEqual(before)
  })

  it('retains unrelated authored records and creates real labels, notes and memberships', async () => {
    const scheme = await repo.createScheme('Local')
    const concept = await repo.createConcept(scheme.id, 'Local concept', { altLabels: ['Alias'], definition: 'Local definition' })
    const before = await repo.getLabels(concept.id)
    await apply()
    expect(await repo.getLabels(concept.id)).toEqual(before)
    expect(before.map((row) => row.value).sort()).toEqual(['Alias', 'Local concept'])
    expect(await repo.getNotes(concept.id)).toEqual([expect.objectContaining({ note_type: 'definition', value: 'Local definition', language: 'en' })])
    expect(await repo.getSchemeMemberships(concept.id)).toEqual([expect.objectContaining({ scheme_id: scheme.id })])
    const current = await readNativeSkos(db)
    for (const component of Object.keys(current) as (keyof NativeSkos)[]) for (const row of current[component]) {
      expect(validateShardComponentRecord(component, row, 'full-v1', '2.0.0').errors).toEqual([])
    }
    expect(await repo.getSchemeRecord(scheme.id)).toMatchObject({ notation: scheme.id })
  })

  it('migrates legacy display text once without losing empty values or existing assignment IDs', async () => {
    const legacy = await PGlite.create({ extensions: { vector } })
    try {
      await legacy.exec('CREATE EXTENSION IF NOT EXISTS vector')
      const runner = new MigrationRunner(legacy)
      await runner.apply(allMigrations.filter((migration) => migration.version <= 26))
      await legacy.query('INSERT INTO skos_scheme (id, title) VALUES ($1, $2)', [newId(10), 'Legacy'])
      await legacy.query('INSERT INTO skos_concept (id, scheme_id, pref_label, alt_labels, definition) VALUES ($1, $2, $3, $4, $5)',
        [newId(11), newId(10), '', JSON.stringify(['Alias', '']), ''])
      await legacy.query('INSERT INTO note (id, title) VALUES ($1, $2)', [newId(12), 'Legacy note'])
      await legacy.query('INSERT INTO note_skos_tag (id, note_id, concept_id) VALUES ($1, $2, $3)', [newId(13), newId(12), newId(11)])
      await runner.apply(allMigrations)
      const upgraded = new SkosRepository(legacy)
      expect((await upgraded.getLabels(newId(11))).map((row) => row.value).sort()).toEqual(['', '', 'Alias'])
      expect((await upgraded.getNotes(newId(11)))[0].value).toBe('')
      for (const row of [...await upgraded.getLabels(newId(11)), ...await upgraded.getNotes(newId(11))]) {
        expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      }
      expect(await upgraded.getSchemeMemberships(newId(11))).toHaveLength(1)
      expect((await legacy.query('SELECT id FROM note_skos_tag')).rows).toEqual([{ id: newId(13) }])
      const state = await readNativeSkos(legacy)
      await runner.apply(allMigrations)
      expect(normalize(await readNativeSkos(legacy))).toEqual(normalize(state))
      expect(validateShardComponentRecord('skos_labels', (await upgraded.getLabels(newId(11))).find((row) => row.value === ''), 'full-v1', '2.0.0').valid).toBe(false)
    } finally { await legacy.close() }
  })

  it('normalizes UUID identities and rejects unknown filter identifiers', async () => {
    const state = structuredClone(source)
    for (const rows of Object.values(state)) for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if ((key === 'id' || key.endsWith('_id')) && typeof value === 'string') Object.assign(row, { [key]: value.toUpperCase() })
      }
    }
    await apply(state)
    await expectState(source)
    expect(await repo.getConceptRecord(source.skos_concepts[0].id.toUpperCase())).toEqual(source.skos_concepts[0])
    await expect(readNativeSkosComponent(db, 'skos_concepts', { 'id; DROP TABLE note': 'x' } as never)).rejects.toThrow('Unknown SKOS filter')
  })
})
