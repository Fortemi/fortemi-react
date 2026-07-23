import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryBlobStore } from '../../blob-store.js'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { importShard } from '../../shard/shard-import.js'
import { exportShardWithReport } from '../../shard/shard-export.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import { validateFullV1ShardArchive } from '../../shard/schema-validator.js'
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

describe('complete PGlite 2.0.0/full-v1 persistence (#380)', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createDb()
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
    expect(exported.success, exported.errors.join('; ')).toBe(true)
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
