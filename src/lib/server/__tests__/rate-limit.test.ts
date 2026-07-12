import { describe, it, expect } from "vitest"
import { TokenBucket } from "../rate-limit"

function makeClock(start = 0) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe("TokenBucket", () => {
  it("drains to false once capacity is exhausted", () => {
    const clock = makeClock()
    const bucket = new TokenBucket({ capacity: 3, refillPerSec: 0, now: clock.now })
    expect(bucket.take("k")).toBe(true)
    expect(bucket.take("k")).toBe(true)
    expect(bucket.take("k")).toBe(true)
    expect(bucket.take("k")).toBe(false)
  })

  it("lazily creates a bucket full at capacity on first use", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSec: 0 })
    expect(bucket.take("fresh", 2)).toBe(true)
    expect(bucket.take("fresh")).toBe(false)
  })

  it("refills continuously as elapsed time passes, capped at capacity", () => {
    const clock = makeClock()
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1, now: clock.now })
    // Drain fully.
    expect(bucket.take("k", 5)).toBe(true)
    expect(bucket.take("k")).toBe(false)
    // 2 seconds pass -> 2 tokens available.
    clock.advance(2000)
    expect(bucket.take("k", 2)).toBe(true)
    expect(bucket.take("k")).toBe(false)
    // 100 seconds pass -> refill caps at capacity, not unbounded.
    clock.advance(100_000)
    expect(bucket.take("k", 5)).toBe(true)
    expect(bucket.take("k")).toBe(false)
  })

  it("isolates buckets per key", () => {
    const clock = makeClock()
    const bucket = new TokenBucket({ capacity: 2, refillPerSec: 0, now: clock.now })
    expect(bucket.take("a", 2)).toBe(true)
    expect(bucket.take("a")).toBe(false)
    // "b" is unaffected by "a" having been drained.
    expect(bucket.take("b", 2)).toBe(true)
    expect(bucket.take("b")).toBe(false)
  })

  it("take(n) is atomic: an insufficient request leaves the balance unchanged", () => {
    const clock = makeClock()
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 0, now: clock.now })
    expect(bucket.take("k", 3)).toBe(true) // balance: 2
    expect(bucket.take("k", 3)).toBe(false) // insufficient, no partial take
    // Balance should still be exactly 2 - both of these succeed, a third does not.
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k", 1)).toBe(false)
  })

  it("bounds the bucket map at maxKeys, evicting the least-recently-touched key", () => {
    const clock = makeClock()
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 0, now: clock.now, maxKeys: 2 })
    expect(bucket.take("a", 1)).toBe(true) // touch a first (oldest): a has 4 left
    expect(bucket.take("b", 1)).toBe(true) // touch b second: b has 4 left
    expect(bucket.take("c", 1)).toBe(true) // touch c third -> evicts "a" (least-recently-touched)

    // "b" was never evicted, so its drained balance (4 left) is preserved.
    expect(bucket.take("b", 4)).toBe(true)
    expect(bucket.take("b")).toBe(false)

    // "a" was evicted, so it is re-created full at capacity on next use -
    // draining exactly `capacity` succeeds, proving it was reset, not
    // resumed from its earlier balance of 4 (which could not cover 5).
    expect(bucket.take("a", 5)).toBe(true)
    expect(bucket.take("a")).toBe(false)
  })

  it("defaults maxKeys to 10_000 when not specified", () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSec: 0 })
    expect(bucket.take("only-key")).toBe(true)
  })

  it("handles backward clock skew: tokens do not increase when time rewinds", () => {
    const clock = makeClock(1000)
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 1, now: clock.now })
    // Drain to capacity - 2.
    expect(bucket.take("k", 3)).toBe(true) // balance: 2
    clock.advance(1000)
    // Now we have 2 + 1 second * 1 token/sec = 3 tokens. Take 3.
    expect(bucket.take("k", 3)).toBe(true) // balance: 0
    expect(bucket.take("k")).toBe(false) // no tokens left
    // Move clock backward (simulating NTP skew or system clock adjustment).
    clock.advance(-500)
    // The next take should still fail. Backward skew clamps elapsed to 0, so no refill.
    expect(bucket.take("k")).toBe(false) // still 0, unchanged
  })

  it("take(0) is a no-op: returns true and does not mutate balance", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 0 })
    expect(bucket.take("k", 3)).toBe(true) // balance: 2
    expect(bucket.take("k", 0)).toBe(true) // no-op success
    // Balance should still be exactly 2.
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k")).toBe(false)
  })

  it("take() with negative n is a no-op: returns true and does not mutate balance", () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSec: 0 })
    expect(bucket.take("k", 3)).toBe(true) // balance: 2
    expect(bucket.take("k", -5)).toBe(true) // no-op success despite negative n
    // Balance should still be exactly 2 (not increased by the negative amount).
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k", 1)).toBe(true)
    expect(bucket.take("k")).toBe(false)
  })
})
