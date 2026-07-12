export type Tier = "fast" | "strong"
export type ProviderId = "anthropic" | "openai" | "google" | "openrouter"

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMRequest {
  messages: LLMMessage[]
  maxTokens?: number
  /** JSON Schema — when set, the provider must use its native structured-output mechanism. */
  jsonSchema?: Record<string, unknown>
  schemaName?: string
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export interface LLMResult {
  text: string
  json?: unknown
  usage: LLMUsage
  model: string
  provider: ProviderId
  stopReason: string
}

export interface LLMProvider {
  readonly id: ProviderId
  complete(model: string, req: LLMRequest): Promise<LLMResult>
}

export class LLMError extends Error {}
export class LLMAuthError extends LLMError {}
export class LLMBadRequestError extends LLMError {}
export class LLMRefusalError extends LLMError {}
export class LLMTransientError extends LLMError {}
export class LLMRateLimitError extends LLMError {
  constructor(message: string, public retryAfterMs?: number) {
    super(message)
  }
}

export function isRetryable(e: unknown): boolean {
  return e instanceof LLMTransientError || e instanceof LLMRateLimitError
}
