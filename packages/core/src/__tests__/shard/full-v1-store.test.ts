import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryBlobStore } from '../../blob-store.js'
import { computeBlobHash } from '../../hash.js'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { AttachmentsRepository } from '../../repositories/attachments-repository.js'
import { NotesRepository } from '../../repositories/notes-repository.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import {
  FULL_V1_COMPONENT_FILES,
  validateFullV1ShardArchive,
} from '../../shard/schema-validator.js'
import type { DatabaseClient, QueryExecutor } from '../../storage-backend.js'
import {
  AllowlistTrustStore,
  SIGNATURE_ENTRY,
  signShard,
  verifyShardSignature,
} from '../../shard/shard-signature.js'

const sourceArchive = new Uint8Array(readFileSync(new URL(
  './fixtures/full-v1/server-full-v1-revision-19-v2.shard',
  import.meta.url,
)))

function schema2Archive(): Uint8Array {
  return sourceArchive
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

function parseComponent<T = Record<string, unknown>>(
  files: Map<string, Uint8Array>,
  path: string,
): T[] {
  const text = new TextDecoder().decode(files.get(path))
  if (path.endsWith('.json')) return JSON.parse(text) as T[]
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('complete PGlite 2.0.0/full-v1 persistence (#380)', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('verifies the local conformance implementation receipt', async () => {
    const receipt = JSON.parse(readFileSync(new URL(
      '../../../schemas/knowledge-shard-v2.implementation.receipt.json', import.meta.url,
    ), 'utf8')) as {
      status: string
      authority: { commit: string; schemaBundleSha256: string }
      sourceFixture: { path: string; sha256: string }
      archive: { path: string; bytes: number; sha256: string }
      implementation: Record<string, string>
    }
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    const packageRoot = new URL('../../../', import.meta.url)
    expect(receipt).toMatchObject({
      status: 'local-conformance-passed',
      authority: {
        commit: '6343bd899958445bbc7e7e87b0dc92a8429d5a06',
        schemaBundleSha256: '66dee80876c73fdc8756541c72e96ae189c098113a831c849d619381c4121c02',
      },
    })
    expect(digest(readFileSync(new URL(receipt.sourceFixture.path, packageRoot))))
      .toBe(receipt.sourceFixture.sha256)
    const archiveBytes = readFileSync(new URL(receipt.archive.path, packageRoot))
    expect(archiveBytes.byteLength).toBe(receipt.archive.bytes)
    expect(digest(archiveBytes)).toBe(receipt.archive.sha256)
    expect((await validateFullV1ShardArchive(archiveBytes)).valid).toBe(true)
    for (const [path, expected] of Object.entries(receipt.implementation)) {
      expect(digest(readFileSync(new URL(path, packageRoot))), path).toBe(expected)
    }
  })

  it('validates, persists all components and bytes, and converges on re-export', async () => {
    const archive = schema2Archive()
    expect((await validateFullV1ShardArchive(archive)).valid).toBe(true)
    const blobs = new MemoryBlobStore()
    const imported = await importShard(db, archive, {
      conflictStrategy: 'replace',
      blobStore: blobs,
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)

    const persisted = await db.query<{ components: number; records: number }>(
      `SELECT COUNT(DISTINCT component)::int AS components, COUNT(*)::int AS records
         FROM knowledge_shard_component_record
        WHERE schema_version = '2.0.0' AND profile = 'full-v1'`,
    )
    expect(Number(persisted.rows[0].components)).toBe(33)
    expect(Number(persisted.rows[0].records)).toBeGreaterThan(33)
    const blobRefs = await db.query<{ ref_count: number }>(
      'SELECT ref_count FROM knowledge_shard_blob_reference',
    )
    expect(blobRefs.rows.map((row) => Number(row.ref_count))).toEqual([2])

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: blobs,
    })
    expect(
      exported.success,
      JSON.stringify({ errors: exported.errors, losses: exported.capability_report.losses }),
    ).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)

    const destination = await createDb()
    const destinationBlobs = new MemoryBlobStore()
    const first = await importShard(destination, exported.archive!, {
      conflictStrategy: 'replace',
      blobStore: destinationBlobs,
    })
    const second = await importShard(destination, exported.archive!, {
      conflictStrategy: 'replace',
      blobStore: destinationBlobs,
    })
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    const returned = await exportShardWithReport(destination, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: destinationBlobs,
    })
    expect(returned.success).toBe(true)

    const firstFiles = unpackTarGz(exported.archive!)
    const returnedFiles = unpackTarGz(returned.archive!)
    expect([...returnedFiles.keys()].sort()).toEqual([...firstFiles.keys()].sort())
    for (const [path, bytes] of firstFiles) {
      expect(returnedFiles.get(path), path).toEqual(bytes)
    }
    await destination.close()
  }, 30_000)

  it('produces and converges a complete full-v1 archive from live PGlite state', async () => {
    const blobs = new MemoryBlobStore()
    const note = await new NotesRepository(db).create({
      title: 'Live full-v1 source',
      content: 'Authoritative live content',
      tags: ['portable', 'pglite'],
    })
    const attachment = await new AttachmentsRepository(db, blobs).attach({
      noteId: note.id,
      data: new TextEncoder().encode('LIVE-FULL-V1-BLOB'),
      filename: 'evidence.txt',
      mimeType: 'text/plain',
      extractedText: 'Live full-v1 evidence',
    })

    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: blobs,
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)

    const files = unpackTarGz(exported.archive!)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as {
      producer: { name: string }
      components: string[]
    }
    expect(manifest.producer.name).toBe('fortemi-react-live-pglite')
    expect(manifest.components).toHaveLength(33)
    for (const spec of Object.values(FULL_V1_COMPONENT_FILES)) {
      expect(files.has(spec.file), spec.file).toBe(true)
    }
    const original = JSON.parse(
      new TextDecoder().decode(files.get('note_originals.jsonl')).split('\n')[0],
    ) as { note_id: string; content: string }
    expect(original).toMatchObject({
      note_id: note.id,
      content: 'Authoritative live content',
    })
    const exportedNote = JSON.parse(
      new TextDecoder().decode(files.get('notes.jsonl')).split('\n')[0],
    ) as { attachments: Array<{ attachment: { id: string; checksum: string } }> }
    expect(exportedNote.attachments[0].attachment.id).toBe(attachment.id)
    const checksum = exportedNote.attachments[0].attachment.checksum
    const bareChecksum = checksum.slice(checksum.indexOf(':') + 1)
    expect(files.get(`blobs/${bareChecksum}`)).toEqual(
      new TextEncoder().encode('LIVE-FULL-V1-BLOB'),
    )

    const destination = await createDb()
    const destinationBlobs = new MemoryBlobStore()
    const first = await importShard(destination, exported.archive!, {
      conflictStrategy: 'replace',
      blobStore: destinationBlobs,
    })
    const second = await importShard(destination, exported.archive!, {
      conflictStrategy: 'replace',
      blobStore: destinationBlobs,
    })
    expect(first.success, first.errors.join('; ')).toBe(true)
    expect(second.success, second.errors.join('; ')).toBe(true)
    expect((await destination.query<{ ref_count: number }>(
      'SELECT ref_count FROM knowledge_shard_blob_reference',
    )).rows.map((row) => Number(row.ref_count))).toEqual([1])

    const returned = await exportShardWithReport(destination, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: destinationBlobs,
    })
    expect(returned.success, returned.errors.join('; ')).toBe(true)
    const returnedFiles = unpackTarGz(returned.archive!)
    expect([...returnedFiles.keys()].sort()).toEqual([...files.keys()].sort())
    for (const [path, bytes] of files) {
      expect(returnedFiles.get(path), path).toEqual(bytes)
    }
    await destination.close()
  }, 30_000)

  it('honors tag scope for live full-v1 export, attachment bytes, history, and provenance', async () => {
    const blobs = new MemoryBlobStore()
    const included = await new NotesRepository(db).create({
      title: 'Included scoped note',
      content: 'INCLUDED-TAG-CONTENT',
      tags: ['selected'],
    })
    const excluded = await new NotesRepository(db).create({
      title: 'Excluded scoped note',
      content: 'EXCLUDED-TAG-CONTENT',
      tags: ['blocked'],
    })
    await new AttachmentsRepository(db, blobs).attach({
      noteId: included.id,
      data: new TextEncoder().encode('INCLUDED-TAG-BLOB'),
      filename: 'included.txt',
      mimeType: 'text/plain',
    })
    await new AttachmentsRepository(db, blobs).attach({
      noteId: excluded.id,
      data: new TextEncoder().encode('EXCLUDED-TAG-BLOB'),
      filename: 'excluded.txt',
      mimeType: 'text/plain',
    })
    await db.query(
      `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at)
       VALUES ($1, 'note', $2, 'created', 'scope-test', '2026-07-22T18:00:00.000Z')`,
      [crypto.randomUUID(), included.id],
    )
    await db.query(
      `INSERT INTO provenance_edge (id, entity_type, entity_id, activity, agent, started_at)
       VALUES ($1, 'note', $2, 'created', 'scope-test', '2026-07-22T18:01:00.000Z')`,
      [crypto.randomUUID(), excluded.id],
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: blobs,
      tag: 'selected',
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const files = unpackTarGz(exported.archive!)
    const notes = parseComponent<{ id: string; attachments: unknown[] }>(files, 'notes.jsonl')
    expect(notes.map((note) => note.id)).toEqual([included.id])
    expect(parseComponent<{ name: string }>(files, 'tags.json').map((tag) => tag.name)).toEqual(['selected'])
    expect(parseComponent<{ note_id: string }>(files, 'note_originals.jsonl').map((row) => row.note_id))
      .toEqual([included.id])
    expect(parseComponent<{ note_id: string }>(files, 'note_revised_current.jsonl').map((row) => row.note_id))
      .toEqual([included.id])
    expect(parseComponent<{ note_id: string }>(files, 'provenance_activities.jsonl').map((row) => row.note_id))
      .toEqual([included.id])
    const fileText = [...files.entries()]
      .filter(([path]) => !path.startsWith('blobs/'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join('\n')
    expect(fileText).toContain('INCLUDED-TAG-CONTENT')
    expect(fileText).not.toContain('EXCLUDED-TAG-CONTENT')
    const sidecars = [...files.entries()]
      .filter(([path]) => path.startsWith('blobs/'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
    expect(sidecars).toEqual(['INCLUDED-TAG-BLOB'])
    expect(sidecars).not.toContain('EXCLUDED-TAG-BLOB')

    const destination = await createDb()
    const imported = await importShard(destination, exported.archive!, {
      conflictStrategy: 'replace',
      blobStore: new MemoryBlobStore(),
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    const restoredNotes = await destination.query<{ id: string }>(
      `SELECT record_json->>'id' AS id
         FROM knowledge_shard_component_record
        WHERE schema_version = '2.0.0' AND profile = 'full-v1' AND component = 'notes'`,
    )
    expect(restoredNotes.rows.map((row) => row.id)).toEqual([included.id])
    await destination.close()
  }, 30_000)

  it('honors collection scope for live full-v1 note history and relationships', async () => {
    const included = await new NotesRepository(db).create({
      content: 'INCLUDED-COLLECTION-CONTENT',
    })
    const excluded = await new NotesRepository(db).create({
      content: 'EXCLUDED-COLLECTION-CONTENT',
    })
    const collectionId = crypto.randomUUID()
    await db.query(
      `INSERT INTO collection (id, name, created_at, updated_at)
       VALUES ($1, 'Scoped collection', '2026-07-22T18:00:00.000Z', '2026-07-22T18:00:00.000Z')`,
      [collectionId],
    )
    await db.query(
      `INSERT INTO collection_note (collection_id, note_id)
       VALUES ($1, $2)`,
      [collectionId, included.id],
    )
    await db.query(
      `INSERT INTO link (id, source_note_id, target_note_id, link_type)
       VALUES ($1, $2, $3, 'related')`,
      [crypto.randomUUID(), included.id, excluded.id],
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
      collectionId,
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const files = unpackTarGz(exported.archive!)
    expect(parseComponent<{ id: string }>(files, 'notes.jsonl').map((note) => note.id))
      .toEqual([included.id])
    expect(parseComponent<{ note_id: string }>(files, 'note_originals.jsonl').map((row) => row.note_id))
      .toEqual([included.id])
    expect(parseComponent(files, 'links.jsonl')).toEqual([])
    const fileText = [...files.values()].map((bytes) => new TextDecoder().decode(bytes)).join('\n')
    expect(fileText).toContain('INCLUDED-COLLECTION-CONTENT')
    expect(fileText).not.toContain('EXCLUDED-COLLECTION-CONTENT')
  }, 30_000)

  it('honors embedding-set scope without broadening full-v1 embedding components', async () => {
    const first = await new NotesRepository(db).create({ content: 'First embedding set note' })
    const second = await new NotesRepository(db).create({ content: 'Second embedding set note' })
    const selectedSetId = crypto.randomUUID()
    const excludedSetId = crypto.randomUUID()
    await db.query(
      `INSERT INTO embedding_set (id, model_name, dimensions, name)
       VALUES ($1, 'model-a', 384, 'Selected set')`,
      [selectedSetId],
    )
    await db.query(
      `INSERT INTO embedding_set (id, model_name, dimensions, name)
       VALUES ($1, 'model-b', 384, 'Excluded set')`,
      [excludedSetId],
    )
    await db.query(
      `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
       VALUES ($1, $2, NULL)`,
      [selectedSetId, first.id],
    )
    await db.query(
      `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
       VALUES ($1, $2, NULL)`,
      [excludedSetId, second.id],
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
      embeddingSetIds: [selectedSetId],
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const files = unpackTarGz(exported.archive!)
    expect(parseComponent<{ id: string }>(files, 'embedding_sets.json').map((set) => set.id))
      .toEqual([selectedSetId])
    expect(parseComponent<{ embedding_set_id: string; note_id: string }>(
      files,
      'embedding_set_members.jsonl',
    )).toEqual([
      expect.objectContaining({ embedding_set_id: selectedSetId, note_id: first.id }),
    ])
    const fileText = [...files.values()].map((bytes) => new TextDecoder().decode(bytes)).join('\n')
    expect(fileText).toContain('Selected set')
    expect(fileText).not.toContain('Excluded set')
    expect(fileText).not.toContain(excludedSetId)
  }, 30_000)

  it.each([
    { tag: 'no-such-tag' },
    { collectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  ])('preserves no-match note scope through clean snapshot import: %j', async (scope) => {
    const blobs = new MemoryBlobStore()
    const excluded = await new NotesRepository(db).create({ content: 'NO-MATCH-EXCLUDED', tags: ['outside'] })
    await new AttachmentsRepository(db, blobs).attach({
      noteId: excluded.id, data: new TextEncoder().encode('NO-MATCH-BLOB'),
      filename: 'excluded.txt', mimeType: 'text/plain',
    })
    const result = await exportShardWithReport(db, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs, ...scope,
    })
    expect(result.success, result.errors.join('; ')).toBe(true)
    expect((await validateFullV1ShardArchive(result.archive!)).valid).toBe(true)
    const files = unpackTarGz(result.archive!)
    for (const path of ['notes.jsonl', 'note_originals.jsonl', 'note_revisions.jsonl',
      'note_revised_current.jsonl', 'links.jsonl', 'provenance_activities.jsonl']) {
      expect(parseComponent(files, path), path).toEqual([])
    }
    expect([...files.keys()].filter((path) => path.startsWith('blobs/'))).toEqual([])
    expect([...files.values()].map((bytes) => new TextDecoder().decode(bytes)).join('\n'))
      .not.toContain('NO-MATCH-EXCLUDED')
    const destination = await createDb()
    try {
      const destinationBlobs = new MemoryBlobStore()
      const imported = await importShard(destination, result.archive!, {
        conflictStrategy: 'replace', blobStore: destinationBlobs,
      })
      expect(imported.success, imported.errors.join('; ')).toBe(true)
      expect(await destinationBlobs.read(computeBlobHash(new TextEncoder().encode('NO-MATCH-BLOB')))).toBeNull()
      const restored = await exportShardWithReport(destination, {
        profile: 'full-v1', schemaVersion: '2.0.0', blobStore: destinationBlobs,
      })
      expect(restored.success, restored.errors.join('; ')).toBe(true)
      expect(parseComponent(unpackTarGz(restored.archive!), 'notes.jsonl')).toEqual([])
    } finally { await destination.close() }
  }, 30_000)

  it('emits no embedding sets for a nonmatching set selector without treating it as a note filter', async () => {
    const note = await new NotesRepository(db).create({ content: 'Still selected without a note filter' })
    const excludedSetId = crypto.randomUUID()
    await db.query(
      "INSERT INTO embedding_set (id, model_name, dimensions, name) VALUES ($1, 'excluded-model', 384, 'Excluded set')",
      [excludedSetId],
    )
    await db.query(
      'INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id) VALUES ($1, $2, NULL)',
      [excludedSetId, note.id],
    )
    const result = await exportShardWithReport(db, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: new MemoryBlobStore(),
      embeddingSetIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    })
    expect(result.success, result.errors.join('; ')).toBe(true)
    expect((await validateFullV1ShardArchive(result.archive!)).valid).toBe(true)
    const files = unpackTarGz(result.archive!)
    expect(parseComponent<{ id: string }>(files, 'notes.jsonl').map((row) => row.id)).toEqual([note.id])
    expect(parseComponent(files, 'embedding_sets.json')).toEqual([])
    expect(parseComponent(files, 'embedding_set_members.jsonl')).toEqual([])
    expect(parseComponent(files, 'embeddings.jsonl')).toEqual([])
  }, 30_000)

  it.each([
    { tag: 'selected', collectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { tag: '' }, { collectionId: '' }, { embeddingSetIds: [] }, { embeddingSetIds: [''] },
  ])('rejects unsupported full-v1 scope before reading live or snapshot data: %j', async (scope) => {
    const unreadableDb = { query: () => { throw new Error('scope validation read the database') } } as unknown as DatabaseClient
    const result = await exportShardWithReport(unreadableDb, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: new MemoryBlobStore(), ...scope,
    })
    expect(result.success).toBe(false)
    expect(result.archive).toBeNull()
    expect(result.errors.join('; ')).toContain('nonempty scope selectors')
  })

  it('signs a full-v1 archive produced directly from live PGlite state', async () => {
    await new NotesRepository(db).create({ content: 'Signed live state' })
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign', 'verify',
    ])) as CryptoKeyPair
    const publicKey = bytesToBase64url(new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey),
    ))
    const trustStore = new AllowlistTrustStore([{
      key_id: 'live-full-v1-test',
      public_key: publicKey,
    }])
    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
      signing: {
        keyId: 'live-full-v1-test',
        privateKey: keyPair.privateKey,
        publicKey,
      },
    })

    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect(await verifyShardSignature({
      files: unpackTarGz(exported.archive!),
      trustStore,
    })).toEqual({ ok: true, keyId: 'live-full-v1-test' })
  }, 30_000)

  it('rejects live full-v1 production when attachment bytes are unavailable', async () => {
    const sourceBlobs = new MemoryBlobStore()
    const note = await new NotesRepository(db).create({ content: 'Missing blob source' })
    await new AttachmentsRepository(db, sourceBlobs).attach({
      noteId: note.id,
      data: new TextEncoder().encode('NOT-IN-EXPORT-STORE'),
      filename: 'missing.bin',
      mimeType: 'application/octet-stream',
    })

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
    })
    expect(exported.success).toBe(false)
    expect(exported.archive).toBeNull()
    expect(exported.errors.join('\n')).toContain(
      'BlobStore cannot reproduce mandatory live attachment',
    )
  })

  it('materializes live embedding, SKOS, provenance, graph, and community relationships', async () => {
    const first = await new NotesRepository(db).create({ content: 'First linked note' })
    const second = await new NotesRepository(db).create({ content: 'Second linked note' })
    const configId = crypto.randomUUID()
    const embeddingSetId = crypto.randomUUID()
    const schemeId = crypto.randomUUID()
    const conceptId = crypto.randomUUID()
    const graphId = crypto.randomUUID()
    const communitySetId = crypto.randomUUID()
    const communityId = crypto.randomUUID()
    const timestamp = '2026-07-22T18:00:00.000Z'

    await db.query(
      `INSERT INTO embedding_config (
         id, name, model, dimension, chunk_size, chunk_overlap, created_at, updated_at
       ) VALUES ($1, 'Portable config', 'portable-model', 768, 512, 64, $2, $2)`,
      [configId, timestamp],
    )
    await db.query(
      `INSERT INTO embedding_set (
         id, model_name, dimensions, name, slug, kind, mode, created_at, updated_at
       ) VALUES ($1, 'portable-model', 768, 'Portable set', 'portable-set',
         'physical', 'manual', $2, $2)`,
      [embeddingSetId, timestamp],
    )
    await db.query(
      `INSERT INTO embedding_set_member (
         embedding_set_id, note_id, embedding_id, membership_type, added_at, added_by
       ) VALUES ($1, $2, NULL, 'selected', $3, 'live-test')`,
      [embeddingSetId, first.id, timestamp],
    )
    await db.query(
      `INSERT INTO skos_scheme (id, title, description, created_at, updated_at)
       VALUES ($1, 'Portable taxonomy', 'Live SKOS state', $2, $2)`,
      [schemeId, timestamp],
    )
    await db.query(
      `INSERT INTO skos_concept (
         id, scheme_id, pref_label, alt_labels, definition, created_at, updated_at
       ) VALUES ($1, $2, 'Portability', '["Mobility"]'::jsonb,
         'Data moves without semantic loss', $3, $3)`,
      [conceptId, schemeId, timestamp],
    )
    await db.query(
      `INSERT INTO note_skos_tag (id, note_id, concept_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), first.id, conceptId, timestamp],
    )
    await db.query(
      `INSERT INTO provenance_edge (
         id, entity_type, entity_id, activity, agent, started_at, ended_at, attributes
       ) VALUES ($1, 'note', $2, 'created', 'fortemi-react', $3, $3,
         '{"source":"live-test"}'::jsonb)`,
      [crypto.randomUUID(), first.id, timestamp],
    )
    await db.query(
      `INSERT INTO graph_source (
         id, name, kind, source_table, embedding_set_id, model, dimension, metric,
         algorithm, input_hash, freshness_json, created_at
       ) VALUES ($1, 'Portable graph', 'similarity', 'embedding', $2,
         'portable-model', 768, 'cosine', 'knn', 'sha256:graph',
         '{"status":"fresh"}'::jsonb, $3)`,
      [graphId, embeddingSetId, timestamp],
    )
    await db.query(
      `INSERT INTO graph_edge_artifact (
         graph_source_id, from_note_id, to_note_id, weight, kind, rank, metadata_json
       ) VALUES ($1, $2, $3, 0.95, 'similarity', 1, NULL)`,
      [graphId, first.id, second.id],
    )
    await db.query(
      `INSERT INTO community_set (
         id, graph_source_id, name, source_type, algorithm, input_hash,
         freshness_json, created_at
       ) VALUES ($1, $2, 'Portable community', 'precomputed', 'leiden',
         'sha256:community', '{"status":"fresh"}'::jsonb, $3)`,
      [communitySetId, graphId, timestamp],
    )
    await db.query(
      `INSERT INTO community (
         id, community_set_id, label, rank, size, confidence,
         representative_note_ids, metadata_json
       ) VALUES ($1, $2, 'Portable', 1, 2, 0.99, $3, NULL)`,
      [communityId, communitySetId, [first.id]],
    )
    await db.query(
      `INSERT INTO community_assignment (
         community_set_id, community_id, note_id, confidence, source_type, metadata_json
       ) VALUES ($1, $2, $3, 0.99, 'precomputed', NULL)`,
      [communitySetId, communityId, first.id],
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
    })
    expect(
      exported.success,
      JSON.stringify({ errors: exported.errors, losses: exported.capability_report.losses }),
    ).toBe(true)
    expect((await validateFullV1ShardArchive(exported.archive!)).valid).toBe(true)
    const files = unpackTarGz(exported.archive!)
    const parse = (path: string) => {
      const text = new TextDecoder().decode(files.get(path))
      return path.endsWith('.jsonl')
        ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
        : JSON.parse(text)
    }
    expect(parse('embedding_configs.json')).toEqual([
      expect.objectContaining({ id: configId, created_at: timestamp, updated_at: timestamp }),
    ])
    expect(parse('embedding_sets.json')).toEqual([
      expect.objectContaining({ id: embeddingSetId, slug: 'portable-set' }),
    ])
    expect(parse('embedding_set_members.jsonl')).toEqual([
      expect.objectContaining({ embedding_set_id: embeddingSetId, note_id: first.id }),
    ])
    expect(parse('skos_labels.jsonl')).toEqual(expect.arrayContaining([
      expect.objectContaining({ concept_id: conceptId, value: 'Portability' }),
      expect.objectContaining({ concept_id: conceptId, value: 'Mobility' }),
    ]))
    expect(parse('skos_notes.jsonl')).toEqual([
      expect.objectContaining({ concept_id: conceptId, note_type: 'definition' }),
    ])
    expect(parse('provenance_activities.jsonl')).toEqual([
      expect.objectContaining({ note_id: first.id, activity_type: 'created' }),
    ])
    expect(parse('graph_edges.jsonl')).toEqual([
      expect.objectContaining({ graph_source_id: graphId, to_note_id: second.id }),
    ])
    expect(parse('community_assignments.jsonl')).toEqual([
      expect.objectContaining({ community_set_id: communitySetId, note_id: first.id }),
    ])
  }, 30_000)

  it('reports an exact typed loss for non-authority live embedding dimensions', async () => {
    const note = await new NotesRepository(db).create({ content: '384-dimensional state' })
    const embeddingSetId = crypto.randomUUID()
    const embeddingId = crypto.randomUUID()
    const vector384 = `[${new Array(384).fill(0).join(',')}]`
    await db.query(
      `INSERT INTO embedding_set (id, model_name, dimensions)
       VALUES ($1, 'all-MiniLM-L6-v2', 384)`,
      [embeddingSetId],
    )
    await db.query(
      `INSERT INTO embedding (id, note_id, embedding_set_id, vector)
       VALUES ($1, $2, $3, $4::vector)`,
      [embeddingId, note.id, embeddingSetId, vector384],
    )
    await db.query(
      `INSERT INTO embedding_set_member (embedding_set_id, note_id, embedding_id)
       VALUES ($1, $2, $3)`,
      [embeddingSetId, note.id, embeddingId],
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: new MemoryBlobStore(),
    })
    expect(exported.success).toBe(false)
    expect(exported.archive).toBeNull()
    expect(exported.capability_report.losses).toContainEqual({
      code: 'unrepresentable-live-embedding-dimension',
      component: 'embeddings',
      count: 1,
      field_path: '/vector',
      source_state: 'value',
      destination_capability: 'full-v1 requires exactly 768 vector dimensions',
      message: '1 embedding vector(s) have 384 dimensions',
      action: 'reject',
      reason: 'full-v1-live-production',
    })
  })

  it('retains a valid runtime signature over unchanged snapshot bytes', async () => {
    const files = unpackTarGz(schema2Archive())
    expect(files.has(SIGNATURE_ENTRY)).toBe(false)
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign', 'verify',
    ])) as CryptoKeyPair
    const publicKey = bytesToBase64url(new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey),
    ))
    files.set(SIGNATURE_ENTRY, await signShard({
      files,
      keyId: 'full-v1-runtime-test',
      privateKey: keyPair.privateKey,
      publicKey,
    }))
    const trustStore = new AllowlistTrustStore([{
      key_id: 'full-v1-runtime-test', public_key: publicKey,
    }])
    const signedArchive = packTarGz(files)
    const blobs = new MemoryBlobStore()
    const imported = await importShard(db, signedArchive, {
      conflictStrategy: 'replace', blobStore: blobs, trustStore, verifySignature: 'require',
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)
    const exported = await exportShardWithReport(db, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs,
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    expect(await verifyShardSignature({
      files: unpackTarGz(exported.archive!), trustStore,
    })).toEqual({ ok: true, keyId: 'full-v1-runtime-test' })
  }, 30_000)

  it.each([
    { tag: 'selected' },
    { collectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { embeddingSetIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] },
  ])('rejects scoped full-v1 export from persisted snapshots: %j', async (scope) => {
    const blobs = new MemoryBlobStore()
    const imported = await importShard(db, schema2Archive(), {
      conflictStrategy: 'replace',
      blobStore: blobs,
    })
    expect(imported.success, imported.errors.join('; ')).toBe(true)

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1',
      schemaVersion: '2.0.0',
      blobStore: blobs,
      ...scope,
    })
    expect(exported.success).toBe(false)
    expect(exported.archive).toBeNull()
    expect(exported.errors.join('\n')).toContain(
      'Persisted full-v1 snapshots cannot be filtered by collection, tag, or embedding set',
    )
  }, 30_000)

  it('rebuilds a valid unsigned archive when persisted component rows change', async () => {
    const blobs = new MemoryBlobStore()
    const imported = await importShard(db, schema2Archive(), {
      conflictStrategy: 'replace', blobStore: blobs,
    })
    expect(imported.success).toBe(true)
    await db.query(
      `UPDATE knowledge_shard_component_record
          SET record_json = jsonb_set(record_json, '{title}', '"Updated in PGlite"'::jsonb)
        WHERE schema_version = '2.0.0' AND profile = 'full-v1'
          AND component = 'notes' AND ordinal = 0`,
    )

    const exported = await exportShardWithReport(db, {
      profile: 'full-v1', schemaVersion: '2.0.0', blobStore: blobs,
    })
    expect(exported.success, exported.errors.join('; ')).toBe(true)
    const files = unpackTarGz(exported.archive!)
    expect(files.has(SIGNATURE_ENTRY)).toBe(false)
    expect((await validateFullV1ShardArchive(files)).valid).toBe(true)
    const firstNote = JSON.parse(new TextDecoder().decode(files.get('notes.jsonl')).split('\n')[0])
    expect(firstNote.title).toBe('Updated in PGlite')
  }, 30_000)

  it('rejects a corrupt archive before PGlite or BlobStore mutation', async () => {
    const files = unpackTarGz(schema2Archive())
    files.set('notes.jsonl', new TextEncoder().encode('{}'))
    const blobs = new MemoryBlobStore()
    const result = await importShard(db, packTarGz(files), {
      conflictStrategy: 'replace',
      blobStore: blobs,
    })
    expect(result.success).toBe(false)
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('rejects a referenced full-v1 blob when its mandatory sidecar is absent', async () => {
    const files = unpackTarGz(schema2Archive())
    const sidecar = [...files.keys()].find((path) => path.startsWith('blobs/'))!
    files.delete(sidecar)
    const archive = packTarGz(files)
    expect((await validateFullV1ShardArchive(archive)).errors.join('\n'))
      .toContain('is missing mandatory sidecar')

    const blobs = new MemoryBlobStore()
    const result = await importShard(db, archive, {
      conflictStrategy: 'replace', blobStore: blobs,
    })
    expect(result.success).toBe(false)
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })

  it('does not treat a different archive with the same tuple as identical', async () => {
    const blobs = new MemoryBlobStore()
    const first = await importShard(db, schema2Archive(), {
      conflictStrategy: 'replace', blobStore: blobs,
    })
    expect(first.success).toBe(true)

    const files = unpackTarGz(schema2Archive())
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as {
      created_at: string
    }
    manifest.created_at = '2026-07-22T23:59:59.000Z'
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
    const second = await importShard(db, packTarGz(files), {
      conflictStrategy: 'skip', blobStore: blobs,
    })
    expect(second.success).toBe(false)
    expect(second.errors.join('\n')).toContain('different full-v1 snapshot already exists')
  })

  it('rolls back PGlite rows and promoted blobs on transactional failure', async () => {
    const failingDb: DatabaseClient = {
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      transaction: <T>(fn: (tx: QueryExecutor) => Promise<T>) => db.transaction((tx) => fn({
        exec: tx.exec.bind(tx),
        query: async <R>(sql: string, params?: unknown[]) => {
          if (sql.includes('INSERT INTO knowledge_shard_component_record')) {
            throw new Error('injected component persistence failure')
          }
          return tx.query<R>(sql, params)
        },
      })),
    }
    const blobs = new MemoryBlobStore()
    const result = await importShard(failingDb, schema2Archive(), {
      conflictStrategy: 'replace',
      blobStore: blobs,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([
      'full-v1 transaction failed: injected component persistence failure',
    ])
    expect((await db.query('SELECT * FROM knowledge_shard_snapshot')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_file')).rows).toEqual([])
    expect((await db.query('SELECT * FROM knowledge_shard_component_record')).rows).toEqual([])
    expect((await blobs.reconcile([])).unreferenced).toEqual([])
  })
})
