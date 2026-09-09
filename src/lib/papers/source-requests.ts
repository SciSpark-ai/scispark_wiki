/** Source transports are server-owned. Keep HTTP pacing here, below both the
 * direct feed adapters and /api/search; route-only throttles miss feed traffic.
 * Conservative even with keys: S2 <= 1/s, PubMed < 3/s (ESearch + EFetch count).
 * Limits verified 2026-09-06 against the sources' official usage guidelines.
 */
type PacedSource = "s2" | "pubmed"
const INTERVAL_MS: Record<PacedSource, number> = { s2: 1000, pubmed: 350 }
const DEFAULT_COOLDOWN_MS = 5000

/** Also releases queue/deadline bookkeeping if an injected transport ignores
 * AbortSignal. Real fetch receives the same signal, including response bodies. */
function abortable<T>(task: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return task
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Request cancelled", "AbortError"))
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

async function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }), signal)
  } finally { clearTimeout(timer) }
}

function cooldownMs(value: string | null): number {
  if (!value?.trim()) return DEFAULT_COOLDOWN_MS
  const numeric = Number(value)
  const delay = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_COOLDOWN_MS
}

/** One queue per source, no bursts or overlapping header requests. Retries also
 * acquire a paced slot, with at most one retry for 429/503. An upstream cooldown
 * applies to queued/future calls as well, even when this caller times out. */
export function createSourceFetch(source: PacedSource, fetchFn: typeof fetch): typeof fetch {
  let tail: Promise<unknown> = Promise.resolve()
  let nextStart = 0
  return (input, init) => {
    const signal = init?.signal
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted()
        // Chunk long Retry-After delays to avoid setTimeout integer overflow.
        while (nextStart > Date.now()) await pause(Math.min(nextStart - Date.now(), 60_000), signal)
        signal?.throwIfAborted()
        nextStart = Date.now() + INTERVAL_MS[source]
        const response = await abortable(fetchFn(input, init), signal)
        if (response.status !== 429 && response.status !== 503) return response
        nextStart = Math.max(nextStart, Date.now() + cooldownMs(response.headers.get("Retry-After")))
        if (attempt === 1) return response
        // Release the discarded body's connection before the sole retry.
        await response.body?.cancel()
      }
    }
    const result = tail.then(run)
    tail = result.catch(() => {})
    // Cancellation rejects promptly even while another request owns the queue.
    return abortable(result, signal)
  }
}

// globalThis keeps independent Next route bundles/hot reloads in one local
// server process on the same queues. Separate server processes/IP peers still
// need their own coordination; this is not a distributed rate limiter.
const runtime = globalThis as typeof globalThis & { __scisparkSourceFetch?: Record<PacedSource, typeof fetch> }
export function sourceFetch(source: PacedSource): typeof fetch {
  runtime.__scisparkSourceFetch ??= {
    s2: createSourceFetch("s2", (...args) => fetch(...args)),
    pubmed: createSourceFetch("pubmed", (...args) => fetch(...args)),
  }
  return runtime.__scisparkSourceFetch[source]
}

/** Bound a whole logical search, including queue wait, retries and body parsing.
 * A feed deadline can abort the same work sooner; no delayed ghost searches. */
export async function withSourceDeadline<T>(
  parent: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>, timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason)
  if (parent?.aborted) cancel()
  else parent?.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException("Source timed out", "TimeoutError")), timeoutMs)
  try {
    controller.signal.throwIfAborted()
    return await abortable(task(controller.signal), controller.signal)
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener("abort", cancel)
  }
}
