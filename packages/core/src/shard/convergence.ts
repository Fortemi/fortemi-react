type TimestampedRecord = {
  created_at: string | Date
  updated_at?: string | Date | null
  deleted_at?: string | Date | null
}

function instant(value: string | Date | null | undefined): number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

/**
 * Last-writer ordering for replace imports. Tombstones participate in the
 * same order as live updates, so an older live archive cannot revive a newer
 * destination tombstone.
 */
export function shouldApplyReplacement(
  existing: TimestampedRecord,
  incoming: TimestampedRecord,
): boolean {
  const existingDeleted = instant(existing.deleted_at)
  const incomingDeleted = instant(incoming.deleted_at)
  if (
    existingDeleted === Number.NEGATIVE_INFINITY
    && incomingDeleted === Number.NEGATIVE_INFINITY
  ) {
    return true
  }
  const existingInstant = Math.max(
    instant(existing.created_at),
    instant(existing.updated_at),
    existingDeleted,
  )
  const incomingInstant = Math.max(
    instant(incoming.created_at),
    instant(incoming.updated_at),
    incomingDeleted,
  )
  return incomingInstant >= existingInstant
}
