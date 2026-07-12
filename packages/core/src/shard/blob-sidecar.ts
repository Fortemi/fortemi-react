/**
 * Portable Knowledge-Shard byte sidecar (Fortemi/fortemi#1046).
 *
 * A portable shard MAY carry attachment bytes in a content-addressed sidecar
 * inside its `tar.gz`: one entry per distinct blob, named `blobs/<hex>` where
 * `<hex>` is the bare 64-char lowercase BLAKE3 digest of the entry bytes. A
 * projection record's `checksum` of `blake3:<hex>` resolves to `blobs/<hex>`
 * by stripping the `blake3:` prefix. Sidecars are optional: a missing entry
 * makes an attachment reference-only, which is valid; readers ignore unknown
 * or unreferenced `blobs/` entries without failing import.
 */

export const SIDECAR_PREFIX = 'blobs/'

/**
 * Strip an `algorithm:hex` checksum down to the bare hex used as the sidecar
 * entry name. Passing a bare hex returns it unchanged.
 */
export function blobChecksumToHex(checksum: string): string {
  const sep = checksum.indexOf(':')
  return sep >= 0 ? checksum.slice(sep + 1) : checksum
}

/** Map a projection `checksum` to its sidecar tar entry name (`blobs/<hex>`). */
export function sidecarEntryName(checksum: string): string {
  return SIDECAR_PREFIX + blobChecksumToHex(checksum)
}

/** True when a tar entry name is a top-level `blobs/<hex>` sidecar entry. */
export function isSidecarEntry(name: string): boolean {
  if (!name.startsWith(SIDECAR_PREFIX)) return false
  const rest = name.slice(SIDECAR_PREFIX.length)
  return rest.length > 0 && !rest.includes('/')
}

/**
 * Collect the sidecar blobs from an unpacked archive, keyed by bare hex.
 * Nested or directory-like entries under `blobs/` are ignored.
 */
export function collectSidecarBlobs(
  files: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  const blobs = new Map<string, Uint8Array>()
  for (const [name, bytes] of files) {
    if (isSidecarEntry(name)) {
      blobs.set(name.slice(SIDECAR_PREFIX.length), bytes)
    }
  }
  return blobs
}
