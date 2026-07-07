/**
 * SHA-256 checksum utilities for shard integrity verification.
 * Uses the Web Crypto API (browser-native, no extra dependencies).
 */

/**
 * Compute SHA-256 hex digest of a Uint8Array.
 * Returns lowercase hex string (64 characters).
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(data.byteLength)
  new Uint8Array(buf).set(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Validate checksums listed in a shard manifest against actual file contents.
 *
 * SECURITY (SEC7 — trust model): these checksums live *inside* the same archive
 * as the files they hash, so they detect **transport corruption**, not
 * **tampering**. An attacker who controls the archive controls both the file
 * bytes and the manifest hashes, so a passing result proves the archive is
 * internally consistent — nothing more. For provenance-sensitive imports, verify
 * integrity out-of-band: a signed manifest, or a caller-supplied expected digest
 * checked against the whole archive (see `prefetchShard`'s `expectedSha256`,
 * which is real integrity because the hash arrives on a separate channel).
 *
 * @returns Object with `valid` flag and list of failed filenames.
 */
export async function validateChecksums(
  checksums: Record<string, string>,
  files: Map<string, Uint8Array>,
): Promise<{ valid: boolean; failures: string[] }> {
  const failures: string[] = []

  for (const [filename, expectedHash] of Object.entries(checksums)) {
    const fileData = files.get(filename)
    if (!fileData) {
      failures.push(filename)
      continue
    }
    const actualHash = await sha256Hex(fileData)
    if (actualHash !== expectedHash) {
      failures.push(filename)
    }
  }

  return { valid: failures.length === 0, failures }
}
