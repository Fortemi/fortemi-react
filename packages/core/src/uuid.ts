import { v7 as uuidv7 } from 'uuid'

/**
 * Generate a RFC 9562 UUIDv7 identifier.
 *
 * UUIDv7 embeds a Unix timestamp in the high bits, making IDs
 * time-sortable and monotonic within the same millisecond.
 */
export function generateId(): string {
  return uuidv7()
}
