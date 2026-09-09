export type Tier = "fast" | "strong"
export type ProviderId = "anthropic" | "openai" | "google" | "openrouter"

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMRequest {
  /** Optional live output snapshot. An empty snapshot resets a retried attempt. Never includes reasoning. */
  onText?: (text: string) => void
  messages: LLMMessage[]
  maxTokens?: number
  /**
   * Request a provider-supported reasoning mode. Providers that do not expose
   * such a control may ignore it; callers must not rely on prompt text alone
   * when a provider does support an explicit switch.
  */
  thinking?: "disabled" | "enabled"
  /** Provider-supported reasoning depth for requests with thinking enabled. */
  reasoningEffort?: "low" | "medium" | "xhigh"
  /** JSON Schema — when set, the provider must use its native structured-output mechanism. */
  jsonSchema?: Record<string, unknown>
  schemaName?: string
  /** Budgeted jobs own retries; do not issue an unreserved provider-side fallback. */
  singleAttempt?: boolean
}

export interface LLMUsage {
  /** Total input, including cache reads (not an additional token category). */
  inputTokens: number
  /** Total billed completion, including reasoning when supplied by the API. */
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
  /** Explicitly false when the provider omitted usage; never infer free work. */
  reported?: boolean
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
