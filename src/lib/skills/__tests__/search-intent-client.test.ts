import { describe, it, expect, vi, beforeEach } from "vitest"
import { classifySearchIntentRemote, __clearSearchIntentCache } from "../search-intent-client"

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  __clearSearchIntentCache()
})

describe("classifySearchIntentRemote", () => {
  it("returns the server-classified sort", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ result: { sort: "date" } })) as unknown as typeof fetch
    expect(await classifySearchIntentRemote("latest LLM papers", fetchFn)).toBe("date")
  })

  it("short-circuits an empty/whitespace query to relevance without a network call", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    expect(await classifySearchIntentRemote("   ", fetchFn)).toBe("relevance")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("memoizes per normalized query so repeat searches don't re-call the skill", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ result: { sort: "date" } })) as unknown as typeof fetch
    await classifySearchIntentRemote("Recent  Papers", fetchFn)
    await classifySearchIntentRemote("recent papers", fetchFn) // same after normalize
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("degrades to relevance on a non-200 response", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ error: "no key" }, false, 500)) as unknown as typeof fetch
    expect(await classifySearchIntentRemote("x y z", fetchFn)).toBe("relevance")
  })

  it("degrades to relevance when fetch throws (offline)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    expect(await classifySearchIntentRemote("x y z", fetchFn)).toBe("relevance")
  })

  it("treats a malformed/unknown sort value as relevance", async () => {
    const fetchFn = vi.fn(async () => jsonRes({ result: { sort: "citations" } })) as unknown as typeof fetch
    expect(await classifySearchIntentRemote("x y z", fetchFn)).toBe("relevance")
  })
})
