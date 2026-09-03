/**
 * LLM completion function injection.
 * Provides the slot for an LLM function — injected by the llm capability module.
 * No model loading by default (CAP-001).
 *
 * @implements #66 AI title generation
 */

import type { InferenceTask } from './inference-provider.js'

export interface LlmCompleteOptions {
  maxTokens?: number
  temperature?: number
  task?: InferenceTask
  model?: string
}

/** Type for the LLM completion function — injected by the llm capability module */
export type LlmCompleteFn = (
  prompt: string,
  options?: LlmCompleteOptions,
) => Promise<string>

let llmFn: LlmCompleteFn | null = null

export function setLlmFunction(fn: LlmCompleteFn | null): void {
  llmFn = fn
}

export function getLlmFunction(): LlmCompleteFn | null {
  return llmFn
}
