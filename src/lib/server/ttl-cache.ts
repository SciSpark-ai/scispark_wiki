interface TtlCacheOptions {
  ttlMs: number
  maxEntries: number
  now?: () => number
}

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

/**
 * A TTL + LRU cache. Entries expire `ttlMs` after being set (checked lazily
 * on access) and are evicted least-recently-used once `maxEntries` is
 * reached. Recency is refreshed by both `get` and `set`.
 */
export class TtlCache<V> {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly entries = new Map<string, CacheEntry<V>>()

  constructor(opts: TtlCacheOptions) {
    this.ttlMs = opts.ttlMs
    this.maxEntries = opts.maxEntries
    this.now = opts.now ?? Date.now
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }

    // Refresh recency: Map iteration order follows insertion order, so
    // re-inserting moves this key to the "most recently used" end.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    const entry: CacheEntry<V> = { value, expiresAt: this.now() + this.ttlMs }

    if (this.entries.has(key)) {
      // Overwrite in place - does not consume an eviction slot.
      this.entries.delete(key)
      this.entries.set(key, entry)
      return
    }

    if (this.entries.size >= this.maxEntries) {
      const lruKey = this.entries.keys().next().value
      if (lruKey !== undefined) this.entries.delete(lruKey)
    }

    this.entries.set(key, entry)
  }
}
