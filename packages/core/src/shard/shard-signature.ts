/**
 * Signed Knowledge-Shard verification (#324, ADR-014).
 *
 * Authenticity — as distinct from the consistency the in-archive checksums
 * provide (SEC7) — comes from an Ed25519 signature over a canonical payload
 * that commits to the manifest digest and the referenced blob-byte digests.
 * Verification is pure and side-effect-free; it runs BEFORE any record or
 * blob mutation (ADR-013 D6 / ADR-014 D3). Bytecask never sees keys.
 */

import { sha256Hex } from './checksum.js'
import { blobChecksumToHex, isSidecarEntry, SIDECAR_PREFIX } from './blob-sidecar.js'

export const SIGNATURE_ENTRY = 'signature.json'
export const SIGNING_ENVELOPE_VERSION = '1'
const SIGNING_ALGORITHM = 'ed25519'
/** Reject envelopes larger than this before parsing (hostile-input cap). */
const MAX_ENVELOPE_BYTES = 64 * 1024

// ── Envelope ────────────────────────────────────────────────────────────────

export interface ShardSigner {
  key_id: string
  algorithm: typeof SIGNING_ALGORITHM
  /** Raw 32-byte Ed25519 public key, base64url. */
  public_key: string
}

/** The signed payload (never contains its own signature — ADR-014 D2). */
export interface ShardSigningPayload {
  format_version: typeof SIGNING_ENVELOPE_VERSION
  signer: ShardSigner
  /** SHA-256 hex of the canonical manifest.json bytes. */
  manifest_digest: string
  /** Sorted bare-hex BLAKE3 digests of referenced sidecar blobs. */
  blob_digests: string[]
}

/** `signature.json` archive entry: the payload plus its base64url signature. */
export interface ShardSignatureEnvelope extends ShardSigningPayload {
  signature: string
}

// ── Trust store ─────────────────────────────────────────────────────────────

export interface TrustedKey {
  key_id: string
  /** Raw 32-byte Ed25519 public key, base64url. */
  public_key: string
  revoked?: boolean
}

export interface ShardTrustStore {
  resolve(keyId: string): TrustedKey | null | Promise<TrustedKey | null>
}

/** In-memory allowlist trust store seeded from `{ key_id, public_key }` entries. */
export class AllowlistTrustStore implements ShardTrustStore {
  private keys: Map<string, TrustedKey>
  constructor(keys: TrustedKey[]) {
    this.keys = new Map(keys.map((k) => [k.key_id, k]))
  }
  resolve(keyId: string): TrustedKey | null {
    return this.keys.get(keyId) ?? null
  }
  /** Mark a key revoked without removing it (still resolvable, verdict `revoked`). */
  revoke(keyId: string): void {
    const key = this.keys.get(keyId)
    if (key) this.keys.set(keyId, { ...key, revoked: true })
  }
}

// ── Verdict ─────────────────────────────────────────────────────────────────

export type ShardSignatureVerdict =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'unsigned' }
  | { ok: false; reason: 'malformed'; detail: string }
  | { ok: false; reason: 'unknown-signer'; keyId: string }
  | { ok: false; reason: 'revoked'; keyId: string }
  | { ok: false; reason: 'bad-signature'; keyId: string }
  | { ok: false; reason: 'content-mismatch'; detail: string }
  | { ok: false; reason: 'unsupported' }

// ── base64url ─────────────────────────────────────────────────────────────

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const b64 = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── Canonical payload serialization ─────────────────────────────────────────

/** Deterministic JSON: sorted keys, no whitespace — identical on every runtime. */
function canonicalPayloadBytes(payload: ShardSigningPayload): Uint8Array {
  const canonical = {
    blob_digests: [...payload.blob_digests].sort(),
    format_version: payload.format_version,
    manifest_digest: payload.manifest_digest,
    signer: {
      algorithm: payload.signer.algorithm,
      key_id: payload.signer.key_id,
      public_key: payload.signer.public_key,
    },
  }
  return new TextEncoder().encode(JSON.stringify(canonical))
}

// ── Capability probe ──────────────────────────────────────────────────────

let ed25519Supported: boolean | null = null

/** True when this runtime's WebCrypto verifies Ed25519 (ADR-014 D1). */
export async function isShardSigningSupported(): Promise<boolean> {
  if (ed25519Supported !== null) return ed25519Supported
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) {
      ed25519Supported = false
      return false
    }
    // A throwaway import proves algorithm support without a full sign round-trip.
    await subtle.importKey('raw', toBufferSource(new Uint8Array(32)), { name: 'Ed25519' }, false, ['verify'])
    ed25519Supported = true
  } catch {
    ed25519Supported = false
  }
  return ed25519Supported
}

// ── Blob-digest extraction ──────────────────────────────────────────────────

/** Sorted bare-hex BLAKE3 digests of the sidecar blobs present in the archive. */
export function sidecarBlobDigests(files: Map<string, Uint8Array>): string[] {
  const digests: string[] = []
  for (const name of files.keys()) {
    if (isSidecarEntry(name)) digests.push(name.slice(SIDECAR_PREFIX.length))
  }
  return digests.sort()
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface VerifyShardSignatureInput {
  files: Map<string, Uint8Array>
  trustStore: ShardTrustStore
}

/**
 * Verify a shard's Ed25519 signature over its canonical payload. Pure: reads
 * archive bytes, resolves the key, checks the signature and the
 * manifest/blob-digest commitments. No persistence, no mutation.
 */
export async function verifyShardSignature(
  input: VerifyShardSignatureInput,
): Promise<ShardSignatureVerdict> {
  const { files, trustStore } = input

  const sigBytes = files.get(SIGNATURE_ENTRY)
  if (!sigBytes) return { ok: false, reason: 'unsigned' }
  if (sigBytes.byteLength > MAX_ENVELOPE_BYTES) {
    return { ok: false, reason: 'malformed', detail: 'signature envelope exceeds size cap' }
  }

  let envelope: ShardSignatureEnvelope
  try {
    const parsed = JSON.parse(new TextDecoder().decode(sigBytes))
    if (!isEnvelopeShape(parsed)) throw new Error('unexpected envelope shape')
    envelope = parsed
  } catch (err) {
    return { ok: false, reason: 'malformed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (envelope.format_version !== SIGNING_ENVELOPE_VERSION) {
    return { ok: false, reason: 'malformed', detail: `unsupported envelope version ${envelope.format_version}` }
  }
  if (envelope.signer.algorithm !== SIGNING_ALGORITHM) {
    return { ok: false, reason: 'malformed', detail: `unsupported algorithm ${envelope.signer.algorithm}` }
  }

  const trusted = await trustStore.resolve(envelope.signer.key_id)
  if (!trusted) return { ok: false, reason: 'unknown-signer', keyId: envelope.signer.key_id }
  if (trusted.revoked) return { ok: false, reason: 'revoked', keyId: envelope.signer.key_id }
  // The trust store's public key is authoritative — a shard cannot assert its
  // own key. Verify against the trusted copy, not the envelope's.
  if (trusted.public_key !== envelope.signer.public_key) {
    return { ok: false, reason: 'bad-signature', keyId: envelope.signer.key_id }
  }

  if (!(await isShardSigningSupported())) return { ok: false, reason: 'unsupported' }

  // Cryptographic verification over the recomputed canonical payload hash.
  const payload: ShardSigningPayload = {
    format_version: envelope.format_version,
    signer: envelope.signer,
    manifest_digest: envelope.manifest_digest,
    blob_digests: envelope.blob_digests,
  }
  let signatureValid = false
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      toBufferSource(base64urlToBytes(trusted.public_key)),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const digest = await sha256Hex(canonicalPayloadBytes(payload))
    signatureValid = await globalThis.crypto.subtle.verify(
      'Ed25519',
      key,
      toBufferSource(base64urlToBytes(envelope.signature)),
      toBufferSource(new TextEncoder().encode(digest)),
    )
  } catch (err) {
    return { ok: false, reason: 'malformed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!signatureValid) return { ok: false, reason: 'bad-signature', keyId: envelope.signer.key_id }

  // Signature is authentic — now confirm it commits to THIS archive's content.
  const manifest = files.get('manifest.json')
  if (!manifest) {
    return { ok: false, reason: 'content-mismatch', detail: 'manifest.json missing' }
  }
  const manifestDigest = await sha256Hex(manifest)
  if (manifestDigest !== envelope.manifest_digest) {
    return { ok: false, reason: 'content-mismatch', detail: 'manifest digest does not match signature' }
  }
  const archiveBlobDigests = sidecarBlobDigests(files)
  const signedBlobDigests = [...envelope.blob_digests].sort()
  if (archiveBlobDigests.join(',') !== signedBlobDigests.join(',')) {
    return {
      ok: false,
      reason: 'content-mismatch',
      detail: 'sidecar blob digest set does not match signature',
    }
  }

  return { ok: true, keyId: envelope.signer.key_id }
}

/**
 * Copy into an ArrayBuffer-backed view. WebCrypto's `BufferSource` requires a
 * plain `ArrayBuffer` (not `SharedArrayBuffer`), and copying also detaches from
 * any Buffer/subarray view some runtimes reject.
 */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy as Uint8Array<ArrayBuffer>
}

function isEnvelopeShape(value: unknown): value is ShardSignatureEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const signer = v.signer as Record<string, unknown> | undefined
  return (
    typeof v.format_version === 'string' &&
    typeof v.manifest_digest === 'string' &&
    typeof v.signature === 'string' &&
    Array.isArray(v.blob_digests) &&
    v.blob_digests.every((d) => typeof d === 'string') &&
    typeof signer === 'object' &&
    signer !== null &&
    typeof signer.key_id === 'string' &&
    typeof signer.algorithm === 'string' &&
    typeof signer.public_key === 'string'
  )
}

// ── Signing (export side; publisher holds the private key) ───────────────────

export interface SignShardInput {
  files: Map<string, Uint8Array>
  keyId: string
  /** Ed25519 private key (raw 32-byte seed or PKCS8), imported by the caller. */
  privateKey: CryptoKey
  /** Raw 32-byte public key, base64url — embedded in the envelope + trust store. */
  publicKey: string
}

/**
 * Produce the `signature.json` envelope for an assembled archive `files` map.
 * The caller adds the returned bytes to the archive under {@link SIGNATURE_ENTRY}
 * (excluded from manifest.checksums — it post-dates the manifest).
 */
export async function signShard(input: SignShardInput): Promise<Uint8Array> {
  const manifest = input.files.get('manifest.json')
  if (!manifest) throw new Error('signShard: manifest.json missing from archive')

  const payload: ShardSigningPayload = {
    format_version: SIGNING_ENVELOPE_VERSION,
    signer: { key_id: input.keyId, algorithm: SIGNING_ALGORITHM, public_key: input.publicKey },
    manifest_digest: await sha256Hex(manifest),
    blob_digests: sidecarBlobDigests(input.files),
  }
  const digest = await sha256Hex(canonicalPayloadBytes(payload))
  const signature = await globalThis.crypto.subtle.sign(
    'Ed25519',
    input.privateKey,
    toBufferSource(new TextEncoder().encode(digest)),
  )
  const envelope: ShardSignatureEnvelope = {
    ...payload,
    signature: bytesToBase64url(new Uint8Array(signature)),
  }
  return new TextEncoder().encode(JSON.stringify(envelope, null, 2))
}

// Re-export for callers wiring the sidecar boundary.
export { blobChecksumToHex }
