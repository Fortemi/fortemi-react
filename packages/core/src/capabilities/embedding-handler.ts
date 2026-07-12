/**
 * Embedding generation job handler.
 * Generates and stores vector embeddings for note content.
 * Embed function is injected via setEmbedFunction — no WASM loaded by default.
 *
 * @implements #63 embedding generation
 */

import type { DatabaseClient } from '../storage-backend.js'
import { EmbeddingSetsRepository } from '../repositories/embedding-sets-repository.js'
import { getNoteTextWithExtractedAttachments } from '../repositories/note-text.js'
import { chunkText } from './chunking.js'

/** Type for the embed function — injected by the semantic capability module */
export type EmbedFunction = (texts: string[]) => Promise<number[][]>

let embedFn: EmbedFunction | null = null

export function setEmbedFunction(fn: EmbedFunction | null): void {
  embedFn = fn
}

export function getEmbedFunction(): EmbedFunction | null {
  return embedFn
}

/**
 * Average multiple embeddings into a single vector.
 * Used to collapse chunk embeddings into one representative vector per note.
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 1) return embeddings[0]
  const dims = embeddings[0].length
  const avg = new Array<number>(dims).fill(0)
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      avg[i] += emb[i]
    }
  }
  for (let i = 0; i < dims; i++) {
    avg[i] /= embeddings.length
  }
  // Normalize
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0))
  return norm > 0 ? avg.map(v => v / norm) : avg
}

/** Job handler for embedding generation. Registered in JobQueueWorker. */
export async function embeddingGenerationHandler(
  job: { note_id: string },
  db: DatabaseClient,
): Promise<unknown> {
  const fn = embedFn
  if (!fn) return { skipped: true, reason: 'no embed function registered' }

  const noteText = await getNoteTextWithExtractedAttachments(db, job.note_id)
  if (!noteText) return { skipped: true, reason: 'note missing, deleted, or has no content' }

  const content = noteText.combined
  const chunks = chunkText(content)

  // Generate embeddings for all chunks
  const embeddings = await fn(chunks)

  // Average all chunk embeddings into one vector for storage
  const vector = averageEmbeddings(embeddings)

  const embeddingSets = new EmbeddingSetsRepository(db)
  const set = await embeddingSets.ensureDefault()
  await embeddingSets.putEmbedding({
    note_id: job.note_id,
    embedding_set_id: set.id,
    vector,
  })

  return { chunks: chunks.length, embeddings: embeddings.length, setId: set.id }
}
