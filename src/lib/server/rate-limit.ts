interface TokenBucketOptions {
  capacity: number
  refillPerSec: number
  now?: () => number
  maxKeys?: number
}

interface Bucket {
  tokens: number
  lastRefill: number
}

const DEFAULT_MAX_KEYS = 10_000

/**
 * A per-key token-bucket rate limiter. Each key gets its own bucket,
 * lazily created full at `capacity` on first use, refilling continuously
 * over time. The bucket map is bounded at `maxKeys`, evicting the
 * least-recently-touched key so unbounded key churn (e.g. hostile IPs)
 * cannot grow memory without limit.
 */
export class TokenBucket {
  private readonly capacity: number
  private readonly refillPerSec: number
  private readonly now: () => number
  private readonly maxKeys: number
  private readonly buckets = new Map<string, Bucket>()

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity
    this.refillPerSec = opts.refillPerSec
    this.now = opts.now ?? Date.now
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS
  }

  /** Fetches (creating/refilling as needed) and marks a key as most-recently-touched. */
  private touch(key: string): Bucket {
    const nowMs = this.now()
    let bucket = this.buckets.get(key)

    if (bucket) {
      this.buckets.delete(key)
      const elapsedSec = Math.max(0, (nowMs - bucket.lastRefill) / 1000)
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec)
      bucket.lastRefill = nowMs
    } else {
      bucket = { tokens: this.capacity, lastRefill: nowMs }
    }

    // Re-inserting moves this key to the "most recently touched" end of
    // the Map's iteration order.
    this.buckets.set(key, bucket)

    if (this.buckets.size > this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value
      if (oldestKey !== undefined && oldestKey !== key) {
        this.buckets.delete(oldestKey)
      }
    }

    return bucket
  }

  /** Attempts to take `n` tokens (default 1) from `key`'s bucket. No partial takes. */
  take(key: string, n = 1): boolean {
    // Defensive: guard against non-positive n (developer-supplied, but this
    // is the security boundary). Treat zero, negative, or NaN as a no-op success.
    if (!(n > 0)) return true
    const bucket = this.touch(key)
    if (bucket.tokens < n) return false
    bucket.tokens -= n
    return true
  }
}
