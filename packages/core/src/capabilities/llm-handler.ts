/**
 * LLM completion function injection.
 * Provides the slot for an LLM function — injected by the llm capability module.
 * No model loading by default (CAP-001).
 *
 * @implements #66 AI title generation
 */

/** Type for the LLM completion function — injected by the llm capability module */
export type LlmCompleteFn = (
  prompt: string,
  options?: { maxTokens?: number; temperature?: number }
) => Promise<string>

let llmFn: LlmCompleteFn | null = null

export function setLlmFunction(fn: LlmCompleteFn | null): void {
  llmFn = fn
}

export function getLlmFunction(): LlmCompleteFn | null {
  return llmFn
}
