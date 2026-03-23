import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/**
 * Compute a SHA-256 content hash for the given byte array.
 *
 * Returns a string in `algorithm:hex` format to match the server-side
 * convention, e.g. `sha256:a3b4c5...` (64 hex characters after the prefix).
 *
 * @param data - Raw bytes to hash
 * @returns `'sha256:<64-char lowercase hex>'`
 */
export function computeHash(data: Uint8Array): string {
  const digest = sha256(data)
  return `sha256:${bytesToHex(digest)}`
}
