import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { importShard } from '../../shard/shard-import.js'
import { applyValidatedNativeCore, readNativeCore, type NativeCore } from '../../shard/native-core.js'
import { readNativeNoteHistory } from '../../shard/native-note-history.js'
import { readNativeEmbeddings } from '../../shard/native-embeddings.js'
import { readNativeSkos } from '../../shard/native-skos.js'
import { readNativeProvenance } from '../../shard/native-provenance.js'
import { readNativeGraph } from '../../shard/native-graph.js'
import { FULL_V1_COMPONENT_FILES } from '../../shard/schema-validator.js'
import { unpackTarGz, packTarGz } from '../../shard/shard-tar.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import type { DatabaseClient } from '../../storage-backend.js'
import { sha256Hex } from '../../shard/checksum.js'
import { exportShard, exportShardWithReport } from '../../shard/shard-export.js'
import { importFullV1Snapshot, exportFullV1Snapshot } from '../../shard/full-v1-store.js'
import { validateFullV1ShardArchive } from '../../shard/schema-validator.js'
import { TagsRepository } from '../../repositories/tags-repository.js'
import { SkosRepository } from '../../repositories/skos-repository.js'
import { LinksRepository } from '../../repositories/links-repository.js'
import { CollectionsRepository } from '../../repositories/collections-repository.js'
import { EmbeddingSetsRepository, type EmbeddingSetCriteria, type EmbeddingSetRow, type VirtualEmbeddingSetDefinition, type VirtualEmbeddingSetSource } from '../../repositories/embedding-sets-repository.js'
import { AllowlistTrustStore } from '../../shard/shard-signature.js'
import type { ImportProgress, ImportOptions } from '../../shard/types.js'
import type { NativeState } from '../../shard/native-full-v1-import.js'
import { applyValidatedNativeEmbeddings } from '../../shard/native-embeddings.js'
import { applyValidatedNativeSkos } from '../../shard/native-skos.js'
import { TemplatesRepository } from '../../repositories/templates-repository.js'
import { AttachmentsRepository } from '../../repositories/attachments-repository.js'
import { ProvenanceRepository } from '../../repositories/provenance-repository.js'
import { CommunitiesRepository } from '../../repositories/communities-repository.js'

const archive = new Uint8Array(readFileSync(new URL('./fixtures/full-v1/server-full-v1-revision-19-v2.shard', import.meta.url)))
const files = unpackTarGz(archive)
const records = Object.fromEntries(Object.entries(FULL_V1_COMPONENT_FILES).map(([component, spec]) => {
  const text = new TextDecoder().decode(files.get(spec.file))
  return [component, spec.encoding === 'json-array' ? JSON.parse(text) as unknown[] : text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown)]
}))

describe('public native full-v1 restore, distinct from archival snapshots', () => {
  let db: PGlite
  let blobs: MemoryBlobStore
  let pristine: Blob
  beforeAll(async () => {
    const initial = await PGlite.create({ extensions: { vector } })
    try {
      await initial.exec('CREATE EXTENSION vector')
      await new MigrationRunner(initial).apply(allMigrations)
      pristine = await initial.dumpDataDir('none')
    } finally { await initial.close() }
  })
  async function cleanDatabase() {
    // Clone only the empty migrated schema; imported state is never reused.
    const clean = await PGlite.create({ extensions: { vector }, loadDataDir: pristine })
    try {
      for (const table of ['note', 'native_shard_record_lineage', 'knowledge_shard_component_record', 'job_queue']) {
        expect((await clean.query(`SELECT * FROM ${table}`)).rows).toEqual([])
      }
      return clean
    } catch (error) { await clean.close(); throw error }
  }
  beforeEach(async () => {
    db = await cleanDatabase()
    blobs = new MemoryBlobStore()
  })
  afterEach(async () => { vi.unstubAllGlobals(); await db.close() })
  async function current() {
    return { ...await readNativeCore(db), ...await readNativeNoteHistory(db), ...await readNativeEmbeddings(db),
      ...await readNativeSkos(db), ...await readNativeProvenance(db), ...await readNativeGraph(db) }
  }

  async function expectPublicRoundTrip(expected: NativeState) {
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors, JSON.stringify(exported.capability_report.losses)).toEqual([])
    expect(exported.success).toBe(true)
    const destination = await cleanDatabase()
    try {
      const destinationBlobs = new MemoryBlobStore()
      const restored = await importShard(destination, exported.archive!, { blobStore: destinationBlobs, conflictStrategy: 'replace' })
      expect(restored.errors).toEqual([])
      expect(restored.success).toBe(true)
      const returned = await exportShardWithReport(destination, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: destinationBlobs })
      expect(returned.errors).toEqual([])
      expect(returned.success).toBe(true)
      for (const archive of [exported.archive!, returned.archive!]) {
        expect((await validateFullV1ShardArchive(archive)).errors).toEqual([])
        const output = unpackTarGz(archive)
        for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
          const text = new TextDecoder().decode(output.get(spec.file))
          const rows = spec.encoding === 'json-array' ? JSON.parse(text) : text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
          expect(rows, component).toHaveLength(expected[component as keyof NativeState].length)
          expect(rows, component).toEqual(expect.arrayContaining<unknown>(expected[component as keyof NativeState]))
        }
        for (const [path, bytes] of unpackTarGz(exported.archive!)) if (path.startsWith('blobs/')) expect(output.get(path), path).toEqual(bytes)
      }
    } finally { await destination.close() }
  }

  async function lineageArchive(notes: NativeCore['notes'], presence: 'absent' | 'empty' | 'value') {
    const output = new Map<string, Uint8Array>()
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
      const rows = component === 'notes' ? notes : []
      const bytes = new TextEncoder().encode(spec.encoding === 'json-array' ? JSON.stringify(rows) : rows.map((row) => JSON.stringify(row)).join('\n'))
      output.set(spec.file, bytes)
      manifest.counts[component] = rows.length
      manifest.checksums[spec.file] = await sha256Hex(bytes)
    }
    manifest.counts.community_sets = 0
    delete manifest.migrated_from
    if (presence === 'absent') delete manifest.migration_history
    else manifest.migration_history = presence === 'empty' ? [] : [{
      from_version: '1.2.0', to_version: '2.0.0', migrated_at: '2026-07-22T18:00:00.000Z',
      migrated_by: 'native-lineage-test', changes: ['Preserved source key presence'],
    }]
    if (presence === 'value') manifest.migrated_from = '1.2.0'
    output.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    expect((await validateFullV1ShardArchive(output)).valid).toBe(true)
    return { archive: packTarGz(output), manifest }
  }
  const lineageNote = (tag: string): NativeCore['notes'][number] => ({
    ...(records as unknown as NativeCore).notes[0], id: crypto.randomUUID(), collection_id: null, attachments: [], tags: [tag],
  })

  async function modifiedArchive(changes: Partial<NativeState>) {
    const output = new Map(files)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    for (const component of Object.keys(changes) as (keyof NativeState)[]) {
      const spec = FULL_V1_COMPONENT_FILES[component]
      const rows = changes[component]!
      const bytes = new TextEncoder().encode(spec.encoding === 'json-array' ? JSON.stringify(rows) : rows.map((row) => JSON.stringify(row)).join('\n'))
      output.set(spec.file, bytes)
      manifest.counts[component] = component === 'communities' ? changes.communities!.reduce((sum, set) => sum + set.communities.length, 0) : rows.length
      if (component === 'communities') manifest.counts.community_sets = rows.length
      manifest.checksums[spec.file] = await sha256Hex(bytes)
    }
    if (changes.notes) {
      const sidecars = new Set(changes.notes.flatMap((note) => note.attachments.map(({ attachment }) => `blobs/${attachment.checksum.slice(7)}`)))
      for (const path of output.keys()) if (path.startsWith('blobs/') && !sidecars.has(path)) output.delete(path)
    }
    output.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    output.delete('signature.json')
    expect((await validateFullV1ShardArchive(output)).errors).toEqual([])
    return packTarGz(output)
  }

  it.each([
    ['note_original', 'note_id'], ['note_original_history', 'id'],
    ['note_revised_current', 'note_id'], ['note_revision', 'id'],
    ['provenance_edge', 'id'], ['provenance_derivation', 'id'], ['provenance_record', 'id'],
    ['embedding', 'id'],
  ])('preserves retained %s identities and external references on repeat replacement', async (table, key) => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_restore_reference (
      reference TEXT NOT NULL REFERENCES ${table}(${key}) ON DELETE RESTRICT);
      INSERT INTO protected_restore_reference SELECT ${key} FROM ${table};`)
    const references = (await db.query('SELECT * FROM protected_restore_reference ORDER BY reference')).rows
    expect(references.length).toBeGreaterThan(0)
    const before = await current()
    for (let attempt = 0; attempt < 2; attempt++) {
      const restored = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })
      expect(restored.errors).toEqual([])
      expect(restored.success).toBe(true)
      expect(await current()).toEqual(before)
      expect((await db.query('SELECT * FROM protected_restore_reference ORDER BY reference')).rows).toEqual(references)
    }
    await expectPublicRoundTrip(before)
  }, 30_000)

  it.each([
    ['skos_labels', 'skos_concept_label', ['id'], { value: 'Updated retained label' }],
    ['skos_notes', 'skos_concept_note', ['id'], { value: 'Updated retained note' }],
    ['skos_relations', 'skos_concept_relation', ['id'], { inference_score: 0.42 }],
    ['skos_mapping_relations', 'skos_mapping_relation', ['id'], { confidence: 0.42 }],
    ['skos_scheme_memberships', 'skos_scheme_membership', ['concept_id', 'scheme_id'], { is_top_concept: false }],
    ['note_skos_tags', 'note_skos_tag', ['note_id', 'concept_id'], { confidence: 0.42 }],
    ['skos_collection_members', 'skos_collection_member', ['collection_id', 'concept_id'], { position: 17 }],
  ] as const)('preserves retained SKOS %s references through replace, edit and rollback', async (component, table, keys, edit) => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_skos_reference (
      ${keys.map((key) => `${key} TEXT NOT NULL`).join(', ')},
      FOREIGN KEY (${keys.join(', ')}) REFERENCES ${table}(${keys.join(', ')}) ON DELETE RESTRICT);
      INSERT INTO protected_skos_reference SELECT ${keys.join(', ')} FROM ${table};`)
    const references = () => db.query(`SELECT * FROM protected_skos_reference ORDER BY ${keys.join(', ')}`).then((result) => result.rows)
    const rows = () => db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY ${keys.join(', ')}`).then((result) => result.rows)
    const before = { native: await current(), rows: await rows(), references: await references() }
    expect(before.references.length).toBeGreaterThan(0)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect({ native: await current(), rows: await rows(), references: await references() }).toEqual(before)
    }
    const changed = structuredClone(records) as unknown as NativeState
    Object.assign(changed[component][0], edit)
    const replacement = await modifiedArchive(changed)
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    expect({ native: await current(), rows: await rows(), references: await references() }).toEqual(before)
    let reachedCommit = false
    const rejected = await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
      if (event.phase === 'index' && event.done === 0) { reachedCommit = true; throw new Error('injected SKOS reference rollback') }
    } })
    expect(reachedCommit).toBe(true)
    expect(rejected.success).toBe(false)
    expect({ native: await current(), rows: await rows(), references: await references() }).toEqual(before)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await references()).toEqual(before.references)
      expect((await current())[component]).toEqual(changed[component])
    }
    await expectPublicRoundTrip(await current())
    const omission = await modifiedArchive({ [component]: [] })
    const retained = { native: await current(), rows: await rows(), references: await references() }
    expect((await importShard(db, omission, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
    expect({ native: await current(), rows: await rows(), references: await references() }).toEqual(retained)
  })

  it.each([
    ['links', 'link', ['id']],
    ['links', 'link_url_target', ['id']],
    ['graph_edges', 'graph_edge_artifact', ['graph_source_id', 'from_note_id', 'to_note_id', 'kind']],
    ['community_assignments', 'community_assignment', ['community_set_id', 'note_id']],
  ] as const)('preserves retained relationship %s in %s through replace, edit and rollback', async (component, table, keys) => {
    const source = structuredClone(records) as unknown as NativeState
    source.links.push({ ...source.links[0], id: '0198abcd-0000-7000-8000-000000000801',
      to_note_id: null, to_url: 'https://example.org/retained-link' })
    const input = await modifiedArchive(source)
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_relationship_reference (
      ${keys.map((key) => `${key} TEXT NOT NULL`).join(', ')},
      FOREIGN KEY (${keys.join(', ')}) REFERENCES ${table}(${keys.join(', ')}) ON DELETE RESTRICT);
      INSERT INTO protected_relationship_reference SELECT ${keys.join(', ')} FROM ${table};`)
    const references = () => db.query(`SELECT * FROM protected_relationship_reference ORDER BY ${keys.join(', ')}`).then((result) => result.rows)
    const rows = () => db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY ${keys.join(', ')}`).then((result) => result.rows)
    const snapshot = async () => ({ native: await current(), rows: await rows(), references: await references() })
    const before = await snapshot()
    expect(before.references.length).toBeGreaterThan(0)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await snapshot()).toEqual(before)
    }
    const changed = structuredClone(source)
    for (const row of changed[component]) row.metadata = { retained: true }
    const replacement = await modifiedArchive(changed)
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    expect(await snapshot()).toEqual(before)
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'error' })).success).toBe(false)
    expect(await snapshot()).toEqual(before)
    let reachedCommit = false
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
      if (event.phase === 'index' && event.done === 0) { reachedCommit = true; throw new Error('injected relationship rollback') }
    } })).success).toBe(false)
    expect(reachedCommit).toBe(true)
    expect(await snapshot()).toEqual(before)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await references()).toEqual(before.references)
      expect((await current())[component]).toHaveLength(changed[component].length)
      expect((await current())[component]).toEqual(expect.arrayContaining<unknown>(changed[component]))
    }
    await expectPublicRoundTrip(await current())
    const omission = await modifiedArchive({ ...changed, [component]: [] })
    const retained = await snapshot()
    expect((await importShard(db, omission, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
    expect(await snapshot()).toEqual(retained)
    await db.exec('DROP TABLE protected_relationship_reference')
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, omission, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect((await current())[component]).toEqual([])
    }
    await expectPublicRoundTrip(await current())
  }, 30_000)

  it('moves retained community assignments before omitted nested community cleanup', async () => {
    const source = structuredClone(records) as unknown as NativeState
    const omittedId = 'Retained-Movement-Old-Community'
    source.communities[0].communities.push({ ...source.communities[0].communities[0], id: omittedId })
    source.community_assignments = source.community_assignments.map((row) => ({ ...row, community_id: omittedId }))
    const input = await modifiedArchive(source)
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_assignment_movement (
      community_set_id TEXT, note_id TEXT,
      FOREIGN KEY (community_set_id, note_id) REFERENCES community_assignment(community_set_id, note_id) ON DELETE RESTRICT);
      INSERT INTO protected_assignment_movement SELECT community_set_id, note_id FROM community_assignment;`)
    const references = () => db.query('SELECT * FROM protected_assignment_movement ORDER BY community_set_id, note_id').then((result) => result.rows)
    const before = { native: await current(), references: await references() }
    expect(before.references.length).toBeGreaterThan(0)
    let reachedCommit = false
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
      if (event.phase === 'index' && event.done === 0) { reachedCommit = true; throw new Error('injected assignment movement rollback') }
    } })).success).toBe(false)
    expect(reachedCommit).toBe(true)
    expect({ native: await current(), references: await references() }).toEqual(before)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await references()).toEqual(before.references)
      expect((await current()).community_assignments).toHaveLength((records as unknown as NativeState).community_assignments.length)
      expect((await current()).community_assignments).toEqual(expect.arrayContaining((records as unknown as NativeState).community_assignments))
      expect((await current()).communities).toEqual((records as unknown as NativeState).communities)
    }
    await expectPublicRoundTrip(await current())
  })

  it('reconciles graph omissions by complete case-sensitive coordinates', async () => {
    const source = structuredClone(records) as unknown as NativeState
    const originalSource = source.graph_sources[0]
    const originalSet = source.communities[0]
    const upperSource = { ...originalSource, id: originalSource.id.toUpperCase() }
    const upperSet = { ...originalSet, id: originalSet.id.toUpperCase(), graph_source_id: upperSource.id }
    expect(upperSource.id).not.toBe(originalSource.id)
    expect(upperSet.id).not.toBe(originalSet.id)
    source.graph_sources.push(upperSource)
    source.communities.push(upperSet)
    const edge = source.graph_edges[0]
    const parallel = { ...edge, kind: edge.kind === 'manual' ? 'link' as const : 'manual' as const }
    source.graph_edges.push(parallel, { ...edge, from_note_id: edge.to_note_id, to_note_id: edge.from_note_id },
      { ...edge, graph_source_id: upperSource.id })
    source.community_assignments.push(...source.community_assignments.map((row) => ({ ...row, community_set_id: upperSet.id })))
    const input = await modifiedArchive(source)
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    const replacement = await modifiedArchive({ graph_edges: [parallel],
      community_assignments: source.community_assignments.filter((row) => row.community_set_id === originalSet.id).slice(0, 1) })
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.graph_edges.filter((row) => row.graph_source_id === originalSource.id)).toEqual([parallel])
      expect(after.graph_edges.filter((row) => row.graph_source_id === upperSource.id)).toEqual(before.graph_edges.filter((row) => row.graph_source_id === upperSource.id))
      expect(after.community_assignments.filter((row) => row.community_set_id === originalSet.id)).toHaveLength(1)
      expect(after.community_assignments.filter((row) => row.community_set_id === upperSet.id)).toEqual(before.community_assignments.filter((row) => row.community_set_id === upperSet.id))
    }
    const upperOmission = await modifiedArchive({ graph_sources: [upperSource], graph_edges: [],
      communities: [upperSet], community_assignments: [] })
    const retained = await current()
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, upperOmission, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.graph_edges).toEqual([parallel])
      expect(after.community_assignments).toEqual(retained.community_assignments.filter((row) => row.community_set_id === originalSet.id))
    }
    await expectPublicRoundTrip(await current())
  })

  it('rejects referenced link target-kind changes but permits unreferenced transitions', async () => {
    const source = records as unknown as NativeState
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const replacement = await modifiedArchive({ links: source.links.map((row) => ({ ...row, to_note_id: null, to_url: 'https://example.org/changed-target' })) })
    await db.exec(`CREATE TABLE protected_link_kind (id TEXT REFERENCES link(id) ON DELETE RESTRICT);
      INSERT INTO protected_link_kind SELECT id FROM link;`)
    const before = await current()
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
    expect(await current()).toEqual(before)
    await db.exec('DROP TABLE protected_link_kind')
    for (const input of [replacement, replacement, archive, archive]) {
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect((await current()).links).toHaveLength(source.links.length)
      await expectPublicRoundTrip(await current())
    }
  }, 30_000)

  it('reconciles selected derivation omissions without deleting source-note references', async () => {
    const source = records as unknown as NativeState
    const independent = { ...source.provenance_edges[0], id: crypto.randomUUID(), revision_id: null,
      source_note_id: source.notes[0].id }
    const input = await modifiedArchive({ provenance_edges: [...source.provenance_edges, independent] })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    const replacement = await modifiedArchive({ provenance_edges: [] })
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await current()).toEqual({ ...before, provenance_edges: [independent] })
    }
    await expectPublicRoundTrip(await current())
  })

  it('rejects omitted activities still referenced by unrelated capture owners', async () => {
    const source = records as unknown as NativeState
    const note = lineageNote('retained-activity-reference')
    const capture = { ...source.provenance_records[0], id: crypto.randomUUID(), note_id: note.id, attachment_id: null }
    const input = await modifiedArchive({ notes: [...source.notes, note], provenance_records: [...source.provenance_records, capture] })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    const replacement = await modifiedArchive({ provenance_activities: [],
      provenance_records: source.provenance_records.map((row) => ({ ...row, activity_id: null })) })
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })
      expect(result.success).toBe(false)
      expect(result.errors).toEqual(['Native full-v1 transaction failed'])
      expect(await current()).toEqual(before)
    }
  })

  it('moves retained captures before omitted activity cleanup', async () => {
    const source = records as unknown as NativeState
    const omitted = { ...source.provenance_activities[0], id: crypto.randomUUID() }
    const input = await modifiedArchive({ provenance_activities: [...source.provenance_activities, omitted],
      provenance_records: source.provenance_records.map((row) => ({ ...row, activity_id: omitted.id })) })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_capture_reference (reference TEXT REFERENCES provenance_record(id) ON DELETE RESTRICT);
      INSERT INTO protected_capture_reference SELECT id FROM provenance_record;`)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.provenance_activities).toEqual(source.provenance_activities)
      expect(after.provenance_records).toEqual(source.provenance_records)
    }
    await expectPublicRoundTrip(await current())
  })

  it('restores all33 producer components into usable native state and converges on repeat', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })
      expect(result.errors).toEqual([])
      expect(result.success).toBe(true)
      const state = await current()
      for (const [component, expected] of Object.entries(records)) {
        expect(state[component as keyof typeof state], component).toHaveLength(expected.length)
        expect(state[component as keyof typeof state], component).toEqual(expect.arrayContaining(expected))
      }
    }
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await db.query('SELECT * FROM job_queue')).rows).toEqual([])
    const note = (await current()).notes[0]
    expect((await new NotesRepository(db).get(note.id)).metadata).toEqual(note.metadata)
    for (const { attachment } of note.attachments) expect(await blobs.read(attachment.checksum)).not.toBeNull()
  })

  it('reports every native row and yields by the requested batch size, including skip completion', async () => {
    const events: ImportProgress[] = []
    const yieldTask = vi.fn(async () => {})
    vi.stubGlobal('scheduler', { yield: yieldTask })
    const options = { blobStore: blobs, conflictStrategy: 'replace' as const, batchSize: 2,
      onProgress: (event: ImportProgress) => { events.push(event) } }
    const result = await importShard(db, archive, options)
    expect(result.errors).toEqual([])
    const rowCount = Object.values(records).reduce((sum, rows) => sum + rows.length, 0)
    expect(yieldTask).toHaveBeenCalledTimes(Math.floor(rowCount / 2))
    const phases = new Map<string, ImportProgress>()
    for (const event of events) {
      expect(event.done).toBeGreaterThanOrEqual(phases.get(event.phase)?.done ?? 0)
      expect(event.done).toBeLessThanOrEqual(event.total)
      phases.set(event.phase, event)
    }
    expect(events.at(-1)).toEqual({ phase: 'index', done: 1, total: 1 })
    for (const event of phases.values()) expect(event.done, event.phase).toBe(event.total)
    expect([...phases.values()].filter((event) => !['unpack', 'validate', 'index'].includes(event.phase))
      .reduce((sum, event) => sum + event.total, 0)).toBe(rowCount)
    events.length = 0
    yieldTask.mockClear()
    const skipped = await importShard(db, archive, { ...options, conflictStrategy: 'skip' })
    expect(skipped.errors).toEqual([])
    expect(skipped.counts.notes).toBe(0)
    expect(yieldTask).not.toHaveBeenCalled()
    for (const event of events.filter((event) => !['unpack', 'validate', 'index'].includes(event.phase))) expect(event.done).toBe(event.total)
  })

  it('supports zero batch size without disabling row progress', async () => {
    const yieldTask = vi.fn(async () => {})
    vi.stubGlobal('scheduler', { yield: yieldTask })
    const events: ImportProgress[] = []
    expect((await importShard(db, archive, { blobStore: blobs, batchSize: 0, onProgress: (event) => { events.push(event) } })).errors).toEqual([])
    expect(yieldTask).not.toHaveBeenCalled()
    expect(events.filter((event) => event.phase === 'notes' && event.done > 0).length).toBeGreaterThan(1)
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid batch size %s before native access', async (batchSize) => {
    const forbidden = new Proxy({} as DatabaseClient, { get() { throw new Error('Unexpected database access') } })
    const result = await importShard(forbidden, archive, { blobStore: blobs, batchSize })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual(['Invalid native full-v1 batchSize'])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it.each(['unpack', 'validate', 'communities', 'index'] as const)('rolls back a rejected %s callback without reporting committed success', async (phase) => {
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace', onProgress: async (event) => {
      if (event.phase === phase && (phase === 'communities' ? event.done > 0 : event.done === 0)) throw new Error('Rejected observer')
    } })
    expect(result.success).toBe(false)
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
    expect((await db.query('SELECT * FROM native_shard_lineage')).rows).toEqual([])
    expect((await db.query('SELECT * FROM community_set')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('retains committed success if the final notification rejects', async () => {
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace', onProgress: async (event) => {
      if (event.phase === 'index' && event.done === 1) {
        expect((await db.query('SELECT * FROM note')).rows).toHaveLength(records.notes.length)
        throw new Error('Final observer failure')
      }
    } })
    expect(result.success).toBe(true)
    expect(result.warnings).toContain('Native import committed, but the final progress callback failed.')
    expect((await current()).notes).toHaveLength(records.notes.length)
    for (const note of (records as unknown as NativeCore).notes) for (const { attachment } of note.attachments) expect(await blobs.has(attachment.checksum)).toBe(true)
  })

  it('warns for unsigned prefer imports but rejects invalid callbacks before storage', async () => {
    const imported = await importShard(db, archive, { blobStore: blobs, trustStore: new AllowlistTrustStore([]), verifySignature: 'prefer' })
    expect(imported.success).toBe(true)
    expect(imported.warnings).toContain('Shard is unsigned; imported under verifySignature: prefer. Publisher provenance was NOT authenticated.')
    const forbidden = new Proxy({} as DatabaseClient, { get() { throw new Error('Unexpected database access') } })
    const rejected = await importShard(forbidden, archive, { onProgress: true } as unknown as ImportOptions)
    expect(rejected.success).toBe(false)
  })

  it('exports every native component after restore and restores it into a clean destination', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    expect(exported.success).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const actual = unpackTarGz(exported.archive!)
    for (const [component, spec] of Object.entries(FULL_V1_COMPONENT_FILES)) {
      const text = new TextDecoder().decode(actual.get(spec.file))
      const rows: unknown[] = spec.encoding === 'json-array' ? JSON.parse(text) : text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
      expect(rows, component).toHaveLength(records[component].length)
      expect(rows, component).toEqual(expect.arrayContaining(records[component]))
    }
    const destination = await PGlite.create({ extensions: { vector } })
    try {
      await destination.exec('CREATE EXTENSION vector')
      await new MigrationRunner(destination).apply(allMigrations)
      expect((await importShard(destination, exported.archive!, { blobStore: new MemoryBlobStore(), conflictStrategy: 'replace' })).success).toBe(true)
      expect((await readNativeCore(destination)).notes).toEqual((await readNativeCore(db)).notes)
    } finally { await destination.close() }
  })

  it('keeps explicitly archived bytes independent from public current-state CRUD', async () => {
    expect((await importFullV1Snapshot(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const note = await new NotesRepository(db).create({ title: 'Native only', content: 'Current content', metadata: ['native'] })
    await new NotesRepository(db).update(note.id, { title: 'Changed native', metadata: null })
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    const text = new TextDecoder().decode(unpackTarGz(exported.archive!).get('notes.jsonl'))
    const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: note.id, title: 'Changed native', metadata: null })
    const archived = await exportFullV1Snapshot(db, blobs)
    expect(archived.success).toBe(true)
    const archivedFiles = unpackTarGz(archived.archive!)
    for (const [path, bytes] of files) expect(archivedFiles.get(path), path).toEqual(bytes)
  })

  it('round-trips ordinary template creation, edits and deletion after public restore', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const templates = new TemplatesRepository(db)
    const original = (records as unknown as NativeState).templates[0]
    const updated = await templates.update(original.id, { description: '', default_tags: ['later', 'first'], content: 'Updated native template' })
    const created = await templates.create({ name: 'Created after restore', content: 'New content', description: null })
    let state = await current()
    expect(state.templates).toEqual(expect.arrayContaining([updated, created]))
    await expectPublicRoundTrip(state)
    await templates.delete(original.id)
    state = await current()
    expect(state.templates.some((row) => row.id === original.id)).toBe(false)
    expect(state.templates).toContainEqual(created)
    await expectPublicRoundTrip(state)
  }, 30_000)

  it('exports newly attached bytes and extraction changes, and reports attachment tombstones', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const source = records as unknown as NativeState
    const attachments = new AttachmentsRepository(db, blobs)
    const bytes = new TextEncoder().encode('New native attachment bytes')
    const created = await attachments.attach({ noteId: source.notes[0].id, data: bytes, filename: 'native/new.txt', mimeType: 'text/plain', extractedText: 'New extraction' })
    expect(await attachments.getBlob(created.id)).toEqual(bytes)
    const existingId = source.notes[0].attachments[0].attachment.id
    await db.query("UPDATE attachment SET extracted_text = 'Updated extraction', status = 'completed', filename = 'updated/path.txt' WHERE id = $1", [existingId])
    const state = await current()
    const projections = state.notes.find((note) => note.id === source.notes[0].id)!.attachments
    expect(projections).toEqual(expect.arrayContaining([
      expect.objectContaining({ extracted_text: 'Updated extraction', attachment: expect.objectContaining({ id: existingId, path: 'updated/path.txt' }) }),
      expect.objectContaining({ extracted_text: 'New extraction', attachment: expect.objectContaining({ id: created.id }) }),
    ]))
    await expectPublicRoundTrip(state)
    await attachments.delete(created.id)
    const rejected = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(rejected.success).toBe(false)
    expect(rejected.archive).toBeNull()
    expect(rejected.capability_report.losses).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unrepresentable-live-tombstone' })]))
  })

  it('round-trips ordinary SKOS creation, relation and assignment changes after public restore', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const source = records as unknown as NativeState
    const skos = new SkosRepository(db)
    const concept = await skos.createConcept(source.skos_schemes[0].id, 'New native concept', { altLabels: ['Native alias'], definition: 'Native definition' })
    const relation = await skos.createRelation(concept.id, source.skos_concepts[0].id, 'related')
    await skos.tagNote(source.notes[0].id, concept.id)
    const prior = source.note_skos_tags[0]
    await skos.untagNote(prior.note_id, prior.concept_id)
    const state = await current()
    expect(state.skos_labels).toEqual(expect.arrayContaining([expect.objectContaining({ concept_id: concept.id, value: 'New native concept' })]))
    expect(state.skos_relations).toEqual(expect.arrayContaining([expect.objectContaining({ id: relation.id })]))
    expect(state.note_skos_tags).toEqual(expect.arrayContaining([expect.objectContaining({ concept_id: concept.id, note_id: source.notes[0].id })]))
    expect(state.note_skos_tags.some((row) => row.note_id === prior.note_id && row.concept_id === prior.concept_id)).toBe(false)
    await expectPublicRoundTrip(state)
    await skos.deleteConcept(concept.id)
    const rejected = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(rejected.success).toBe(false)
    expect(rejected.archive).toBeNull()
    expect(rejected.capability_report.losses).toEqual(expect.arrayContaining([expect.objectContaining({ component: 'skos_concepts', code: 'unrepresentable-live-tombstone' })]))
  })

  it('round-trips ordinary vector replacement and creation after public restore', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const source = records as unknown as NativeState
    const sets = new EmbeddingSetsRepository(db)
    const original = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null)!
    const changed = await sets.putEmbedding({ note_id: original.note_id!, embedding_set_id: original.embedding_set_id!, vector: Array(768).fill(0.25) })
    const otherNote = source.notes.find((note) => note.id !== original.note_id)!
    const created = await sets.putEmbedding({ note_id: otherNote.id, embedding_set_id: original.embedding_set_id!, vector: Array(768).fill(0.5) })
    const state = await current()
    expect(state.embeddings.some((row) => row.id === original.id)).toBe(false)
    expect(state.embeddings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: changed.id, vector: Array(768).fill(0.25) }),
      expect.objectContaining({ id: created.id, vector: Array(768).fill(0.5) }),
    ]))
    await expectPublicRoundTrip(state)
  })

  it.each(['skos_labels', 'skos_notes'] as const)('reports ordinary empty %s values that the wire profile cannot represent', async (component) => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const skos = new SkosRepository(db)
    const schemeId = (records as unknown as NativeState).skos_schemes[0].id
    await skos.createConcept(schemeId, component === 'skos_labels' ? '' : 'Native label', { definition: component === 'skos_notes' ? '' : 'Native definition' })
    const rejected = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(rejected.success).toBe(false)
    expect(rejected.archive).toBeNull()
    expect(rejected.capability_report.losses).toContainEqual(expect.objectContaining({ code: 'unrepresentable-live-record', component, action: 'reject' }))
  })

  it('round-trips native provenance authoring and changed shared references after public restore', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const source = records as unknown as NativeState
    const provenance = new ProvenanceRepository(db)
    const revision = source.note_revisions[0]
    const activity = await provenance.recordProvenance('revision', revision.id, { activity: 'edited', agent: null, attributes: false })
    expect(await provenance.getActivity(activity.id)).toMatchObject({ note_id: revision.note_id, revision_id: revision.id, metadata: false })
    await db.query('DELETE FROM provenance_device WHERE id = $1', [source.provenance_devices[0].id])
    await db.query('UPDATE provenance_record SET capture_time = NULL, raw_metadata = $1::jsonb WHERE id = $2', [JSON.stringify(['native', null, false]), source.provenance_records[0].id])
    const state = await current()
    expect(state.provenance_devices.some((row) => row.id === source.provenance_devices[0].id)).toBe(false)
    expect(state.provenance_records[0]).toMatchObject({ device_id: null, capture_time: null, raw_metadata: ['native', null, false] })
    await expectPublicRoundTrip(state)
  })

  it('round-trips ordinary community authoring and source deletion after public restore', async () => {
    expect((await importShard(db, archive, { blobStore: blobs })).success).toBe(true)
    const source = records as unknown as NativeState
    const communities = new CommunitiesRepository(db)
    const created = await communities.saveCommunity({ name: 'Native authored community', sourceType: 'user-authored', noteIds: [source.notes[0].id] })
    const state = await current()
    expect(await communities.getAssignmentRecords(created.id)).toHaveLength(1)
    expect(state.communities).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, name: 'Native authored community' })]))
    await expectPublicRoundTrip(state)
    await db.query('DELETE FROM graph_source WHERE id = $1', [source.graph_sources[0].id])
    const after = await current()
    expect(after.graph_sources.some((row) => row.id === source.graph_sources[0].id)).toBe(false)
    expect(after.communities).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))
    await expectPublicRoundTrip(after)
  }, 30_000)

  it('closes native tag scope without exporting excluded notes, relationships or sidecars', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const source = records as unknown as NativeCore
    const included = source.notes[0]
    await new TagsRepository(db).addTag(included.id, 'native-scope-only')
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'native-scope-only' })
    expect(exported.errors).toEqual([])
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const actual = unpackTarGz(exported.archive!)
    const notes = new TextDecoder().decode(actual.get('notes.jsonl')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect(notes.map((note) => note.id)).toEqual([included.id])
    const destination = await PGlite.create({ extensions: { vector } })
    try {
      await destination.exec('CREATE EXTENSION vector')
      await new MigrationRunner(destination).apply(allMigrations)
      expect((await importShard(destination, exported.archive!, { blobStore: new MemoryBlobStore(), conflictStrategy: 'replace' })).success).toBe(true)
      expect((await destination.query('SELECT id FROM note')).rows).toEqual([{ id: included.id }])
      for (const other of source.notes.slice(1)) {
        for (const table of ['note_revision', 'note_original_history', 'attachment', 'embedding', 'note_skos_tag', 'community_assignment']) {
          expect((await destination.query(`SELECT * FROM ${table} WHERE note_id = $1`, [other.id])).rows, table).toEqual([])
        }
      }
      const allowed = new Set(included.attachments.map((row) => row.attachment.checksum))
      for (const path of actual.keys()) if (path.startsWith('blobs/')) expect(allowed.has('blake3:' + path.slice(6))).toBe(true)
    } finally { await destination.close() }
  })

  it('emits an empty native archive for no matching notes and does not reinterpret set scope as note scope', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    for (const options of [{ tag: 'no-native-match' }, { collectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]) {
      const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, ...options })
      expect(result.errors).toEqual([])
      const actual = unpackTarGz(result.archive!)
      const manifest = JSON.parse(new TextDecoder().decode(actual.get('manifest.json')))
      expect(Object.values(manifest.counts).every((count) => count === 0)).toBe(true)
      expect([...actual.keys()].some((path) => path.startsWith('blobs/'))).toBe(false)
    }
    const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs,
      embeddingSetIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })
    expect(result.errors).toEqual([])
    const actual = unpackTarGz(result.archive!)
    const manifest = JSON.parse(new TextDecoder().decode(actual.get('manifest.json')))
    expect(manifest.counts.notes).toBe(records.notes.length)
    expect(manifest.counts.embeddings).toBe(0)
    expect(manifest.counts.embedding_sets).toBe(0)
  })

  it('preserves edited native state on skip, rejects error conflicts and replaces selected roots', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const id = (await current()).notes[0].id
    const notes = new NotesRepository(db)
    await notes.update(id, { title: 'Native edit', metadata: { local: true } })
    const skip = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })
    expect(skip.errors).toEqual([])
    expect(skip.counts.notes).toBe(0)
    expect((await notes.get(id)).title).toBe('Native edit')
    const rejected = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'error' })
    expect(rejected.success).toBe(false)
    expect((await notes.get(id)).metadata).toEqual({ local: true })
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    expect((await notes.get(id)).title).not.toBe('Native edit')
  })

  it('exports an ordinarily authored link and imports its new source when the target already exists', async () => {
    const notes = new NotesRepository(db)
    const source = await notes.create({ content: 'New link source' })
    const target = await notes.create({ content: 'Existing link target' })
    const link = await new LinksRepository(db).create(source.id, target.id)
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    const destination = await PGlite.create({ extensions: { vector } })
    try {
      await destination.exec('CREATE EXTENSION vector')
      await new MigrationRunner(destination).apply(allMigrations)
      await new NotesRepository(destination).create({ id: target.id, content: 'Keep existing target' })
      const imported = await importShard(destination, exported.archive!, { blobStore: new MemoryBlobStore(), conflictStrategy: 'skip' })
      expect(imported.errors).toEqual([])
      expect(imported.counts.notes).toBe(1)
      expect((await new NotesRepository(destination).get(target.id)).original.content).toBe('Keep existing target')
      expect((await new LinksRepository(destination).listForNote(source.id)).outbound)
        .toContainEqual(expect.objectContaining({ id: link.id, target_note_id: target.id, confidence: 1 }))
    } finally { await destination.close() }
  })

  it.each(['pref_label', 'alt_labels', 'definition'] as const)('rejects silent loss of a directly edited SKOS %s projection', async (field) => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const concept = (await readNativeSkos(db)).skos_concepts[0]
    const value = field === 'alt_labels' ? JSON.stringify(['Unrepresented display edit']) : 'Unrepresented display edit'
    await db.query(`UPDATE skos_concept SET ${field} = $1 WHERE id = $2`, [value, concept.id])
    const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(result.success).toBe(false)
    expect(result.archive).toBeNull()
    expect(result.capability_report.losses).toContainEqual(expect.objectContaining({
      code: 'unrepresentable-live-skos-projection', component: 'skos_concepts', count: 1, action: 'reject',
    }))
    expect((await db.query<Record<string, unknown>>('SELECT * FROM skos_concept WHERE id = $1', [concept.id])).rows[0][field])
      .toEqual(field === 'alt_labels' ? ['Unrepresented display edit'] : value)
  })

  it('does not let an excluded SKOS display edit prevent a scoped native export', async () => {
    const included = await new NotesRepository(db).create({ content: 'Included', tags: ['only-native'] })
    const skos = new SkosRepository(db)
    const scheme = await skos.createScheme('Excluded scheme')
    const concept = await skos.createConcept(scheme.id, 'Excluded concept')
    await db.query("UPDATE skos_concept SET pref_label = 'Unrepresented edit' WHERE id = $1", [concept.id])
    const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'only-native' })
    expect(result.errors).toEqual([])
    const returned = unpackTarGz(result.archive!)
    expect(new TextDecoder().decode(returned.get('notes.jsonl'))).toContain(included.id)
    expect(new TextDecoder().decode(returned.get('skos_concepts.jsonl'))).toBe('')
  })

  it('decodes only referenced provenance geometry for a selected note scope', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const selected = await new NotesRepository(db).create({ content: 'Selected geometry scope', tags: ['geometry-scope'] })
    await db.query(`UPDATE provenance_location SET point = '{"type":"Point","coordinates":[181,91]}'::jsonb`)
    const options = { profile: 'full-v1' as const, schemaVersion: '2.0.0' as const, blobStore: blobs }
    expect((await exportShardWithReport(db, options)).success).toBe(false)
    const scoped = await exportShardWithReport(db, { ...options, tag: 'geometry-scope' })
    expect(scoped.errors).toEqual([])
    expect((await validateFullV1ShardArchive(scoped.archive!)).valid).toBe(true)
    const actual = unpackTarGz(scoped.archive!)
    expect(new TextDecoder().decode(actual.get('notes.jsonl'))).toContain(selected.id)
    expect(new TextDecoder().decode(actual.get('provenance_locations.jsonl'))).toBe('')
    await db.query('UPDATE provenance_record SET note_id = $1, attachment_id = NULL, activity_id = NULL', [selected.id])
    const included = await exportShardWithReport(db, { ...options, tag: 'geometry-scope' })
    expect(included.success).toBe(false)
    expect(included.archive).toBeNull()
  })

  it('reports a scoped collection ancestor tombstone without leaking an excluded ancestor', async () => {
    const collections = new CollectionsRepository(db)
    const parent = await collections.create({ name: 'Parent' })
    const child = await collections.create({ name: 'Child', parent_id: parent.id })
    const selected = await new NotesRepository(db).create({ content: 'Scoped child', tags: ['ancestor-scope'] })
    await collections.assignNote(child.id, selected.id)
    await db.query('UPDATE collection SET deleted_at = now() WHERE id = $1', [parent.id])
    const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'ancestor-scope' })
    expect(result.success).toBe(false)
    expect(result.capability_report.losses).toContainEqual(expect.objectContaining({
      code: 'unrepresentable-live-tombstone', component: 'collections', count: 1,
    }))
    expect((await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'no-match' })).errors).toEqual([])
  })

  it('reports a tombstoned SKOS replacement required by the selected concept', async () => {
    const skos = new SkosRepository(db)
    const scheme = await skos.createScheme('Replacement scope')
    const original = await skos.createConcept(scheme.id, 'Original')
    const replacement = await skos.createConcept(scheme.id, 'Replacement')
    const selected = await new NotesRepository(db).create({ content: 'Scoped concept', tags: ['replacement-scope'] })
    await db.query('UPDATE skos_concept SET replaced_by_id = $1 WHERE id = $2', [replacement.id, original.id])
    await db.query('INSERT INTO note_skos_tag (id, note_id, concept_id) VALUES ($1, $2, $3)', [crypto.randomUUID(), selected.id, original.id])
    await skos.deleteConcept(replacement.id)
    const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'replacement-scope' })
    expect(result.success).toBe(false)
    expect(result.capability_report.losses).toContainEqual(expect.objectContaining({
      code: 'unrepresentable-live-tombstone', component: 'skos_concepts', count: 1,
    }))
  })

  it('rejects selected virtual embedding definitions instead of emitting a physical filter set', async () => {
    const selected = await new NotesRepository(db).create({ content: 'Virtual set scope', tags: ['virtual-scope'] })
    const sets = new EmbeddingSetsRepository(db)
    const virtual = await sets.create({ name: 'Virtual', kind: 'virtual', slug: 'virtual' })
    const physical = await sets.create({ name: 'Physical', dimensions: 768 })
    await db.query('INSERT INTO embedding_set_member (embedding_set_id, note_id) VALUES ($1, $2)', [virtual.id, selected.id])
    const options = { profile: 'full-v1' as const, schemaVersion: '2.0.0' as const, blobStore: blobs }
    for (const scope of [{}, { tag: 'virtual-scope' }, { embeddingSetIds: [virtual.id] }]) {
      const result = await exportShardWithReport(db, { ...options, ...scope })
      expect(result.success).toBe(false)
      expect(result.capability_report.losses).toContainEqual(expect.objectContaining({
        code: 'unrepresentable-live-virtual-embedding-set', component: 'embedding_sets', count: 1,
      }))
    }
    const unrelated = await exportShardWithReport(db, { ...options, embeddingSetIds: [physical.id] })
    expect(unrelated.errors).toEqual([])
    expect((await validateFullV1ShardArchive(unrelated.archive!)).valid).toBe(true)
  })

  it('bridges legacy flat SKOS into native rows with repeat identity and replace convergence', async () => {
    const source = await PGlite.create({ extensions: { vector } })
    let legacy: Uint8Array
    let conceptId: string
    try {
      await source.exec('CREATE EXTENSION vector')
      await new MigrationRunner(source).apply(allMigrations)
      const skos = new SkosRepository(source)
      const scheme = await skos.createScheme('Legacy scheme')
      const concept = await skos.createConcept(scheme.id, 'Legacy preferred', {
        altLabels: ['Legacy alternate'], definition: 'Legacy definition',
      })
      conceptId = concept.id
      legacy = await exportShard(source)
    } finally { await source.close() }
    expect((await importShard(db, legacy, { conflictStrategy: 'replace' })).errors).toEqual([])
    const first = await readNativeSkos(db)
    expect(first.skos_labels.map((row) => row.value).sort()).toEqual(['Legacy alternate', 'Legacy preferred'])
    expect(first.skos_notes.map((row) => row.value)).toEqual(['Legacy definition'])
    expect(first.skos_scheme_memberships).toHaveLength(1)
    expect((await importShard(db, legacy, { conflictStrategy: 'replace' })).errors).toEqual([])
    expect(await readNativeSkos(db)).toEqual(first)
    const native = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(native.errors).toEqual([])
    expect((await validateFullV1ShardArchive(native.archive!)).valid).toBe(true)

    const changed = unpackTarGz(legacy)
    const concepts = JSON.parse(new TextDecoder().decode(changed.get('skos_concepts.json')))
    Object.assign(concepts[0], { pref_label: 'Changed preferred', alt_labels: [], definition: null })
    const bytes = new TextEncoder().encode(JSON.stringify(concepts))
    changed.set('skos_concepts.json', bytes)
    const manifest = JSON.parse(new TextDecoder().decode(changed.get('manifest.json')))
    manifest.checksums['skos_concepts.json'] = await sha256Hex(bytes)
    changed.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    expect((await importShard(db, packTarGz(changed), { conflictStrategy: 'replace' })).errors).toEqual([])
    const replaced = await readNativeSkos(db)
    expect(replaced.skos_labels).toHaveLength(1)
    expect(replaced.skos_labels[0]).toMatchObject({ concept_id: conceptId, value: 'Changed preferred' })
    expect(replaced.skos_notes).toEqual([])
    expect((await new SkosRepository(db).listConcepts(replaced.skos_schemes[0].id))[0])
      .toMatchObject({ pref_label: 'Changed preferred', alt_labels: [], definition: null })
    expect((await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })).errors).toEqual([])
  })

  it.each(['absent', 'empty', 'value'] as const)('preserves manifest migration history %s through native restore/export', async (presence) => {
    const modified = new Map(files)
    const manifest = JSON.parse(new TextDecoder().decode(modified.get('manifest.json')))
    if (presence === 'absent') delete manifest.migration_history
    else manifest.migration_history = presence === 'empty' ? [] : [{
      from_version: '1.2.0', to_version: '2.0.0', migrated_at: '2026-07-22T18:00:00.000Z',
      migrated_by: 'native-lineage-test', changes: ['Preserved source key presence'],
    }]
    if (presence === 'value') manifest.migrated_from = '1.2.0'
    else delete manifest.migrated_from
    modified.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    expect((await validateFullV1ShardArchive(modified)).valid).toBe(true)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, packTarGz(modified), { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const result = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
      expect(result.errors).toEqual([])
      const returned = JSON.parse(new TextDecoder().decode(unpackTarGz(result.archive!).get('manifest.json')))
      for (const key of ['migration_history', 'migrated_from']) {
        expect(Object.hasOwn(returned, key), key).toBe(Object.hasOwn(manifest, key))
        expect(returned[key], key).toEqual(manifest[key])
      }
    }
  })

  it('keeps distinct native histories available by scope and rejects an ambiguous combined manifest', async () => {
    const first = lineageNote('first-lineage')
    const second = lineageNote('second-lineage')
    const a = await lineageArchive([first], 'absent')
    const b = await lineageArchive([second], 'empty')
    for (const input of [a, b]) expect((await importShard(db, input.archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    expect((await db.query('SELECT * FROM note')).rows).toHaveLength(2)
    const options = { profile: 'full-v1' as const, schemaVersion: '2.0.0' as const, blobStore: blobs }
    const mixed = await exportShardWithReport(db, options)
    expect(mixed.success).toBe(false)
    expect(mixed.archive).toBeNull()
    expect(mixed.capability_report.losses).toContainEqual(expect.objectContaining({ code: 'incompatible-native-migration-lineage', count: 2, action: 'reject' }))
    await new NotesRepository(db).update(first.id, { title: 'Edited after import' })
    for (const [tag, expected] of [['first-lineage', a.manifest], ['second-lineage', b.manifest]] as const) {
      const exported = await exportShardWithReport(db, { ...options, tag })
      expect(exported.errors).toEqual([])
      const manifest = JSON.parse(new TextDecoder().decode(unpackTarGz(exported.archive!).get('manifest.json')))
      expect(Object.hasOwn(manifest, 'migration_history')).toBe(Object.hasOwn(expected, 'migration_history'))
      expect(manifest.migration_history).toEqual(expected.migration_history)
    }
    const replacement = await lineageArchive([first, second], 'value')
    expect((await importShard(db, replacement.archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const unified = await exportShardWithReport(db, options)
    expect(unified.errors).toEqual([])
    expect(JSON.parse(new TextDecoder().decode(unpackTarGz(unified.archive!).get('manifest.json'))).migration_history)
      .toEqual(replacement.manifest.migration_history)
  })

  it('does not replace native lineage for an empty import or a no-op skip', async () => {
    const note = lineageNote('retained-lineage')
    const original = await lineageArchive([note], 'absent')
    expect((await importShard(db, original.archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    for (const input of [await lineageArchive([], 'value'), await lineageArchive([note], 'empty')]) {
      expect((await importShard(db, input.archive, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    }
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    const manifest = JSON.parse(new TextDecoder().decode(unpackTarGz(exported.archive!).get('manifest.json')))
    expect(Object.hasOwn(manifest, 'migration_history')).toBe(false)
    expect(Object.hasOwn(manifest, 'migrated_from')).toBe(false)
    expect((await db.query('SELECT * FROM native_shard_lineage')).rows).toHaveLength(1)
  })

  it.each(['absent', 'empty', 'value'] as const)('preserves %s lineage for an empty archive into an empty destination', async (presence) => {
    const input = await lineageArchive([], presence)
    expect((await importShard(db, input.archive, { blobStore: blobs })).errors).toEqual([])
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    const manifest = JSON.parse(new TextDecoder().decode(unpackTarGz(exported.archive!).get('manifest.json')))
    for (const key of ['migration_history', 'migrated_from']) {
      expect(Object.hasOwn(manifest, key)).toBe(Object.hasOwn(input.manifest, key))
      expect(manifest[key]).toEqual(input.manifest[key])
    }
  })

  it('does not assign removed lineage to a later native record reusing the identity', async () => {
    const note = lineageNote('removed-lineage')
    const input = await lineageArchive([note], 'value')
    expect((await importShard(db, input.archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.transaction(async (tx) => {
      for (const table of ['note_original', 'note_revised_current', 'note_tag']) await tx.query(`DELETE FROM ${table} WHERE note_id = $1`, [note.id])
      await tx.query('DELETE FROM note WHERE id = $1', [note.id])
    })
    expect((await db.query("SELECT * FROM native_shard_record_lineage WHERE component = 'notes'")).rows).toEqual([])
    await new NotesRepository(db).create({ id: note.id, content: 'New identity incarnation' })
    const exported = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })
    expect(exported.errors).toEqual([])
    const manifest = JSON.parse(new TextDecoder().decode(unpackTarGz(exported.archive!).get('manifest.json')))
    expect(manifest.migration_history).toEqual([])
    expect(Object.hasOwn(manifest, 'migrated_from')).toBe(false)
  })

  it('recognizes equal histories independently of JSON object key order', async () => {
    const first = await lineageArchive([lineageNote('ordered-lineage')], 'value')
    const second = await lineageArchive([lineageNote('reordered-lineage')], 'value')
    const modified = unpackTarGz(second.archive)
    second.manifest.migration_history[0] = Object.fromEntries(Object.entries(second.manifest.migration_history[0]).reverse())
    modified.set('manifest.json', new TextEncoder().encode(JSON.stringify(second.manifest)))
    for (const bytes of [first.archive, packTarGz(modified)]) expect((await importShard(db, bytes, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    expect((await db.query('SELECT * FROM native_shard_lineage')).rows).toHaveLength(1)
    expect((await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs })).errors).toEqual([])
  })

  it('rejects malformed bytes and missing publisher trust before native or blob access', async () => {
    const forbidden = new Proxy({} as DatabaseClient, { get() { throw new Error('Unexpected database access') } })
    const malformed = new Map(files)
    malformed.set('notes.jsonl', new TextEncoder().encode('{}'))
    expect((await importShard(forbidden, packTarGz(malformed), { blobStore: blobs })).success).toBe(false)
    expect((await importShard(forbidden, archive, { blobStore: blobs, verifySignature: 'require' })).success).toBe(false)
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
  })

  it('skips one existing note and its owned history without suppressing a new note', async () => {
    const source = records as unknown as NativeCore
    const note = { ...source.notes[0], title: 'Pre-existing native', attachments: [] }
    await db.transaction((tx) => applyValidatedNativeCore(tx,
      { notes: [note], collections: source.collections, tags: [], templates: [], links: [] },
      { note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [] }))
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })
    expect(result.errors).toEqual([])
    expect(result.counts.notes).toBe(source.notes.length - 1)
    expect((await new NotesRepository(db).get(note.id)).title).toBe('Pre-existing native')
    for (const other of source.notes.slice(1)) expect((await new NotesRepository(db).get(other.id)).title).toBe(other.title)
  })

  it('restores new-note assignments and vectors referencing existing concepts and embedding sets', async () => {
    const source = records as unknown as NativeState
    await db.transaction(async (tx) => {
      await applyValidatedNativeEmbeddings(tx, { ...source, embedding_set_members: [], embeddings: [] })
      await applyValidatedNativeSkos(tx, { ...source, note_skos_tags: [] })
    })
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })
    expect(result.errors).toEqual([])
    const restored = await current()
    for (const component of ['note_skos_tags', 'embedding_set_members', 'embeddings'] as const) {
      expect(source[component].length).toBeGreaterThan(0)
      expect(restored[component]).toEqual(expect.arrayContaining<unknown>(source[component]))
      expect(restored[component]).toHaveLength(source[component].length)
    }
  })

  it('restores graph edges and community assignments referencing skipped notes', async () => {
    const source = records as unknown as NativeState
    await db.transaction((tx) => applyValidatedNativeCore(tx,
      { ...source, notes: source.notes.map((note) => ({ ...note, attachments: [] })), links: [] },
      { note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [] }))
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })
    expect(result.errors).toEqual([])
    expect(result.counts.notes).toBe(0)
    const restored = await readNativeGraph(db)
    for (const component of ['graph_sources', 'graph_edges', 'communities', 'community_assignments'] as const) {
      expect(source[component].length).toBeGreaterThan(0)
      expect(restored[component]).toEqual(expect.arrayContaining<unknown>(source[component]))
      expect(restored[component]).toHaveLength(source[component].length)
    }
    expect((await readNativeProvenance(db)).provenance_edges).toEqual([])
  })

  it('derives a new embedding set from its retained native configuration', async () => {
    const source = records as unknown as NativeState
    await db.transaction((tx) => applyValidatedNativeEmbeddings(tx, {
      ...source, embedding_sets: [], embedding_set_members: [], embeddings: [],
      embedding_configs: source.embedding_configs.map((row) => ({ ...row, model: 'retained-native-model' })),
    }))
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    for (const set of source.embedding_sets.filter((row) => row.embedding_config_id !== null)) {
      const config = source.embedding_configs.find((row) => row.id === set.embedding_config_id)!
      expect((await db.query('SELECT model_name, dimensions FROM embedding_set WHERE id = $1', [set.id])).rows)
        .toEqual([{ model_name: 'retained-native-model', dimensions: set.truncate_dim ?? config.dimension }])
    }
  })

  it('rolls back a skip import whose vectors conflict with the retained native configuration', async () => {
    const source = records as unknown as NativeState
    await db.transaction((tx) => applyValidatedNativeEmbeddings(tx, {
      ...source, embedding_sets: [], embedding_set_members: [], embeddings: [],
      embedding_configs: source.embedding_configs.map((row) => ({ ...row, dimension: row.dimension + 1 })),
    }))
    const input = await modifiedArchive({ embedding_sets: source.embedding_sets.map((row) => ({ ...row, truncate_dim: null })) })
    const result = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'skip' })
    expect(result.success).toBe(false)
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
    expect((await db.query('SELECT * FROM native_shard_lineage')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('restores a new revision derivation whose source note already exists', async () => {
    const source = records as unknown as NativeState
    const existing = source.notes.find((note) => note.id !== source.note_revisions[0].note_id)!
    expect(existing).toBeDefined()
    await db.transaction((tx) => applyValidatedNativeCore(tx,
      { notes: [{ ...existing, attachments: [] }], collections: source.collections, tags: [], templates: [], links: [] },
      { note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [] }))
    const edges = source.provenance_edges.map((row) => ({ ...row, source_note_id: existing.id }))
    const input = await modifiedArchive({ provenance_edges: edges })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    expect((await readNativeProvenance(db)).provenance_edges).toEqual(edges)
  })

  it('restores a new community set under a skipped graph source without restoring its removed edges', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec('DELETE FROM community_set; DELETE FROM graph_edge_artifact')
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    const restored = await readNativeGraph(db)
    expect(restored.graph_edges).toEqual([])
    expect(restored.communities).toEqual((records as unknown as NativeState).communities)
    const assignments = (records as unknown as NativeState).community_assignments
    expect(restored.community_assignments).toEqual(expect.arrayContaining(assignments))
    expect(restored.community_assignments).toHaveLength(assignments.length)
  })

  it('preserves native member vector references and rejects omission of a still-referenced vector', async () => {
    const source = records as unknown as NativeState
    const vector = source.embeddings.find((row) => source.embedding_set_members.some((member) => member.note_id === row.note_id && member.embedding_set_id === row.embedding_set_id))!
    expect(vector).toBeDefined()
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.query('UPDATE embedding_set_member SET embedding_id = $1 WHERE note_id = $2 AND embedding_set_id = $3', [vector.id, vector.note_id, vector.embedding_set_id])
    const repository = new EmbeddingSetsRepository(db)
    const members = await repository.listMembers(vector.embedding_set_id!)
    expect(members.some((member) => member.embedding_id === vector.id)).toBe(true)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await repository.listMembers(vector.embedding_set_id!)).toEqual(members)
    }
    const before = await current()
    const omission = await modifiedArchive({ embeddings: source.embeddings.filter((row) => row.id !== vector.id) })
    expect((await importShard(db, omission, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
    expect(await current()).toEqual(before)
    expect(await repository.listMembers(vector.embedding_set_id!)).toEqual(members)
  })

  it('invalidates materialized note references when a retained vector changes owner', async () => {
    const source = records as unknown as NativeState
    const vector = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
    const other = source.notes.find((row) => row.id !== vector.note_id)!
    const otherSet = { ...source.embedding_sets.find((row) => row.id === vector.embedding_set_id)!,
      id: crypto.randomUUID(), name: 'Reparented vector source', slug: 'reparented-vector-source' }
    const embeddingSets = [...source.embedding_sets, otherSet]
    const seed = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: [vector] })
    expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const repository = new EmbeddingSetsRepository(db)
    const virtual = await repository.createVirtualDefinition({
      id: crypto.randomUUID(), name: 'Original note materialization',
      source: { type: 'criteria', baseSetId: vector.embedding_set_id!, criteria: { noteIds: [vector.note_id!] } },
      compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-set-order', missingVectors: 'omit' },
      materialization: { allowed: true, freshness: 'unknown' },
    })
    const selector = { kind: 'embedding-set' as const, embeddingSetId: virtual.id }
    expect((await repository.resolveSelector(selector)).noteIds).toEqual([vector.note_id])
    for (const destination of [
      { note_id: other.id, embedding_set_id: vector.embedding_set_id },
      { note_id: null, embedding_set_id: vector.embedding_set_id },
      { note_id: vector.note_id, embedding_set_id: otherSet.id },
      { note_id: vector.note_id, embedding_set_id: null },
      { note_id: vector.note_id, embedding_set_id: vector.embedding_set_id },
    ]) {
      const unchanged = destination.note_id === vector.note_id && destination.embedding_set_id === vector.embedding_set_id
      expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      await repository.refreshMaterializedVirtualSet(virtual.id)
      const beforeMembers = await repository.listMembers(virtual.id)
      expect(beforeMembers.some((row) => row.embedding_id === vector.id)).toBe(true)
      const input = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: [{ ...vector, ...destination }] })
      const before = await current()
      const membersBeforeFailure = await repository.listMembers(virtual.id)
      const virtualBeforeFailure = await repository.get(virtual.id)
      const rejected = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
        if (event.phase === 'index' && event.done === 0) throw new Error('injected note reparent rollback')
      } })
      expect(rejected.success).toBe(false)
      expect(await current()).toEqual(before)
      expect(await repository.listMembers(virtual.id)).toEqual(membersBeforeFailure)
      expect(await repository.get(virtual.id)).toEqual(virtualBeforeFailure)
      for (let pass = 0; pass < 2; pass++) {
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        const members = await repository.listMembers(virtual.id)
        expect(members).toEqual(beforeMembers.map((row) => ({ ...row,
          embedding_id: destination.note_id === vector.note_id ? row.embedding_id : null })))
        const resolved = await repository.resolveSelector(selector)
        expect(resolved.noteIds).toEqual(unchanged ? [vector.note_id] : [])
        expect(resolved.resolutionSource).toBe(unchanged ? 'materialized' : 'live')
        expect(resolved.freshness.status).toBe(unchanged ? 'fresh' : 'stale')
      }
    }
  })

  it.each(['criteria', 'set-operation', 'fallback', 'latest-compatible', 'snapshot'] as const)(
    'invalidates %s materializations when uncached vectors enter a source set', async (type) => {
      const source = records as unknown as NativeState
      const vector = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
      const other = source.notes.find((row) => row.id !== vector.note_id)!
      const base = source.embedding_sets.find((row) => row.id === vector.embedding_set_id)!
      const target = { ...base, id: crypto.randomUUID(), name: 'Incoming vector set', slug: 'incoming-vector-set' }
      const unrelated = { ...base, id: crypto.randomUUID(), name: 'Unrelated vector set', slug: 'unrelated-vector-set' }
      const embeddingSets = [...source.embedding_sets, target, unrelated]
      const resident = { ...vector, id: crypto.randomUUID(), note_id: other.id, embedding_set_id: target.id }
      const definitionSource = (setId: string): VirtualEmbeddingSetSource => {
        switch (type) {
          case 'criteria': return { type, baseSetId: setId, criteria: {} }
          case 'set-operation': return { type, operation: 'union', setIds: [setId] }
          case 'fallback': return { type, preferredSetIds: [setId] }
          case 'latest-compatible': return { type, candidateSetIds: [setId] }
          case 'snapshot': return { type, snapshotId: setId, sourceDefinitionId: crypto.randomUUID(),
            generatedAt: '2026-09-11T00:00:00.000Z', inputHash: 'source-entry' }
        }
      }
      const repository = new EmbeddingSetsRepository(db)
      const seedArchive = (vectors: NativeState['embeddings']) => modifiedArchive({ embedding_sets: embeddingSets, embeddings: vectors })
      expect((await importShard(db, await seedArchive([vector]), { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const virtuals = []
      for (const setId of [target.id, unrelated.id]) virtuals.push(await repository.createVirtualDefinition({
        id: crypto.randomUUID(), name: `Entry ${type} ${setId}`, source: definitionSource(setId),
        compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-set-order', missingVectors: 'omit' },
        materialization: { allowed: true, freshness: 'unknown' },
      }))
      const selector = { kind: 'embedding-set' as const, embeddingSetId: virtuals[0].id }
      for (const populated of [false, true]) for (const insertion of [false, true]) {
        // Drop cached pointers before resetting this test's physical seed.
        for (const set of virtuals) await db.query('DELETE FROM embedding_set_member WHERE embedding_set_id = $1', [set.id])
        const seedVectors = [...(insertion ? [] : [vector]), ...(populated ? [resident] : [])]
        const seed = await seedArchive(seedVectors)
        expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        for (const set of virtuals) await repository.refreshMaterializedVirtualSet(set.id)
        const beforeMembers = await repository.listMembers(virtuals[0].id)
        expect(beforeMembers.some((row) => row.embedding_id === vector.id)).toBe(false)
        const beforeVirtuals = await Promise.all(virtuals.map((set) => repository.get(set.id)))
        // Identical imports must not invalidate otherwise fresh materializations.
        expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        expect(await Promise.all(virtuals.map((set) => repository.get(set.id)))).toEqual(beforeVirtuals)
        const input = await seedArchive([{ ...vector, embedding_set_id: target.id }, ...(populated ? [resident] : [])])
        const before = await current()
        const rejected = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
          if (event.phase === 'index' && event.done === 0) throw new Error('injected selector entry rollback')
        } })
        expect(rejected.success).toBe(false)
        expect(await current()).toEqual(before)
        expect(await repository.listMembers(virtuals[0].id)).toEqual(beforeMembers)
        expect(await Promise.all(virtuals.map((set) => repository.get(set.id)))).toEqual(beforeVirtuals)
        for (let pass = 0; pass < 2; pass++) {
          expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
          const resolved = await repository.resolveSelector(selector)
          expect(resolved.noteIds.sort()).toEqual([vector.note_id!, ...(populated ? [other.id] : [])].sort())
          expect(resolved.resolutionSource).toBe('live')
          expect(resolved.freshness.status).toBe('stale')
          expect(await repository.listMembers(virtuals[0].id)).toEqual(beforeMembers)
          expect(await repository.get(virtuals[1].id)).toEqual(beforeVirtuals[1])
        }
        await repository.refreshMaterializedVirtualSet(virtuals[0].id)
        const refreshed = await repository.get(virtuals[0].id)
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        expect(await repository.get(virtuals[0].id)).toEqual(refreshed)
        expect((await repository.resolveSelector(selector)).resolutionSource).toBe('materialized')
      }
    })

  it.each([false, true])('invalidates newly matching note criteria from null note: %s', async (nullNote) => {
    const source = records as unknown as NativeState
    const vector = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
    const other = source.notes.find((row) => row.id !== vector.note_id)!
    const seed = await modifiedArchive({ embeddings: [{ ...vector, note_id: nullNote ? null : vector.note_id }] })
    expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const repository = new EmbeddingSetsRepository(db)
    const virtual = await repository.createVirtualDefinition({ id: crypto.randomUUID(), name: 'Newly matching note criteria',
      source: { type: 'criteria', baseSetId: vector.embedding_set_id!, criteria: { noteIds: [other.id] } },
      compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-set-order', missingVectors: 'omit' },
      materialization: { allowed: true, freshness: 'unknown' } })
    const selector = { kind: 'embedding-set' as const, embeddingSetId: virtual.id }
    expect((await repository.resolveSelector(selector)).noteIds).toEqual([])
    expect((await repository.resolveSelector(selector)).resolutionSource).toBe('materialized')
    const input = await modifiedArchive({ embeddings: [{ ...vector, note_id: other.id }] })
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const resolved = await repository.resolveSelector(selector)
      expect(resolved.noteIds).toEqual([other.id])
      expect(resolved.resolutionSource).toBe('live')
      expect(resolved.freshness.status).toBe('stale')
    }
  })

  it.each(['null-to-value', 'value-to-null', 'value-to-value', 'newer-vector', 'equivalent-vector', 'equivalent-time'] as const)(
    'keeps materialized selectors coherent for same-owner %s replacement', async (mode) => {
      const source = records as unknown as NativeState
      const original = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
      const vector = { ...original, vector: mode === 'null-to-value' ? null : Array(768).fill(0.1), created_at: '2026-09-09T00:00:00.000Z' }
      const duplicate = { ...vector, id: crypto.randomUUID(), chunk_index: vector.chunk_index + 1, created_at: '2026-09-10T00:00:00.000Z' }
      const additional = mode === 'newer-vector' ? [duplicate] : []
      const unrelated = { ...source.embedding_sets.find((row) => row.id === vector.embedding_set_id)!,
        id: crypto.randomUUID(), name: 'Unrelated value source', slug: 'unrelated-value-source' }
      const embeddingSets = [...source.embedding_sets, unrelated]
      const seed = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: [vector, ...additional] })
      const replacement = { ...vector,
        vector: mode === 'value-to-null' ? null : Array(768).fill(mode === 'value-to-value' ? 0.25 : mode === 'equivalent-vector' ? Math.fround(0.1) : 0.1),
        created_at: mode === 'newer-vector' ? '2026-09-11T00:00:00.000Z' : mode === 'equivalent-time' ? '2026-09-08T20:00:00-04:00' : vector.created_at }
      const input = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: [replacement, ...additional] })
      expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const repository = new EmbeddingSetsRepository(db)
      const virtuals: EmbeddingSetRow[] = []
      for (const setId of [vector.embedding_set_id!, unrelated.id]) virtuals.push(await repository.createVirtualDefinition({
        id: crypto.randomUUID(), name: `Value ${mode} ${setId}`,
        source: { type: 'criteria', baseSetId: setId, criteria: { noteIds: [vector.note_id!] } },
        compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-latest', missingVectors: 'omit' },
        materialization: { allowed: true, freshness: 'unknown' },
      }))
      const snapshot = async () => ({ native: await current(),
        virtuals: await Promise.all(virtuals.map((set) => repository.get(set.id))),
        members: await Promise.all(virtuals.map((set) => repository.listMembers(set.id))) })
      const before = await snapshot()
      if (mode === 'newer-vector') expect(before.members[0][0].embedding_id).toBe(duplicate.id)
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
      expect(await snapshot()).toEqual(before)
      const rejected = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
        if (event.phase === 'index' && event.done === 0) throw new Error('injected same-owner vector rollback')
      } })
      expect(rejected.success).toBe(false)
      expect(await snapshot()).toEqual(before)
      const unchanged = mode.startsWith('equivalent-')
      for (let pass = 0; pass < 2; pass++) {
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        const resolved = await repository.resolveSelector({ kind: 'embedding-set', embeddingSetId: virtuals[0].id })
        const live = await repository.resolveSelector({ kind: 'virtual-definition', definition: {
          id: virtuals[0].id, name: virtuals[0].name,
          source: { type: 'criteria', baseSetId: vector.embedding_set_id!, criteria: { noteIds: [vector.note_id!] } },
          compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-latest', missingVectors: 'omit' },
        } })
        expect(resolved.rows).toEqual(live.rows)
        expect(resolved.embeddingIds).toEqual(mode === 'value-to-null' ? [] : [vector.id])
        expect(resolved.freshness.status).toBe(unchanged ? 'fresh' : 'stale')
        expect(resolved.resolutionSource).toBe(unchanged ? 'materialized' : 'live')
        expect(await repository.listMembers(virtuals[0].id)).toEqual(before.members[0])
        expect(await repository.get(virtuals[1].id)).toEqual(before.virtuals[1])
        if (unchanged) expect(await repository.get(virtuals[0].id)).toEqual(before.virtuals[0])
      }
      await repository.refreshMaterializedVirtualSet(virtuals[0].id)
      const refreshed = await snapshot()
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await snapshot()).toEqual(refreshed)
    })

  it.each(['difference', 'intersection', 'empty-difference'] as const)(
    'invalidates %s materializations after omitted uncached vectors are removed', async (mode) => {
      const source = records as unknown as NativeState
      const vector = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
      const base = source.embedding_sets.find((row) => row.id === vector.embedding_set_id)!
      const other = { ...base, id: crypto.randomUUID(), name: 'Omitted secondary vector source', slug: 'omitted-secondary-vector-source' }
      const unrelated = { ...base, id: crypto.randomUUID(), name: 'Unrelated omission source', slug: 'unrelated-omission-source' }
      const secondary = { ...vector, id: crypto.randomUUID(), embedding_set_id: other.id }
      const embeddingSets = [...source.embedding_sets, other, unrelated]
      const seed = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: [vector, secondary] })
      const input = await modifiedArchive({ embedding_sets: embeddingSets, embeddings: mode === 'empty-difference' ? [] : [vector] })
      expect((await importShard(db, seed, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const repository = new EmbeddingSetsRepository(db)
      const operation = mode === 'intersection' ? 'intersection' : 'difference'
      const definition: VirtualEmbeddingSetDefinition = { id: crypto.randomUUID(), name: `Omission ${mode}`,
        source: { type: 'set-operation' as const, operation, setIds: [base.id, other.id] },
        compatibility: { model: 'require-same' as const, dimension: 'require-same' as const, duplicateVectors: 'prefer-set-order' as const, missingVectors: 'omit' as const },
        materialization: { allowed: true, freshness: 'unknown' as const } }
      const virtual = await repository.createVirtualDefinition(definition)
      const unrelatedVirtual = await repository.createVirtualDefinition({ ...definition, id: crypto.randomUUID(), name: 'Unrelated omission cache',
        source: { type: 'criteria', baseSetId: unrelated.id, criteria: {} } })
      const snapshot = async () => ({ native: await current(), virtual: await repository.get(virtual.id),
        members: await repository.listMembers(virtual.id), unrelated: await repository.get(unrelatedVirtual.id) })
      const before = await snapshot()
      expect(before.members.some((row) => row.embedding_id === secondary.id)).toBe(false)
      const rejected = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
        if (event.phase === 'index' && event.done === 0) throw new Error('injected omission cache rollback')
      } })
      expect(rejected.success).toBe(false)
      expect(await snapshot()).toEqual(before)
      for (let pass = 0; pass < 2; pass++) {
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        const resolved = await repository.resolveSelector({ kind: 'embedding-set', embeddingSetId: virtual.id })
        expect(resolved.embeddingIds).toEqual(mode === 'difference' ? [vector.id] : [])
        expect(resolved.freshness.status).toBe('stale')
        expect(resolved.resolutionSource).toBe('live')
        expect(await repository.listMembers(virtual.id)).toEqual(before.members)
        expect(await repository.get(unrelatedVirtual.id)).toEqual(before.unrelated)
      }
      await repository.refreshMaterializedVirtualSet(virtual.id)
      const refreshed = await snapshot()
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await snapshot()).toEqual(refreshed)
    })

  it.each(['tags', 'starred', 'archived', 'title', 'source', 'format', 'updated-at', 'deleted', 'collection',
    'current-content', 'attachment-text', 'ai-metadata', 'generation', 'user-edit', 'config-model', 'compatibility-error', 'set-ordering'] as const)(
    'reconciles materialized native %s inputs through public import', async (mode) => {
      const seed = structuredClone(records) as unknown as NativeState
      const vector = seed.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null && row.vector !== null)!
      seed.embeddings = [vector]
      const note = seed.notes.find((row) => row.id === vector.note_id)!
      const peer = seed.notes.find((row) => row.id !== note.id)!
      const set = seed.embedding_sets.find((row) => row.id === vector.embedding_set_id)!
      const config = seed.embedding_configs.find((row) => row.id === set.embedding_config_id)!
      const currentRevision = seed.note_revised_current.find((row) => row.note_id === note.id)!
      const revision = seed.note_revisions.find((row) => row.id === currentRevision.last_revision_id)!
      const criteria: EmbeddingSetCriteria = { noteIds: [note.id] }
      let source: VirtualEmbeddingSetSource = { type: 'criteria', baseSetId: set.id, criteria }
      if (mode === 'tags') criteria.tags = [note.tags[0]]
      if (mode === 'starred') { note.starred = true; criteria.isStarred = true }
      if (mode === 'archived') { note.archived = false; criteria.isArchived = false }
      if (mode === 'title') criteria.hasTitle = true
      if (mode === 'source') criteria.sources = [note.source]
      if (mode === 'format') criteria.formats = [note.format]
      if (mode === 'updated-at') { note.updated_at = '2026-09-09T00:00:00.000Z'; criteria.updatedBefore = '2026-09-10T00:00:00.000Z' }
      if (mode === 'collection') criteria.collectionIds = [note.collection_id!]
      if (mode === 'current-content') { currentRevision.content = 'selectormatchword'; revision.content = currentRevision.content; note.revised_content = currentRevision.content; criteria.query = 'selectormatchword' }
      if (mode === 'attachment-text') { Object.assign(note.attachments[0], { extracted_text: 'selectormatchword', extraction_status: 'extracted', reason: null }); criteria.query = 'selectormatchword' }
      if (mode === 'ai-metadata') { currentRevision.ai_metadata = { fixture: true }; criteria.hasAiMetadata = true }
      if (mode === 'generation') { revision.generation_count = 5; criteria.minGenerationCount = 3 }
      if (mode === 'user-edit') { revision.is_user_edited = true; criteria.isUserEdited = true }
      if (mode === 'config-model') source = { type: 'latest-compatible', candidateSetIds: [set.id], model: config.model }
      let otherSetId: string | undefined
      if (mode === 'compatibility-error' || mode === 'set-ordering') {
        const otherConfig = { ...config, id: crypto.randomUUID(), name: `Other ${mode} config`, is_default: false }
        const otherSet = { ...set, id: crypto.randomUUID(), name: `Other ${mode} source`, slug: `other-${mode}-source`, embedding_config_id: otherConfig.id,
          updated_at: '2026-09-10T00:00:00.000Z' }
        set.updated_at = '2026-09-09T00:00:00.000Z'
        seed.embedding_configs.push(otherConfig); seed.embedding_sets.push(otherSet); otherSetId = otherSet.id
        source = mode === 'compatibility-error' ? { type: 'set-operation', operation: 'union', setIds: [set.id, otherSet.id] }
          : { type: 'latest-compatible', candidateSetIds: [set.id, otherSet.id] }
        if (mode === 'set-ordering') seed.embeddings.push({ ...vector, id: crypto.randomUUID(), embedding_set_id: otherSet.id })
      }
      const changed = structuredClone(seed)
      const changedNote = changed.notes.find((row) => row.id === note.id)!
      const changedCurrent = changed.note_revised_current.find((row) => row.note_id === note.id)!
      const changedRevision = changed.note_revisions.find((row) => row.id === revision.id)!
      if (mode === 'tags') changedNote.tags = []
      if (mode === 'starred') changedNote.starred = false
      if (mode === 'archived') changedNote.archived = true
      if (mode === 'title') changedNote.title = null
      if (mode === 'source') changedNote.source = 'changed-selector-source'
      if (mode === 'format') changedNote.format = 'html'
      if (mode === 'updated-at') changedNote.updated_at = '2026-09-11T00:00:00.000Z'
      if (mode === 'deleted') changedNote.deleted_at = '2026-09-11T00:00:00.000Z'
      if (mode === 'collection') changedNote.collection_id = null
      if (mode === 'current-content') { changedCurrent.content = 'differentword'; changedRevision.content = changedCurrent.content; changedNote.revised_content = changedCurrent.content }
      if (mode === 'attachment-text') changedNote.attachments[0].extracted_text = 'differentword'
      if (mode === 'ai-metadata') changedCurrent.ai_metadata = null
      if (mode === 'generation') changedRevision.generation_count = 1
      if (mode === 'user-edit') changedRevision.is_user_edited = false
      if (mode === 'config-model') changed.embedding_configs.find((row) => row.id === config.id)!.model = 'changed-selector-model'
      if (mode === 'compatibility-error') {
        const other = changed.embedding_sets.find((row) => row.id === otherSetId)!
        changed.embedding_configs.find((row) => row.id === other.embedding_config_id)!.model = 'changed-selector-model'
      }
      if (mode === 'set-ordering') changed.embedding_sets.find((row) => row.id === set.id)!.updated_at = '2026-09-11T00:00:00.000Z'
      const archives = [await modifiedArchive(seed), await modifiedArchive(changed)]
      expect((await importShard(db, archives[0], { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const repository = new EmbeddingSetsRepository(db)
      const definition: VirtualEmbeddingSetDefinition = { id: crypto.randomUUID(), name: `Native ${mode}`, source,
        compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-set-order', missingVectors: 'omit' },
        materialization: { allowed: true, freshness: 'unknown' } }
      const virtual = await repository.createVirtualDefinition(definition)
      const unrelated = await repository.createVirtualDefinition({ ...definition, id: crypto.randomUUID(), name: `Unrelated ${mode}`,
        source: { type: 'criteria', baseSetId: set.id, criteria: { noteIds: [peer.id] } } })
      expect((await repository.resolveSelector({ kind: 'embedding-set', embeddingSetId: virtual.id })).noteIds).toEqual([note.id])
      const snapshot = async () => ({ native: await current(), virtual: await repository.get(virtual.id), members: await repository.listMembers(virtual.id), unrelated: await repository.get(unrelated.id) })
      for (const direction of [1, 0]) {
        const before = await snapshot()
        const input = archives[direction]
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
        expect(await snapshot()).toEqual(before)
        const rejected = await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
          if (event.phase === 'index' && event.done === 0) throw new Error('injected native selector rollback')
        } })
        expect(rejected.success).toBe(false)
        expect(await snapshot()).toEqual(before)
        for (let pass = 0; pass < 2; pass++) {
          expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
          const resolved = await repository.resolveSelector({ kind: 'embedding-set', embeddingSetId: virtual.id })
          const live = await repository.resolveSelector({ kind: 'virtual-definition', definition })
          expect(live.noteIds).toEqual(direction === 0 || mode === 'compatibility-error' || mode === 'set-ordering' ? [note.id] : [])
          expect(live.errors.length).toBe(direction === 1 && mode === 'compatibility-error' ? 1 : 0)
          expect(resolved.rows).toEqual(live.rows)
          expect(resolved.errors).toEqual(live.errors)
          expect(resolved.freshness.status).toBe('stale')
          expect(resolved.resolutionSource).toBe('live')
          expect(await repository.listMembers(virtual.id)).toEqual(before.members)
          expect(await repository.get(unrelated.id)).toEqual(before.unrelated)
        }
        const refreshedResult = await repository.refreshMaterializedVirtualSet(virtual.id)
        const afterRefresh = await repository.resolveSelector({ kind: 'embedding-set', embeddingSetId: virtual.id })
        expect(afterRefresh.rows).toEqual(refreshedResult.rows)
        expect(afterRefresh.errors).toEqual(refreshedResult.errors)
        expect(afterRefresh.freshness.status).toBe(refreshedResult.errors.length ? 'stale' : 'fresh')
        if (refreshedResult.errors.length) expect(await repository.listMembers(virtual.id)).toEqual(before.members)
        const refreshed = await snapshot()
        expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
        expect(await snapshot()).toEqual(refreshed)
      }
    })

  it.each(['unsupported-criteria', 'missing-source', 'missing-set'] as const)(
    'preserves unrelated %s cache definitions during native import', async (mode) => {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const repository = new EmbeddingSetsRepository(db)
      const setId = (records as unknown as NativeState).embedding_sets[0].id
      const virtual = await repository.createVirtualDefinition({ id: crypto.randomUUID(), name: mode,
        source: { type: 'criteria', baseSetId: setId, criteria: {} },
        compatibility: { model: 'require-same', dimension: 'require-same', duplicateVectors: 'prefer-set-order', missingVectors: 'omit' },
        materialization: { allowed: true, freshness: 'unknown' } })
      const source = mode === 'missing-source' ? null : mode === 'missing-set'
        ? { type: 'latest-compatible', candidateSetIds: [crypto.randomUUID()] }
        : { type: 'criteria', baseSetId: setId, criteria: { conceptIds: [crypto.randomUUID()] } }
      await db.query('UPDATE embedding_set SET source_json = $2::jsonb WHERE id = $1', [virtual.id, JSON.stringify(source)])
      const before = { virtual: await repository.get(virtual.id), members: await repository.listMembers(virtual.id) }
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect({ virtual: await repository.get(virtual.id), members: await repository.listMembers(virtual.id) }).toEqual(before)
    })

  it('exchanges retained vector chunk coordinates without deleting identities or references', async () => {
    const source = records as unknown as NativeState
    const first = source.embeddings.find((row) => row.note_id !== null && row.embedding_set_id !== null)!
    const second = { ...first, id: crypto.randomUUID(), chunk_index: Math.max(...source.embeddings.map((row) => row.chunk_index)) + 1 }
    const vectors = [...source.embeddings, second]
    const input = await modifiedArchive({ embeddings: vectors })
    const replacement = await modifiedArchive({ embeddings: vectors.map((row) => ({ ...row,
      chunk_index: row.id === first.id ? second.chunk_index : row.id === second.id ? first.chunk_index : row.chunk_index })) })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_vector_reference (id TEXT REFERENCES embedding(id) ON DELETE RESTRICT);
      INSERT INTO protected_vector_reference SELECT id FROM embedding;`)
    const before = await current()
    const rejected = await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace', onProgress: (event) => {
      if (event.phase === 'index' && event.done === 0) throw new Error('injected post-vector rollback')
    } })
    expect(rejected.success).toBe(false)
    expect(await current()).toEqual(before)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM protected_vector_reference')).rows[0].count).toBe(vectors.length)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const rows = (await current()).embeddings
      expect(rows.find((row) => row.id === first.id)?.chunk_index).toBe(second.chunk_index)
      expect(rows.find((row) => row.id === second.id)?.chunk_index).toBe(first.chunk_index)
    }
    await expectPublicRoundTrip(await current())
  })

  it('preserves excluded-set and null-endpoint vectors while reconciling selected vector omissions', async () => {
    const source = records as unknown as NativeState
    const row = source.embeddings.find((embedding) => embedding.note_id !== null && embedding.embedding_set_id !== null)!
    const set = { ...source.embedding_sets.find((set) => set.id === row.embedding_set_id)!,
      id: crypto.randomUUID(), name: 'Excluded vector set', slug: 'excluded-vector-set' }
    const independent = [
      { ...row, id: crypto.randomUUID(), embedding_set_id: set.id },
      { ...row, id: crypto.randomUUID(), embedding_set_id: null },
      { ...row, id: crypto.randomUUID(), note_id: null },
      { ...row, id: crypto.randomUUID(), note_id: null, embedding_set_id: null },
    ]
    const input = await modifiedArchive({ embedding_sets: [...source.embedding_sets, set], embeddings: [...source.embeddings, ...independent] })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const replacement = await modifiedArchive({ embeddings: [] })
    await db.exec(`CREATE TABLE protected_vector_reference (id TEXT REFERENCES embedding(id) ON DELETE RESTRICT)`)
    for (const row of independent) await db.query('INSERT INTO protected_vector_reference VALUES ($1)', [row.id])
    const before = await current()
    const scoped = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, embeddingSetIds: [row.embedding_set_id!] })
    expect(scoped.errors).toEqual([])
    expect((await importShard(db, scoped.archive!, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    expect((await current()).embeddings).toEqual(before.embeddings)
    for (let pass = 0; pass < 2; pass++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const expected = [...source.embeddings.filter((row) => row.note_id === null || row.embedding_set_id === null), ...independent]
      expect((await current()).embeddings).toHaveLength(expected.length)
      expect((await current()).embeddings).toEqual(expect.arrayContaining(expected))
    }
    await expectPublicRoundTrip(await current())
  })

  it('preserves retained membership coordinates and external references on repeat replacement', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    await db.exec(`CREATE TABLE protected_member_reference (
      embedding_set_id TEXT, note_id TEXT,
      FOREIGN KEY (embedding_set_id, note_id) REFERENCES embedding_set_member(embedding_set_id, note_id) ON DELETE RESTRICT);
      INSERT INTO protected_member_reference SELECT embedding_set_id, note_id FROM embedding_set_member;`)
    const before = await current()
    expect(before.embedding_set_members.length).toBeGreaterThan(0)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      expect(await current()).toEqual(before)
    }
    await expectPublicRoundTrip(before)
  })

  it('reconciles membership omissions only with both note and set selected and rolls back rejected omissions', async () => {
    const source = records as unknown as NativeState
    const note = lineageNote('excluded-membership-note')
    const set = { ...source.embedding_sets[0], id: crypto.randomUUID(), name: 'Excluded membership set', slug: 'excluded-membership-set' }
    const member = source.embedding_set_members[0]
    const outsideMembers = [
      { ...member, note_id: note.id },
      { ...member, embedding_set_id: set.id },
    ]
    const input = await modifiedArchive({ notes: [...source.notes, note], embedding_sets: [...source.embedding_sets, set],
      embedding_set_members: [...source.embedding_set_members, ...outsideMembers] })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    const replacement = await modifiedArchive({ embedding_set_members: [] })
    await db.exec(`CREATE TABLE protected_member_reference (
      embedding_set_id TEXT, note_id TEXT,
      FOREIGN KEY (embedding_set_id, note_id) REFERENCES embedding_set_member(embedding_set_id, note_id) ON DELETE RESTRICT);
      INSERT INTO protected_member_reference SELECT embedding_set_id, note_id FROM embedding_set_member;`)
    expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
    expect(await current()).toEqual(before)
    await db.query('DELETE FROM protected_member_reference WHERE note_id != $1 AND embedding_set_id != $2', [note.id, set.id])
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.embedding_set_members).toHaveLength(outsideMembers.length)
      expect(after.embedding_set_members).toEqual(expect.arrayContaining(outsideMembers))
    }
    await expectPublicRoundTrip(await current())
  })

  it('preserves excluded-note vectors and memberships when replacing a scoped note in a shared set', async () => {
    const source = records as unknown as NativeState
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const selectedId = source.embeddings[0].note_id!
    const excludedId = source.notes.find((note) => note.id !== selectedId)!.id
    const setId = source.embedding_sets[0].id
    const sets = new EmbeddingSetsRepository(db)
    await sets.putEmbedding({ note_id: excludedId, embedding_set_id: setId, vector: Array(768).fill(0.25) })
    const before = await readNativeEmbeddings(db)
    const excludedVectors = before.embeddings.filter((row) => row.note_id === excludedId)
    const excludedMembers = before.embedding_set_members.filter((row) => row.note_id === excludedId)
    expect(excludedVectors.length).toBeGreaterThan(0)
    expect(excludedMembers.length).toBeGreaterThan(0)
    await new TagsRepository(db).addTag(selectedId, 'replace-shared-set')
    const scoped = await exportShardWithReport(db, { profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, tag: 'replace-shared-set' })
    expect(scoped.errors).toEqual([])
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, scoped.archive!, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await readNativeEmbeddings(db)
      expect(after.embeddings.filter((row) => row.note_id === excludedId)).toEqual(excludedVectors)
      expect(after.embedding_set_members.filter((row) => row.note_id === excludedId)).toEqual(excludedMembers)
    }
  })

  it.each(['retained', 'reparented', 'renumbered'] as const)('preserves an unrelated capture reference when its selected activity is %s', async (mode) => {
    const source = records as unknown as NativeState
    const note = lineageNote('external-capture-owner')
    const capture = { ...source.provenance_records[0], id: crypto.randomUUID(), note_id: note.id, attachment_id: null }
    expect(capture.activity_id).not.toBeNull()
    const input = await modifiedArchive({ notes: [...source.notes, note], provenance_records: [...source.provenance_records, capture] })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    expect(before.provenance_records).toContainEqual(capture)
    let replacement: Uint8Array = archive
    if (mode === 'reparented') {
      const activity = source.provenance_activities.find((row) => row.id === capture.activity_id)!
      const revision = source.note_revisions.find((row) => row.note_id === activity.note_id && row.id !== activity.revision_id)!
      replacement = await modifiedArchive({
        notes: source.notes.map((note) => note.id === revision.note_id ? { ...note, revised_content: revision.content } : note),
        note_revisions: source.note_revisions.filter((row) => row.id !== activity.revision_id),
        note_revised_current: source.note_revised_current.map((row) => row.note_id === revision.note_id ? { ...row, content: revision.content, last_revision_id: revision.id } : row),
        provenance_activities: source.provenance_activities.map((row) => row.id === activity.id ? { ...row, revision_id: revision.id } : row),
        provenance_edges: source.provenance_edges.map((row) => row.revision_id === activity.revision_id ? { ...row, revision_id: revision.id } : row),
      })
    } else if (mode === 'renumbered') {
      replacement = await modifiedArchive({ note_revisions: source.note_revisions.map((row) => ({ ...row, revision_number: row.revision_number + 1 })) })
    }
    await db.exec(`CREATE FUNCTION reject_external_capture_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic external-reference rollback'; END; $$;
      CREATE TRIGGER reject_external_capture_test BEFORE INSERT OR UPDATE ON community_assignment
        FOR EACH ROW EXECUTE FUNCTION reject_external_capture_test();`)
    const rejected = await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })
    expect(rejected.success).toBe(false)
    expect(rejected.errors).toEqual(['Native full-v1 transaction failed'])
    expect(await current()).toEqual(before)
    await db.exec('DROP TRIGGER reject_external_capture_test ON community_assignment; DROP FUNCTION reject_external_capture_test();')
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.notes).toContainEqual(note)
      expect(after.provenance_records.find((row) => row.id === capture.id)).toEqual(capture)
      await expectPublicRoundTrip(after)
    }
  }, 30_000)

  it.each(['retained-source', 'independent-source', 'reparented-selected-set', 'empty-family'] as const)('preserves unrelated set assignments to imported notes during %s replacement', async (mode) => {
    const source = records as unknown as NativeState
    const externalSource = { ...source.graph_sources[0], id: 'external-assignment-source' }
    const externalSet = { ...source.communities[0], id: 'external-assignment-set',
      graph_source_id: mode === 'independent-source' ? externalSource.id : source.graph_sources[0].id }
    const externalAssignments = source.community_assignments.map((row) => ({ ...row, community_set_id: externalSet.id }))
      .sort((a, b) => a.note_id.localeCompare(b.note_id))
    const externalEdges = source.graph_edges.map((row) => ({ ...row, graph_source_id: externalSource.id }))
    const input = await modifiedArchive({
      graph_sources: mode === 'independent-source' ? [...source.graph_sources, externalSource] : source.graph_sources,
      graph_edges: mode === 'independent-source' ? [...source.graph_edges, ...externalEdges] : source.graph_edges,
      communities: [...source.communities, externalSet],
      community_assignments: [...source.community_assignments, ...externalAssignments],
    })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const before = await current()
    expect(before.community_assignments.filter((row) => row.community_set_id === externalSet.id)).toEqual(externalAssignments)
    let replacement: Uint8Array = archive
    if (mode === 'reparented-selected-set') {
      const nextSource = { ...source.graph_sources[0], id: 'replacement-assignment-source' }
      replacement = await modifiedArchive({ graph_sources: [nextSource],
        graph_edges: source.graph_edges.map((row) => ({ ...row, graph_source_id: nextSource.id })),
        communities: source.communities.map((row) => ({ ...row, graph_source_id: nextSource.id })),
      })
    } else if (mode === 'empty-family') {
      replacement = await modifiedArchive({ graph_sources: [], graph_edges: [], communities: [], community_assignments: [] })
    }
    if (mode !== 'empty-family') {
      await db.exec(`CREATE FUNCTION reject_assignment_owner_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic assignment-owner rollback'; END; $$;
        CREATE TRIGGER reject_assignment_owner_test BEFORE INSERT OR UPDATE ON community_assignment
          FOR EACH ROW EXECUTE FUNCTION reject_assignment_owner_test();`)
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(false)
      expect(await current()).toEqual(before)
      await db.exec('DROP TRIGGER reject_assignment_owner_test ON community_assignment; DROP FUNCTION reject_assignment_owner_test();')
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, replacement, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.communities.find((row) => row.id === externalSet.id)).toEqual(externalSet)
      expect(after.community_assignments.filter((row) => row.community_set_id === externalSet.id)).toEqual(externalAssignments)
      if (mode === 'independent-source') {
        expect(after.graph_sources).toContainEqual(externalSource)
        expect(after.graph_edges.filter((row) => row.graph_source_id === externalSource.id)).toEqual(externalEdges)
      } else if (mode === 'empty-family') {
        for (const component of ['graph_sources', 'graph_edges', 'communities', 'community_assignments'] as const) expect(after[component]).toEqual(before[component])
      } else if (mode === 'reparented-selected-set') {
        expect(after.communities.find((row) => row.id === source.communities[0].id)!.graph_source_id).toBe('replacement-assignment-source')
      }
      await expectPublicRoundTrip(after)
    }
  }, 30_000)

  it.each(['history', 'skos', 'graph', 'embeddings', 'links', 'attachments'] as const)('reconciles omitted %s children repeatedly while preserving unrelated roots', async (family) => {
    const source = records as unknown as NativeState
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
    const unrelatedNote = await new NotesRepository(db).create({ content: 'Unrelated native owner' })
    const unrelatedConcept = await new SkosRepository(db).createConcept(source.skos_schemes[0].id, 'Unrelated concept')
    const unrelatedCommunity = await new CommunitiesRepository(db).saveCommunity({ name: 'Unrelated community', sourceType: 'user-authored', noteIds: [unrelatedNote.id] })
    await new SkosRepository(db).tagNote(unrelatedNote.id, unrelatedConcept.id)
    await new EmbeddingSetsRepository(db).putEmbedding({ note_id: unrelatedNote.id, embedding_set_id: source.embedding_sets[0].id, vector: Array(768).fill(0.25) })
    await new LinksRepository(db).create(unrelatedNote.id, source.notes[0].id, 'related')
    await new AttachmentsRepository(db, blobs).attach({ noteId: unrelatedNote.id, data: new TextEncoder().encode('Unrelated owner bytes'), filename: 'unrelated.txt', mimeType: 'text/plain' })
    const before = await current()
    const changes: Partial<NativeState> = family === 'history' ? {
      note_originals: [], note_original_history: [], note_revised_current: [], note_revisions: [],
      provenance_activities: [], provenance_edges: [],
      provenance_records: source.provenance_records.map((row) => ({ ...row, activity_id: null })),
    } : family === 'skos' ? {
      skos_labels: [], skos_notes: [], skos_relations: [], skos_mapping_relations: [],
      skos_scheme_memberships: [], skos_collection_members: [], note_skos_tags: [],
    } : family === 'graph' ? {
      graph_edges: [], community_assignments: [],
      communities: source.communities.map((set) => ({ ...set, communities: [] })),
    } : family === 'embeddings' ? { embeddings: [], embedding_set_members: [] }
      : family === 'links' ? { links: [] }
        : { notes: source.notes.map((note) => ({ ...note, attachments: [] })) }
    const input = await modifiedArchive(changes)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'replace' })).errors).toEqual([])
      const after = await current()
      expect(after.notes.find((row) => row.id === unrelatedNote.id)).toEqual(before.notes.find((row) => row.id === unrelatedNote.id))
      expect(after.skos_concepts.find((row) => row.id === unrelatedConcept.id)).toEqual(before.skos_concepts.find((row) => row.id === unrelatedConcept.id))
      expect(after.communities.find((row) => row.id === unrelatedCommunity.id)).toEqual(before.communities.find((row) => row.id === unrelatedCommunity.id))
      expect(after.embeddings.filter((row) => row.note_id === unrelatedNote.id)).toEqual(before.embeddings.filter((row) => row.note_id === unrelatedNote.id))
      expect(after.links.filter((row) => row.from_note_id === unrelatedNote.id)).toEqual(before.links.filter((row) => row.from_note_id === unrelatedNote.id))
      expect(after.note_skos_tags.filter((row) => row.note_id === unrelatedNote.id)).toEqual(before.note_skos_tags.filter((row) => row.note_id === unrelatedNote.id))
      expect(after.skos_labels.filter((row) => row.concept_id === unrelatedConcept.id)).toEqual(before.skos_labels.filter((row) => row.concept_id === unrelatedConcept.id))
      for (const [component, rows] of Object.entries(changes)) {
        if (rows.length === 0) {
          const original = source[component as keyof NativeState]
          for (const row of original) expect(after[component as keyof NativeState], component).not.toContainEqual(row)
        }
      }
      if (family === 'graph') for (const set of source.communities) expect(after.communities.find((row) => row.id === set.id)!.communities).toEqual([])
      if (family === 'attachments') for (const note of source.notes) expect(after.notes.find((row) => row.id === note.id)!.attachments).toEqual([])
      await expectPublicRoundTrip(after)
    }
  }, 30_000)

  it('upgrades populated revision uniqueness without weakening commit-time constraints', async () => {
    const legacy = await PGlite.create({ extensions: { vector } })
    try {
      await legacy.exec('CREATE EXTENSION vector')
      await new MigrationRunner(legacy).apply(allMigrations.filter((migration) => migration.version <= 31))
      expect((await importShard(legacy, archive, { blobStore: new MemoryBlobStore() })).errors).toEqual([])
      const before = await readNativeNoteHistory(legacy)
      await new MigrationRunner(legacy).apply(allMigrations)
      expect(await readNativeNoteHistory(legacy)).toEqual(before)
      expect((await legacy.query("SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = 'note_revision_note_id_revision_number_key'")).rows)
        .toEqual([{ condeferrable: true, condeferred: true }])
      let reachedCommit = false
      await expect(legacy.transaction(async (tx) => {
        await tx.query('UPDATE note_revision SET revision_number = $1 WHERE id = $2', [before.note_revisions[0].revision_number, before.note_revisions[1].id])
        reachedCommit = true
      })).rejects.toThrow()
      expect(reachedCommit).toBe(true)
      expect(await readNativeNoteHistory(legacy)).toEqual(before)
      await new NotesRepository(legacy).update(before.note_revisions[0].note_id, { content: 'Native edit after constraint upgrade' })
      const after = await readNativeNoteHistory(legacy)
      expect(after.note_revisions).toHaveLength(before.note_revisions.length + 1)
    } finally { await legacy.close() }
  })

  it.each(['skip', 'replace', 'error'] as const)('rolls back alternate-identity collisions under %s without changing the unrelated record', async (conflictStrategy) => {
    const source = records as unknown as NativeState
    const retained = { ...source.embedding_configs[0], id: crypto.randomUUID() }
    await db.transaction((tx) => applyValidatedNativeEmbeddings(tx, {
      embedding_configs: [retained], embedding_sets: [], embedding_set_members: [], embeddings: [],
    }))
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy })
    expect(result.success).toBe(false)
    expect((await readNativeEmbeddings(db)).embedding_configs).toEqual([retained])
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
    expect((await db.query('SELECT * FROM native_shard_record_lineage')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('preserves skipped concept-owned relations while restoring new collection membership to existing concepts', async () => {
    const source = records as unknown as NativeState
    await db.transaction((tx) => applyValidatedNativeSkos(tx, {
      ...source, note_skos_tags: [], skos_relations: [], skos_collections: [], skos_collection_members: [],
    }))
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    const restored = await readNativeSkos(db)
    expect(source.skos_relations.length).toBeGreaterThan(0)
    expect(restored.skos_relations).toEqual([])
    expect(source.skos_collection_members.length).toBeGreaterThan(0)
    expect(restored.skos_collection_members).toEqual(expect.arrayContaining(source.skos_collection_members))
    expect(restored.skos_collection_members).toHaveLength(source.skos_collection_members.length)
  })

  it('skips attachment-owned provenance when its owning note is skipped', async () => {
    const source = records as unknown as NativeState
    const owner = source.notes.find((note) => note.attachments.length > 0)!
    await db.transaction((tx) => applyValidatedNativeCore(tx,
      { notes: [{ ...owner, attachments: [] }], collections: source.collections, tags: [], templates: [], links: [] },
      { note_originals: [], note_original_history: [], note_revisions: [], note_revised_current: [] }))
    const input = await modifiedArchive({ provenance_records: source.provenance_records.map((row) => ({
      ...row, note_id: null, attachment_id: owner.attachments[0].attachment.id, activity_id: null,
    })) })
    expect((await importShard(db, input, { blobStore: blobs, conflictStrategy: 'skip' })).errors).toEqual([])
    expect((await readNativeProvenance(db)).provenance_records).toEqual([])
    expect((await db.query('SELECT id FROM attachment WHERE note_id = $1', [owner.id])).rows).toEqual([])
  })

  it('rolls back all native families and newly promoted bytes on a late graph failure', async () => {
    const unrelated = await new NotesRepository(db).create({ title: 'Unrelated', content: 'Preserved native content' })
    await db.exec(`CREATE FUNCTION reject_native_graph_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic late failure'; END; $$;
      CREATE TRIGGER reject_native_graph_test BEFORE INSERT ON community_assignment
        FOR EACH ROW EXECUTE FUNCTION reject_native_graph_test();`)
    const result = await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })
    expect(result.success).toBe(false)
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(true)
    expect((await db.query('SELECT id FROM note')).rows).toEqual([{ id: unrelated.id }])
    for (const table of ['collection', 'tag', 'template', 'skos_concept', 'provenance_record', 'graph_source', 'attachment_blob']) {
      expect((await db.query(`SELECT * FROM ${table}`)).rows, table).toEqual([])
    }
    for (const note of (records as unknown as NativeCore).notes) for (const { attachment } of note.attachments) {
      expect(await blobs.has(attachment.checksum)).toBe(false)
    }
  })

  it('does not trust an existing blob solely because its content-addressed key exists', async () => {
    const corrupt = new class extends MemoryBlobStore {
      override async has() { return true }
      override async read() { return new Uint8Array([0]) }
    }()
    expect((await importShard(db, archive, { blobStore: corrupt, conflictStrategy: 'replace' })).success).toBe(false)
    expect((await db.query('SELECT * FROM note')).rows).toEqual([])
  })

  it('removes omitted attachment-owned provenance on selected-note replacement', async () => {
    expect((await importShard(db, archive, { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    const attachment = (records as unknown as NativeCore).notes.flatMap((note) => note.attachments)[0].attachment
    await db.query('UPDATE provenance_record SET note_id = NULL, attachment_id = $1', [attachment.id])
    const changed = new Map(files)
    const spec = FULL_V1_COMPONENT_FILES.provenance_records
    const bytes = new TextEncoder().encode(spec.encoding === 'json-array' ? '[]' : '')
    changed.set(spec.file, bytes)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    manifest.counts.provenance_records = 0
    manifest.checksums[spec.file] = await sha256Hex(bytes)
    changed.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    changed.delete('signature.json')
    expect((await importShard(db, packTarGz(changed), { blobStore: blobs, conflictStrategy: 'replace' })).success).toBe(true)
    expect((await db.query('SELECT * FROM provenance_record')).rows).toEqual([])
  })
})
