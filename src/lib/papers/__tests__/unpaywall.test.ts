import { describe, it, expect, vi } from "vitest"
import { resolveOa } from "../unpaywall"
import { PaperSourceError } from "../types"
import fixture from "./fixtures/unpaywall.json"

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe("resolveOa", () => {
  it("maps best_oa_location to oaUrl/pdfUrl and isOa from the live fixture", async () => {
    const fetchFn = fakeFetch(fixture)

    const result = await resolveOa("10.1038/nature12373", { fetchFn, email: "me@example.com" })

    expect(result.isOa).toBe(true)
    expect(result.oaUrl).toBe(fixture.best_oa_location.url_for_landing_page)
    expect(result.pdfUrl).toBe(fixture.best_oa_location.url_for_pdf)
  })

  it("builds the request URL with the encoded doi and email", async () => {
    const fetchFn = fakeFetch(fixture)

    await resolveOa("10.1038/nature 12373", { fetchFn, email: "me@example.com" })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const url = new URL(calledUrl.toString())
    expect(url.origin).toBe("https://api.unpaywall.org")
    expect(url.pathname).toBe("/v2/10.1038/nature%2012373")
    expect(url.searchParams.get("email")).toBe("me@example.com")
  })

  it("returns isOa false with no urls on a 404 (unknown DOI is a normal answer)", async () => {
    const fetchFn = fakeFetch({ message: "not found" }, 404)

    const result = await resolveOa("10.9999/does-not-exist", { fetchFn, email: "me@example.com" })

    expect(result).toEqual({ isOa: false })
  })

  it("maps empty-string url_for_landing_page and url_for_pdf to undefined", async () => {
    const fetchFn = fakeFetch({
      is_oa: false,
      best_oa_location: { url_for_landing_page: "", url_for_pdf: "  " },
    })

    const result = await resolveOa("10.1/x", { fetchFn, email: "me@example.com" })

    expect(result.oaUrl).toBeUndefined()
    expect(result.pdfUrl).toBeUndefined()
    expect(result.isOa).toBe(false)
  })

  it("returns isOa false with no urls when best_oa_location is null", async () => {
    const fetchFn = fakeFetch({ is_oa: false, best_oa_location: null })

    const result = await resolveOa("10.1/x", { fetchFn, email: "me@example.com" })

    expect(result).toEqual({ isOa: false })
  })

  it("throws PaperSourceError with status on a non-200, non-404 response", async () => {
    const fetchFn = fakeFetch({ error: "forbidden" }, 403)

    await expect(resolveOa("10.1/x", { fetchFn, email: "me@example.com" })).rejects.toMatchObject({
      name: "PaperSourceError",
      status: 403,
    })
  })

  it("wraps a network-level throw in PaperSourceError without a status", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch

    try {
      await resolveOa("10.1/x", { fetchFn, email: "me@example.com" })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(PaperSourceError)
      expect((err as PaperSourceError).status).toBeUndefined()
    }
  })
})
