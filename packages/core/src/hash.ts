import { sha256 } from '@noble/hashes/sha256'
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex } from '@noble/hashes/utils'

/**
 * Compute a browser-local content-identity hash (SHA-256), encoded as
 * `sha256:<64-char lowercase hex>`.
 *
 * This is an internal identity/dedup digest used for note content, embedding
 * configs, the AIWG index, and graph identity — NOT the server's attachment
 * content-hash convention. Binary-attachment blobs use {@link computeBlobHash}
 * (BLAKE3), which is the canonical checksum defined by the binary-attachment
 * projection contract (`checksum: "blake3:<hex>"`). Keeping these two functions
 * separate preserves JSON format parity for the identity hashes above while
 * letting attachments match the server's `compute_content_hash`.
 *
 * @param data - Raw bytes to hash
 * @returns `'sha256:<64-char lowercase hex>'`
 */
export function computeHash(data: Uint8Array): string {
  const digest = sha256(data)
  return `sha256:${bytesToHex(digest)}`
}

/**
 * Compute the canonical attachment content hash: **BLAKE3**, encoded as
 * `blake3:<64-char lowercase hex>`.
 *
 * Matches the fortemi server (`crates/matric-db/src/file_storage.rs`
 * `compute_content_hash`) and the portable Knowledge-Shard byte-sidecar
 * contract, where the sidecar tar entry name is the bare hex (the `blake3:`
 * prefix stripped). SubtleCrypto has no BLAKE3, so this uses `@noble/hashes`.
 *
 * @param data - Raw attachment bytes to hash
 * @returns `'blake3:<64-char lowercase hex>'`
 */
export function computeBlobHash(data: Uint8Array): string {
  return `blake3:${bytesToHex(blake3(data))}`
}
