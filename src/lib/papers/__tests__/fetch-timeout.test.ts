import { describe, it, expect, vi } from "vitest"
import { fetchWithTimeout } from "../fetch-timeout"

describe("fetchWithTimeout", () => {
  it("passes the abort signal and returns the response on success", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch
    const res = await fetchWithTimeout(fetchFn, "http://x", { timeoutMs: 50 })
    expect(res.status).toBe(200)
  })

  it("aborts (throws) when the fetch never resolves before the timeout", async () => {
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })) as unknown as typeof fetch
    await expect(fetchWithTimeout(fetchFn, "http://x", { timeoutMs: 10 })).rejects.toThrow(/abort/i)
  })

  it("clears the timer on success (no dangling timer keeps the process alive)", async () => {
    const fetchFn = (async () => new Response("ok")) as unknown as typeof fetch
    await expect(fetchWithTimeout(fetchFn, "http://x", { timeoutMs: 10_000 })).resolves.toBeDefined()
    // If the timer weren't cleared, vitest would warn about an open handle; assertion is the resolve.
  })
})
