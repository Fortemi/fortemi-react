/**
 * Auto-tagging utility using embedding similarity.
 * Suggests tags based on cosine similarity between note and tag vocabulary embeddings.
 *
 * @implements #67 auto-tagging
 */

/** Cosine similarity between two normalized vectors (dot product) */
export function cosineSimilarity(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/**
 * Suggest tags based on embedding similarity to tag vocabulary centroids.
 * Returns tags sorted by descending similarity score, filtered by threshold.
 */
export function suggestTags(
  noteEmbedding: number[],
  tagEmbeddings: Map<string, number[]>,
  threshold = 0.6,
  maxTags = 5,
): string[] {
  return Array.from(tagEmbeddings.entries())
    .map(([tag, emb]) => ({ tag, score: cosineSimilarity(noteEmbedding, emb) }))
    .filter(({ score }) => score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTags)
    .map(({ tag }) => tag)
}
