/**
 * Text chunking utility for embedding generation.
 * Splits long text into overlapping chunks suitable for embedding models.
 *
 * @implements #63 embedding pipeline prerequisite
 */

/** Split text into overlapping chunks for embedding. */
export function chunkText(text: string, maxChars = 800, overlap = 100): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars))
    start += maxChars - overlap
  }
  return chunks
}
