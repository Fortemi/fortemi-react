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
import type { InferenceTask } from './inference-provider.js'

export interface EmbedFunctionOptions {
  task?: InferenceTask
  model?: string
}

export interface EmbeddingTaskSelectionOptions {
  largeDocumentChars?: number
  largeDocumentChunks?: number
}

export const DEFAULT_LARGE_DOCUMENT_CHARS = 12_000
export const DEFAULT_LARGE_DOCUMENT_CHUNKS = 12

/** Type for the embed function — injected by the semantic capability module */
export type EmbedFunction = (texts: string[], options?: EmbedFunctionOptions) => Promise<number[][]>

let embedFn: EmbedFunction | null = null
let embeddingTaskSelectionOptions: EmbeddingTaskSelectionOptions = {}

export function setEmbedFunction(fn: EmbedFunction | null): void {
  embedFn = fn
}

export function setEmbeddingTaskSelectionOptions(options: EmbeddingTaskSelectionOptions = {}): void {
  embeddingTaskSelectionOptions = { ...options }
}

export function getEmbeddingTaskSelectionOptions(): EmbeddingTaskSelectionOptions {
  return { ...embeddingTaskSelectionOptions }
}

export function selectEmbeddingTask(
  content: string,
  chunks: string[],
  options: EmbeddingTaskSelectionOptions = {},
): InferenceTask {
  const largeDocumentChars = options.largeDocumentChars ?? DEFAULT_LARGE_DOCUMENT_CHARS
  const largeDocumentChunks = options.largeDocumentChunks ?? DEFAULT_LARGE_DOCUMENT_CHUNKS
  return content.length >= largeDocumentChars || chunks.length >= largeDocumentChunks
    ? 'embedding.large-document'
    : 'embedding.document'
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
  const task = selectEmbeddingTask(content, chunks, embeddingTaskSelectionOptions)

  // Generate embeddings for all chunks
  const embeddings = await fn(chunks, { task })

  // Average all chunk embeddings into one vector for storage
  const vector = averageEmbeddings(embeddings)

  const embeddingSets = new EmbeddingSetsRepository(db)
  const set = await embeddingSets.ensureDefault()
  await embeddingSets.putEmbedding({
    note_id: job.note_id,
    embedding_set_id: set.id,
    vector,
  })

  return { chunks: chunks.length, embeddings: embeddings.length, setId: set.id, task }
}
