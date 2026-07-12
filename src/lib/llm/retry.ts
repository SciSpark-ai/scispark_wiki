import { isRetryable, LLMRateLimitError } from "./types"

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const base = opts.baseDelayMs ?? 1000
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (!isRetryable(e) || attempt === retries) throw e
      const hinted = e instanceof LLMRateLimitError ? e.retryAfterMs : undefined
      await sleep(hinted ?? base * 2 ** attempt)
    }
  }
  throw lastError
}
