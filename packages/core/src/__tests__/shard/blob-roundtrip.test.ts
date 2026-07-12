/**
 * Portable Knowledge-Shard byte sidecar — round-trip integration tests.
 *
 * Verifies the #271 acceptance against the ratified contract
 * (`Fortemi/fortemi#1046`): a self-contained shard packs attachment bytes into
 * a content-addressed `blobs/<hex>` sidecar, and importing it with a BlobStore
 * hydrates the bytes so `getBlob()` returns them on a host with no origin
 * filesystem. Reference-only shards (no sidecar) remain valid and yield null.
 */

import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { MemoryBlobStore } from '../../blob-store.js'
import { AttachmentsRepository } from '../../repositories/attachments-repository.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { unpackTarGz } from '../../shard/shard-tar.js'
import { computeBlobHash } from '../../hash.js'
import { blobChecksumToHex, isSidecarEntry } from '../../shard/blob-sidecar.js'
import type { ShardNote } from '../../shard/types.js'

async function setupDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await new MigrationRunner(db).apply(allMigrations)
  return db
}

async function insertNote(db: PGlite, id: string): Promise<void> {
  await db.query(
    `INSERT INTO note (id, title, format, source, visibility, revision_mode)
     VALUES ($1, $2, 'markdown', 'user', 'private', 'standard')`,
    [id, id],
  )
  await db.query(
    `INSERT INTO note_original (id, note_id, content, content_hash) VALUES ($1, $2, $3, $4)`,
    [`orig-${id}`, id, `${id} original`, `hash-${id}`],
  )
  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, `${id} revised`],
  )
}

/** Deterministic binary payload (exercises all byte values, not just ASCII). */
function binaryPayload(seed: number, length = 600): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + seed) & 0xff
  return out
}

function parseNotes(archive: Uint8Array): ShardNote[] {
  const files = unpackTarGz(archive)
  const jsonl = files.get('notes.jsonl')
  if (!jsonl) return []
  return new TextDecoder()
    .decode(jsonl)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ShardNote)
}

describe('shard byte sidecar round-trip (#271 / Fortemi/fortemi#1046)', () => {
  it('attaches with a BLAKE3 content hash', async () => {
    const db = await setupDb()
    try {
      const blobStore = new MemoryBlobStore()
      const repo = new AttachmentsRepository(db, blobStore)
      await insertNote(db, 'note-1')

      const bytes = binaryPayload(1)
      const att = await repo.attach({ noteId: 'note-1', data: bytes, filename: 'doc.pdf' })

      const row = await db.query<{ content_hash: string }>(
        `SELECT content_hash FROM attachment_blob WHERE id = $1`,
        [att.blob_id],
      )
      expect(row.rows[0].content_hash).toBe(computeBlobHash(bytes))
      expect(row.rows[0].content_hash).toMatch(/^blake3:[0-9a-f]{64}$/)
    } finally {
      await db.close()
    }
  })

  it('round-trips attachment bytes through a self-contained shard', async () => {
    const src = await setupDb()
    const dst = await setupDb()
    try {
      const srcStore = new MemoryBlobStore()
      const srcRepo = new AttachmentsRepository(src, srcStore)
      await insertNote(src, 'note-1')

      const bytesA = binaryPayload(7)
      const bytesB = binaryPayload(99, 1200)
      const attA = await srcRepo.attach({ noteId: 'note-1', data: bytesA, filename: 'a.bin' })
      const attB = await srcRepo.attach({ noteId: 'note-1', data: bytesB, filename: 'b.bin' })

      const archive = await exportShard(src, { includeBlobs: true, blobStore: srcStore })

      // The archive carries content-addressed sidecar entries, and the record
      // `path` is the display filename — never a storage key.
      const files = unpackTarGz(archive)
      const sidecarNames = [...files.keys()].filter(isSidecarEntry)
      expect(sidecarNames).toContain(`blobs/${blobChecksumToHex(computeBlobHash(bytesA))}`)
      expect(sidecarNames).toContain(`blobs/${blobChecksumToHex(computeBlobHash(bytesB))}`)

      const notes = parseNotes(archive)
      const paths = (notes[0].attachments ?? []).map((a) => a.attachment.path).sort()
      expect(paths).toEqual(['a.bin', 'b.bin'])

      // Import into a pristine host (fresh db + fresh, empty BlobStore).
      const dstStore = new MemoryBlobStore()
      const dstRepo = new AttachmentsRepository(dst, dstStore)
      const result = await importShard(dst, archive, { blobStore: dstStore })
      expect(result.success).toBe(true)

      // getBlob() returns the exact original bytes on the importing host.
      expect(await dstRepo.getBlob(attA.id)).toEqual(bytesA)
      expect(await dstRepo.getBlob(attB.id)).toEqual(bytesB)
    } finally {
      await src.close()
      await dst.close()
    }
  })

  it('writes one sidecar entry per distinct blob (dedup)', async () => {
    const db = await setupDb()
    try {
      const store = new MemoryBlobStore()
      const repo = new AttachmentsRepository(db, store)
      await insertNote(db, 'note-1')

      const shared = binaryPayload(42)
      // Two attachments, identical bytes → one blob row, one sidecar entry.
      await repo.attach({ noteId: 'note-1', data: shared, filename: 'first.bin' })
      await repo.attach({ noteId: 'note-1', data: shared, filename: 'second.bin' })

      const archive = await exportShard(db, { includeBlobs: true, blobStore: store })
      const sidecarNames = [...unpackTarGz(archive).keys()].filter(isSidecarEntry)
      expect(sidecarNames).toEqual([`blobs/${blobChecksumToHex(computeBlobHash(shared))}`])
    } finally {
      await db.close()
    }
  })

  it('remains reference-only when no sidecar is exported', async () => {
    const src = await setupDb()
    const dst = await setupDb()
    try {
      const srcStore = new MemoryBlobStore()
      const srcRepo = new AttachmentsRepository(src, srcStore)
      await insertNote(src, 'note-1')
      const att = await srcRepo.attach({ noteId: 'note-1', data: binaryPayload(3), filename: 'c.bin' })

      // Default export (no includeBlobs) packs no bytes.
      const archive = await exportShard(src)
      expect([...unpackTarGz(archive).keys()].filter(isSidecarEntry)).toEqual([])

      const dstStore = new MemoryBlobStore()
      const dstRepo = new AttachmentsRepository(dst, dstStore)
      const result = await importShard(dst, archive, { blobStore: dstStore })

      expect(result.success).toBe(true)
      expect(await dstRepo.getBlob(att.id)).toBeNull()
      expect(result.warnings.join(' ')).toMatch(/reference/i)
    } finally {
      await src.close()
      await dst.close()
    }
  })
})
