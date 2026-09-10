import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPGliteBackend } from '../../data-backend.js'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { ProvenanceRepository } from '../../repositories/provenance-repository.js'
import { LifecyclePurgeRepository } from '../../repositories/lifecycle-purge-repository.js'
import { replaceValidatedNativeNoteHistory, type NativeHistoryNote } from '../../shard/native-note-history.js'
import { applyValidatedNativeProvenance, readNativeProvenance, readNativeProvenanceComponent, type NativeProvenance } from '../../shard/native-provenance.js'
import { encodeWgs84Geometry } from '../../shard/native-geometry.js'
import { validateFullV1ShardArchive, validateShardComponentRecord } from '../../shard/schema-validator.js'
import { unpackTarGz } from '../../shard/shard-tar.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
const records = <T>(component: string): T[] => new TextDecoder().decode(files.get(`${component}.jsonl`))
  .split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
const notes = records<NativeHistoryNote>('notes')
const source: NativeProvenance = {
  provenance_activities: records('provenance_activities'), provenance_edges: records('provenance_edges'),
  named_locations: records('named_locations'), provenance_locations: records('provenance_locations'),
  provenance_devices: records('provenance_devices'), provenance_records: records('provenance_records'),
}
const owner = source.provenance_activities[0].note_id
const timestamp = '2026-07-18T10:30:00.123456789Z'

describe('native provenance stage, not public full-v1 restoration', () => {
  let db: PGlite
  let repo: ProvenanceRepository
  beforeEach(async () => {
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    db = await PGlite.create({ extensions: { vector } })
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
    await new MigrationRunner(db).apply(allMigrations)
    repo = new ProvenanceRepository(db)
    for (const note of notes) await db.query('INSERT INTO note (id, title) VALUES ($1, $1)', [note.id])
    await db.transaction((tx) => replaceValidatedNativeNoteHistory(tx, notes, {
      note_originals: records('note_originals'), note_original_history: records('note_original_history'),
      note_revisions: records('note_revisions'), note_revised_current: records('note_revised_current'),
    }))
  })
  afterEach(async () => { await db.close() })
  async function apply(state = source): Promise<void> {
    for (const component of Object.keys(state) as (keyof NativeProvenance)[]) for (const row of state[component]) {
      expect(validateShardComponentRecord(component, row, 'full-v1', '2.0.0').errors).toEqual([])
    }
    await db.transaction((tx) => applyValidatedNativeProvenance(tx, state))
  }

  it('restores all six producer components and exposes real native repository and backend reads', async () => {
    await apply()
    expect(await readNativeProvenance(db)).toEqual(source)
    expect(await repo.getActivity(source.provenance_activities[0].id)).toEqual(source.provenance_activities[0])
    expect(await repo.activitiesForNote(owner)).toEqual(source.provenance_activities)
    expect(await repo.derivationsForRevision(source.provenance_edges[0].revision_id!)).toEqual(source.provenance_edges)
    expect(await repo.getNamedLocation(source.named_locations[0].id)).toEqual(source.named_locations[0])
    expect(await repo.getLocation(source.provenance_locations[0].id)).toEqual(source.provenance_locations[0])
    expect(await repo.getDevice(source.provenance_devices[0].id)).toEqual(source.provenance_devices[0])
    expect(await repo.getCapture(source.provenance_records[0].id)).toEqual(source.provenance_records[0])
    expect(await repo.captureForNote(owner)).toEqual(source.provenance_records[0])
    expect(await repo.forEntity('note', owner)).toEqual([expect.objectContaining({ id: source.provenance_activities[0].id })])
    expect(await createPGliteBackend(db).provenanceOf!(owner)).toEqual([expect.objectContaining({ id: source.provenance_activities[0].id })])
    expect((await db.query('SELECT point FROM provenance_location')).rows).toEqual([{ point: { type: 'Point', coordinates: [1, 2] } }])
    expect((await db.query("SELECT id FROM provenance_record WHERE capture_time && tstzrange('2026-07-18T13:10:00Z', '2026-07-18T13:20:00Z')")).rows).toEqual([{ id: source.provenance_records[0].id }])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    await apply()
    expect(await readNativeProvenance(db)).toEqual(source)
  })

  it('preserves every arbitrary JSON state without reparsing string values', async () => {
    for (const metadata of [null, false, 0, '', 'null', '{}', '{not-json', [], {}, ['source'], { nested: [null, false] }]) {
      const state = structuredClone(source)
      state.provenance_activities[0].metadata = metadata
      state.provenance_activities[0].model_name = null
      state.named_locations[0].metadata = metadata
      state.provenance_devices[0].sensor_metadata = metadata
      state.provenance_records[0].raw_metadata = metadata
      state.provenance_records[0].ai_context = metadata
      await apply(state)
      expect(await readNativeProvenance(db)).toEqual(state)
      expect((await repo.forEntity('note', owner))[0]).toMatchObject({ attributes: metadata, agent: null })
      expect((await createPGliteBackend(db).provenanceOf!(owner))[0]).toMatchObject({ attributes: metadata, agent: null })
    }
  })

  it('preserves exact timestamps and range bounds until native changes supersede them', async () => {
    const state = structuredClone(source)
    for (const rows of Object.values(state)) for (const row of rows) for (const key of ['created_at', 'created_at_utc', 'updated_at', 'started_at', 'ended_at', 'ai_processed_at']) {
      if (key in row) Object.assign(row, { [key]: timestamp })
    }
    state.provenance_records[0].capture_time = { ...source.provenance_records[0].capture_time!,
      lower: timestamp, upper: '2026-07-18T10:30:00.123456790Z', upper_inclusive: true }
    await apply(state)
    expect(await readNativeProvenance(db)).toEqual(state)
    await db.exec("UPDATE provenance_record SET capture_time = tstzrange('2026-08-01T01:00:00Z', NULL, '[)'), ai_processed_at = '2026-08-02T01:00:00Z'")
    const record = (await repo.captureForNote(owner))!
    expect(record.capture_time).toEqual({ empty: false, lower: '2026-08-01T01:00:00.000000Z', lower_inclusive: true,
      lower_infinite: false, upper: null, upper_inclusive: false, upper_infinite: true })
    expect(record.ai_processed_at).toBe('2026-08-02T01:00:00.000000Z')
    await db.exec("UPDATE provenance_record SET capture_time = 'empty', original_capture_time = NULL")
    expect((await repo.captureForNote(owner))!).toMatchObject({ capture_time: source.provenance_records[0].original_capture_time, original_capture_time: null })
  })

  it('preserves null and unbounded ranges and exact empty/null/false/zero fields', async () => {
    const state = structuredClone(source)
    Object.assign(state.provenance_activities[0], { revision_id: null, model_name: '', ended_at: null })
    Object.assign(state.provenance_edges[0], { revision_id: null, source_note_id: null, source_url: '' })
    Object.assign(state.named_locations[0], { point_ewkb_hex: null, boundary_ewkb_hex: null, is_private: false, radius_m: 0, altitude_m: 0 })
    Object.assign(state.provenance_locations[0], { horizontal_accuracy_m: 0, altitude_m: 0, vertical_accuracy_m: 0, heading_degrees: 0, speed_mps: 0 })
    Object.assign(state.provenance_devices[0], { has_gps: false, has_accelerometer: false, device_name: '' })
    Object.assign(state.provenance_records[0], { capture_time: null, capture_duration_seconds: 0, user_corrected: false, correction_note: '',
      original_capture_time: { empty: false, lower: null, lower_inclusive: false, lower_infinite: true, upper: null, upper_inclusive: false, upper_infinite: true } })
    await apply(state)
    expect(await readNativeProvenance(db)).toEqual(state)
  })

  it('uses changed native geometry and never replays a stale source EWKB value', async () => {
    await apply()
    const point = { type: 'Point' as const, coordinates: [3, 4] }
    const boundary = { type: 'Polygon' as const, coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] }
    await db.query('UPDATE provenance_location SET point = $1::jsonb', [JSON.stringify(point)])
    await db.query('UPDATE named_location SET point = NULL, boundary = $1::jsonb', [JSON.stringify(boundary)])
    expect((await repo.getLocation(source.provenance_locations[0].id))!.point_ewkb_hex).toBe(encodeWgs84Geometry(point))
    expect((await repo.getNamedLocation(source.named_locations[0].id))!).toMatchObject({ point_ewkb_hex: null, boundary_ewkb_hex: encodeWgs84Geometry(boundary) })
  })

  it('decodes every geometry before any database access', async () => {
    const state = structuredClone(source)
    state.provenance_locations[0].point_ewkb_hex += '00'
    const query = vi.fn()
    const exec = vi.fn()
    await expect(applyValidatedNativeProvenance({ query, exec }, state)).rejects.toThrow('trailing')
    expect(query).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })

  it('rolls back all components on late failure and preserves unrelated state', async () => {
    await apply()
    const state = structuredClone(source)
    state.named_locations[0].name = 'must roll back'
    state.provenance_records[0].device_id = '018f4c11-9f14-7d33-8a21-1c80f6499999'
    await expect(db.transaction((tx) => applyValidatedNativeProvenance(tx, state))).rejects.toThrow()
    expect(await readNativeProvenance(db)).toEqual(source)
    expect((await db.query('SELECT id FROM note')).rows).toHaveLength(notes.length)
  })

  it('keeps native owner projections consistent during authoring and reparenting', async () => {
    const revision = source.provenance_activities[0].revision_id!
    const activity = await repo.recordProvenance('revision', revision, { activity: 'edited', agent: null, attributes: false })
    expect(await repo.activitiesForNote(owner)).toEqual([expect.objectContaining({ revision_id: revision, metadata: false })])
    await db.query("UPDATE provenance_edge SET entity_type = 'note', entity_id = $1 WHERE id = $2", [owner, activity.id])
    expect(await repo.getActivity(activity.id)).toMatchObject({ note_id: owner, revision_id: null })
    await repo.recordProvenance('collection', 'legacy-collection', { activity: 'edited', agent: 'local' })
    await expect(readNativeProvenance(db)).rejects.toThrow('unrepresentable-live-provenance-entity')
  })

  it('rejects a revision assigned to the wrong owner and unknown filter identifiers', async () => {
    const state = structuredClone(source)
    state.provenance_activities[0].note_id = notes.find((note) => note.id !== owner)!.id
    await expect(db.transaction((tx) => applyValidatedNativeProvenance(tx, state))).rejects.toThrow()
    await expect(readNativeProvenanceComponent(db, 'provenance_records', { 'id; DELETE FROM note': owner } as never)).rejects.toThrow('Unknown provenance filter')
  })

  it('preserves every schema-nullable field while keeping required ownership', async () => {
    const state = structuredClone(source)
    const schemas = { provenance_activities: 'provenance-activity', provenance_edges: 'provenance-edge', named_locations: 'named-location',
      provenance_locations: 'provenance-location', provenance_devices: 'provenance-device', provenance_records: 'provenance-record' }
    for (const component of Object.keys(state) as (keyof NativeProvenance)[]) {
      const schema = JSON.parse(readFileSync(new URL(`../../../schemas/knowledge-shard/2.0.0/full-v1/${schemas[component]}.schema.json`, import.meta.url), 'utf8'))
      for (const [key, field] of Object.entries(schema.properties) as [string, { type?: string | string[] }][]) {
        if (Array.isArray(field.type) && field.type.includes('null') && key !== 'note_id') {
          Object.assign(state[component][0], { [key]: null })
        }
      }
    }
    await apply(state)
    expect(await readNativeProvenance(db)).toEqual(state)
  })

  it('cascades owned history and preserves shared locations and devices after native deletion', async () => {
    await apply()
    await new LifecyclePurgeRepository(db).purge({ note_ids: [owner] }, 'native-provenance-purge')
    const current = await readNativeProvenance(db)
    expect(current).toEqual({ ...source, provenance_activities: [], provenance_edges: [], provenance_records: [] })
    expect((await db.query('SELECT id FROM note')).rows).toHaveLength(notes.length - 1)
  })

  it('nulls deleted shared references without replaying source identities', async () => {
    await apply()
    await db.exec('DELETE FROM named_location; DELETE FROM provenance_device; DELETE FROM provenance_edge')
    expect((await repo.getLocation(source.provenance_locations[0].id))!.named_location_id).toBeNull()
    expect((await repo.captureForNote(owner))!).toMatchObject({ activity_id: null, device_id: null })
    await db.exec('DELETE FROM provenance_location')
    expect((await repo.captureForNote(owner))!).toMatchObject({ location_id: null, original_location_id: null })
  })

  it('backfills actual legacy note/revision owners without fabricating other entity ownership', async () => {
    const legacy = await PGlite.create({ extensions: { vector } })
    try {
      await legacy.exec('CREATE EXTENSION IF NOT EXISTS vector')
      await new MigrationRunner(legacy).apply(allMigrations.filter((migration) => migration.version < 28))
      await legacy.query('INSERT INTO note (id) VALUES ($1)', [owner])
      const revision = source.provenance_activities[0].revision_id!
      await legacy.query("INSERT INTO note_revision (id, note_id, revision_number, content, type) VALUES ($1, $2, 1, 'legacy', 'user')", [revision, owner])
      const oldRepo = new ProvenanceRepository(legacy)
      const noteActivity = await oldRepo.recordProvenance('note', owner, { activity: 'created', agent: 'local', attributes: '' })
      const revisionActivity = await oldRepo.recordProvenance('revision', revision, { activity: 'edited', agent: 'local' })
      const otherActivity = await oldRepo.recordProvenance('collection', owner, { activity: 'edited', agent: 'local' })
      await new MigrationRunner(legacy).apply(allMigrations)
      expect(await oldRepo.getActivity(noteActivity.id)).toMatchObject({ note_id: owner, revision_id: null, metadata: '' })
      expect(await oldRepo.getActivity(revisionActivity.id)).toMatchObject({ note_id: owner, revision_id: revision })
      expect((await legacy.query('SELECT note_id, revision_id FROM provenance_edge WHERE id = $1', [otherActivity.id])).rows).toEqual([{ note_id: null, revision_id: null }])
      await expect(readNativeProvenance(legacy)).rejects.toThrow('unrepresentable-live-provenance-entity')
    } finally { await legacy.close() }
  })
})
