import { describe, it, expect } from "vitest"
import { TtlCache } from "../ttl-cache"

function makeClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe("TtlCache", () => {
  it("returns a value set before it expires", () => {
    const clock = makeClock()
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10, now: clock.now })
    cache.set("a", 1)
    clock.advance(999)
    expect(cache.get("a")).toBe(1)
  })

  it("returns undefined once the ttl has elapsed, and removes the entry", () => {
    const clock = makeClock()
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10, now: clock.now })
    cache.set("a", 1)
    clock.advance(1000)
    expect(cache.get("a")).toBeUndefined()
    // Re-setting after expiry should not be blocked by a stale entry.
    clock.advance(1)
    cache.set("a", 2)
    expect(cache.get("a")).toBe(2)
  })

  it("returns undefined for a key that was never set", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10 })
    expect(cache.get("missing")).toBeUndefined()
  })

  it("evicts the least-recently-used entry when at maxEntries, sparing a recently-get key", () => {
    const clock = makeClock()
    const cache = new TtlCache<string>({ ttlMs: 100_000, maxEntries: 2, now: clock.now })
    cache.set("a", "A")
    cache.set("b", "B")
    // Refresh "a" recency; "b" is now the least-recently-used.
    expect(cache.get("a")).toBe("A")
    cache.set("c", "C")
    expect(cache.get("a")).toBe("A")
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("c")).toBe("C")
  })

  it("overwrites an existing key in place without counting as a new entry", () => {
    const cache = new TtlCache<number>({ ttlMs: 100_000, maxEntries: 2 })
    cache.set("a", 1)
    cache.set("a", 2)
    cache.set("b", 1)
    // Still exactly at capacity (a, b) - overwriting "a" must not have
    // silently consumed a second eviction slot.
    expect(cache.get("a")).toBe(2)
    expect(cache.get("b")).toBe(1)
  })

  it("uses Date.now by default when no clock is injected", () => {
    const cache = new TtlCache<number>({ ttlMs: 100_000, maxEntries: 10 })
    cache.set("a", 1)
    expect(cache.get("a")).toBe(1)
  })
})
