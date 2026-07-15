const DEFAULT_TIMEOUT_MS = 15_000

/** Wraps a fetch with an AbortController timeout. On timeout the underlying
 * fetch is aborted and the returned promise rejects. Always clears the timer. */
export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    return await fetchFn(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
