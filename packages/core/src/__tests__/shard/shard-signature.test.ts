/**
 * Signed-shard verification (#324, ADR-014) — sign/verify round-trip, the
 * unsigned-shard policy matrix, and the full tampering suite (manifest,
 * component, blob, signature, signer substitution, revocation).
 *
 * Verification is exercised directly against the pure `verifyShardSignature`
 * and end-to-end through `importShard` to prove the verify-before-persist gate
 * (ADR-013 D6): a rejected shard writes nothing.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { MigrationRunner } from '../../migration-runner.js'
import { allMigrations } from '../../migrations/index.js'
import { exportShard } from '../../shard/shard-export.js'
import { importShard } from '../../shard/shard-import.js'
import { packTarGz, unpackTarGz } from '../../shard/shard-tar.js'
import {
  signShard,
  verifyShardSignature,
  AllowlistTrustStore,
  SIGNATURE_ENTRY,
  isShardSigningSupported,
} from '../../shard/shard-signature.js'
import { computeBlobHash } from '../../hash.js'
import { blobChecksumToHex } from '../../shard/blob-sidecar.js'

const KEY_ID = 'publisher-1'

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const b64 = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** Corrupt a base64url signature by flipping a raw byte, re-encoding valid b64url. */
function corruptSignatureB64url(sig: string): string {
  const bytes = base64urlToBytes(sig)
  bytes[0] ^= 0xff
  return bytesToBase64url(bytes)
}

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
    [`orig-${id}`, id, `${id} body`, `hash-${id}`],
  )
  await db.query(
    `INSERT INTO note_revised_current (note_id, content) VALUES ($1, $2)`,
    [id, `${id} body`],
  )
}

interface SignedFixture {
  signedArchive: Uint8Array
  files: Map<string, Uint8Array>
  publicKeyB64: string
  privateKey: CryptoKey
}

/** Export a real shard, sign it, and return the signed archive + parts. */
async function buildSignedShard(withBlob: boolean): Promise<SignedFixture> {
  const db = await setupDb()
  try {
    await insertNote(db, 'note-1')
    // Export produces manifest + components; we re-pack with the signature.
    const baseArchive = await exportShard(db)
    const files = unpackTarGz(baseArchive)

    if (withBlob) {
      const blob = new Uint8Array([1, 2, 3, 4])
      files.set(`blobs/${blobChecksumToHex(computeBlobHash(blob))}`, blob)
    }

    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
    const publicKeyB64 = bytesToBase64url(rawPub)

    const sigBytes = await signShard({
      files,
      keyId: KEY_ID,
      privateKey: keyPair.privateKey,
      publicKey: publicKeyB64,
    })
    files.set(SIGNATURE_ENTRY, sigBytes)

    return {
      signedArchive: packTarGz(files),
      files,
      publicKeyB64,
      privateKey: keyPair.privateKey,
    }
  } finally {
    await db.close()
  }
}

describe('signed shard verification (#324 / ADR-014)', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    expect(await isShardSigningSupported()).toBe(true) // Ed25519 in this runtime
  })

  it('verifies a validly signed shard', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(true)
    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    const verdict = await verifyShardSignature({ files, trustStore: trust })
    expect(verdict).toEqual({ ok: true, keyId: KEY_ID })
  })

  it('reports unsigned for a shard with no signature entry', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    files.delete(SIGNATURE_ENTRY)
    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    expect(await verifyShardSignature({ files, trustStore: trust })).toEqual({
      ok: false,
      reason: 'unsigned',
    })
  })

  it('rejects an unknown signer', async () => {
    const { files } = await buildSignedShard(false)
    const trust = new AllowlistTrustStore([]) // key_id not present
    const verdict = await verifyShardSignature({ files, trustStore: trust })
    expect(verdict).toMatchObject({ ok: false, reason: 'unknown-signer', keyId: KEY_ID })
  })

  it('rejects a revoked signer even with a valid signature', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    trust.revoke(KEY_ID)
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'revoked',
      keyId: KEY_ID,
    })
  })

  // ── Tampering suite ────────────────────────────────────────────────────────

  it('rejects manifest tampering (content-mismatch)', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    // Tamper the manifest, keeping valid JSON so the signature's
    // content-mismatch check is what rejects it.
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
    manifest.created_at = '2000-01-01T00:00:00.000Z'
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)))

    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'content-mismatch',
    })
  })

  it('rejects blob substitution (signed blob-digest set changes)', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(true)
    // Replace the sidecar blob with different bytes (new BLAKE3 → new entry name).
    for (const name of [...files.keys()]) {
      if (name.startsWith('blobs/')) files.delete(name)
    }
    const swapped = new Uint8Array([9, 9, 9, 9])
    files.set(`blobs/${blobChecksumToHex(computeBlobHash(swapped))}`, swapped)

    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'content-mismatch',
    })
  })

  it('rejects a corrupted signature (bad-signature)', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    const envelope = JSON.parse(new TextDecoder().decode(files.get(SIGNATURE_ENTRY)!))
    // Flip one base64url char in the signature.
    const sig = envelope.signature as string
    envelope.signature = corruptSignatureB64url(sig)
    files.set(SIGNATURE_ENTRY, new TextEncoder().encode(JSON.stringify(envelope)))

    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'bad-signature',
    })
  })

  it('rejects signer substitution (envelope key != trusted key)', async () => {
    const { files } = await buildSignedShard(false)
    const envelope = JSON.parse(new TextDecoder().decode(files.get(SIGNATURE_ENTRY)!))
    // Attacker swaps in their own public key under the trusted key_id.
    const attacker = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const attackerPub = bytesToBase64url(
      new Uint8Array(await crypto.subtle.exportKey('raw', attacker.publicKey)),
    )
    envelope.signer.public_key = attackerPub
    files.set(SIGNATURE_ENTRY, new TextEncoder().encode(JSON.stringify(envelope)))

    // Trust store still holds the ORIGINAL key for KEY_ID.
    const { publicKeyB64: originalPub } = await buildSignedShard(false)
    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: originalPub }])
    // Envelope key ≠ trusted key → rejected before crypto even runs.
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'bad-signature',
      keyId: KEY_ID,
    })
  })

  it('rejects a malformed (oversized/garbage) envelope', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    files.set(SIGNATURE_ENTRY, new TextEncoder().encode('{ not valid json'))
    const trust = new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }])
    expect(await verifyShardSignature({ files, trustStore: trust })).toMatchObject({
      ok: false,
      reason: 'malformed',
    })
  })

  // ── Import-gate integration (verify before persistence) ──────────────────────

  it('importShard require: a validly signed shard imports', async () => {
    const { signedArchive, publicKeyB64 } = await buildSignedShard(false)
    const db = await setupDb()
    try {
      const result = await importShard(db, signedArchive, {
        verifySignature: 'require',
        trustStore: new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }]),
      })
      expect(result.success).toBe(true)
      expect(result.counts.notes).toBe(1)
    } finally {
      await db.close()
    }
  })

  it('importShard require: a tampered shard is rejected and writes nothing', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    // Tamper the manifest while keeping it valid JSON, so the change is caught
    // by the signature's content-mismatch check (not the JSON parser).
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
    manifest.created_at = '2000-01-01T00:00:00.000Z'
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)))
    const tamperedArchive = packTarGz(files)

    const db = await setupDb()
    try {
      const result = await importShard(db, tamperedArchive, {
        verifySignature: 'require',
        trustStore: new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }]),
      })
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toMatch(/content-mismatch/)
      // Nothing persisted — the verify gate ran before any INSERT.
      const notes = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM note`)
      expect(notes.rows[0].count).toBe('0')
    } finally {
      await db.close()
    }
  })

  it('importShard require: an unsigned shard is rejected', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    files.delete(SIGNATURE_ENTRY)
    const db = await setupDb()
    try {
      const result = await importShard(db, packTarGz(files), {
        verifySignature: 'require',
        trustStore: new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }]),
      })
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toMatch(/unsigned/)
    } finally {
      await db.close()
    }
  })

  it('importShard prefer: an unsigned shard imports with a warning', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    files.delete(SIGNATURE_ENTRY)
    const db = await setupDb()
    try {
      const result = await importShard(db, packTarGz(files), {
        verifySignature: 'prefer',
        trustStore: new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }]),
      })
      expect(result.success).toBe(true)
      expect(result.warnings.join(' ')).toMatch(/unsigned.*prefer|prefer.*unsigned|NOT authenticated/i)
    } finally {
      await db.close()
    }
  })

  it('importShard prefer: a present-but-invalid signature is still rejected', async () => {
    const { files, publicKeyB64 } = await buildSignedShard(false)
    const envelope = JSON.parse(new TextDecoder().decode(files.get(SIGNATURE_ENTRY)!))
    const sig = envelope.signature as string
    envelope.signature = corruptSignatureB64url(sig)
    files.set(SIGNATURE_ENTRY, new TextEncoder().encode(JSON.stringify(envelope)))

    const db = await setupDb()
    try {
      const result = await importShard(db, packTarGz(files), {
        verifySignature: 'prefer',
        trustStore: new AllowlistTrustStore([{ key_id: KEY_ID, public_key: publicKeyB64 }]),
      })
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toMatch(/bad-signature/)
    } finally {
      await db.close()
    }
  })

  it('importShard trusted-local-only: skips verification with a warning', async () => {
    const { files } = await buildSignedShard(false)
    files.delete(SIGNATURE_ENTRY) // unsigned own-export
    const db = await setupDb()
    try {
      const result = await importShard(db, packTarGz(files), {
        verifySignature: 'trusted-local-only',
      })
      expect(result.success).toBe(true)
      expect(result.warnings.join(' ')).toMatch(/trusted-local-only/)
    } finally {
      await db.close()
    }
  })

  it('importShard: no policy → unchanged checksum-only behavior (unsigned imports)', async () => {
    const { files } = await buildSignedShard(false)
    files.delete(SIGNATURE_ENTRY)
    const db = await setupDb()
    try {
      const result = await importShard(db, packTarGz(files))
      expect(result.success).toBe(true)
      expect(result.warnings.join(' ')).not.toMatch(/signature|authenticated/i)
    } finally {
      await db.close()
    }
  })
})
