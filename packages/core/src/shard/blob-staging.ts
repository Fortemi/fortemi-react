import type { BlobStore } from '../blob-store.js'

export interface BlobPromotion {
  readonly promoted: readonly string[]
  rollback(): Promise<void>
}

async function removePromoted(blobStore: BlobStore, checksums: readonly string[]): Promise<void> {
  if (!blobStore.delete && checksums.length > 0) {
    throw new Error('BlobStore does not support rollback-safe deletion')
  }
  const failures: string[] = []
  for (const checksum of [...checksums].reverse()) {
    try {
      await blobStore.delete!(checksum)
    } catch (error) {
      failures.push(`${checksum}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`Blob rollback failed for ${failures.join(', ')}`)
  }
}

/**
 * Promote verified sidecar bytes before the logical record transaction.
 * Existing content is never re-put, and rollback removes only hashes that
 * were absent before this promotion.
 */
export async function promoteBlobs(
  blobStore: BlobStore | undefined,
  blobs: ReadonlyMap<string, Uint8Array>,
): Promise<BlobPromotion> {
  if (!blobStore || blobs.size === 0) {
    return { promoted: [], rollback: async () => {} }
  }
  if (!blobStore.delete) {
    throw new Error(
      'BlobStore must implement delete() before sidecar bytes can be promoted atomically',
    )
  }

  const promoted: string[] = []
  try {
    for (const [checksum, bytes] of [...blobs].sort(([a], [b]) => a.localeCompare(b))) {
      if (await blobStore.has(checksum)) continue
      promoted.push(checksum)
      const storedChecksum = await blobStore.put(bytes)
      if (storedChecksum !== checksum) {
        throw new Error(
          `BlobStore returned ${storedChecksum} while promoting verified sidecar ${checksum}`,
        )
      }
    }
  } catch (error) {
    try {
      await removePromoted(blobStore, promoted)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Blob promotion failed and rollback was incomplete',
      )
    }
    throw error
  }

  return {
    promoted,
    rollback: () => removePromoted(blobStore, promoted),
  }
}
