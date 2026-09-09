import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSourceFetch, withSourceDeadline } from "../source-requests"
import { searchPubmed } from "../pubmed"
import { searchS2 } from "../s2"
import { fetchReferences } from "../citations-core"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../../server/vault"
import { saveS2Key, testS2Connection } from "../../server/paper-source-settings"

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setServerVaultForTests(null) })

describe("source HTTP pacing", () => {
  it("uses the shared production transport when adapters receive no override", async () => {
    const requests: { source: string; at: number }[] = []
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const source = new URL(String(input)).hostname.includes("semanticscholar") ? "s2" : "pubmed"
      requests.push({ source, at: Date.now() })
      return Response.json(source === "s2" ? { data: [] } : { esearchresult: { idlist: [] } })
    }))
    const work = Promise.all([
      searchS2({ query: "a" }), searchS2({ query: "b" }), fetchReferences("DOI:10.1/example"),
      searchPubmed({ query: "a" }), searchPubmed({ query: "b" }),
      (async () => {
        const storage = new MemoryVaultStorage()
        setServerVaultForTests(storage)
        await saveS2Key(storage, "test-key")
        expect((await testS2Connection()).outcome).toBe("ok")
      })(),
    ])
    await vi.runAllTimersAsync()
    await work
    expect(requests.filter((r) => r.source === "s2").map((r) => r.at)).toEqual([0, 1000, 2000, 3000])
    expect(requests.filter((r) => r.source === "pubmed").map((r) => r.at)).toEqual([0, 350])
  })
  it("spaces Semantic Scholar starts and shares one transport across searches", async () => {
    const times: number[] = []
    const transport = createSourceFetch("s2", async () => {
      times.push(Date.now())
      return Response.json({ data: [] })
    })
    const searches = Promise.all(["a", "b", "c"].map((query) => searchS2({ query }, { fetchFn: transport })))
    await vi.runAllTimersAsync()
    await searches
    expect(times).toEqual([0, 1000, 2000])
  })

  it("paces both PubMed endpoints across concurrent searches, not just each query", async () => {
    const requests: { at: number; endpoint: string }[] = []
    const transport = createSourceFetch("pubmed", async (input) => {
      const endpoint = new URL(String(input)).pathname.split("/").pop()!
      requests.push({ at: Date.now(), endpoint })
      return endpoint === "esearch.fcgi" ? Response.json({ esearchresult: { idlist: ["123"] } })
        : new Response("<PubmedArticleSet></PubmedArticleSet>")
    })
    const searches = Promise.all(["a", "b"].map((query) => searchPubmed({ query }, { fetchFn: transport })))
    await vi.runAllTimersAsync()
    await searches
    expect(requests.map(({ at }) => at)).toEqual([0, 350, 700, 1050])
    expect(requests.filter(({ endpoint }) => endpoint === "efetch.fcgi")).toHaveLength(2)
  })

  it("shares cooldown with queued work and retries a rate limit only once", async () => {
    const starts: number[] = []
    const raw = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now())
      return new Response(null, { status: 429, headers: { "Retry-After": "2" } })
    })
    const transport = createSourceFetch("s2", raw)
    const results = Promise.all([transport("https://example.test/a"), transport("https://example.test/b")])
    await vi.runAllTimersAsync()
    expect((await results).map((r) => r.status)).toEqual([429, 429])
    expect(starts).toEqual([0, 2000, 4000, 6000])
  })

  it.each(["bad", "-1", ""])("uses a conservative cooldown for invalid Retry-After %s", async (value) => {
    const raw = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": value } }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
    const transport = createSourceFetch("s2", raw)
    const result = transport("https://example.test")
    await vi.advanceTimersByTimeAsync(4999)
    expect(raw).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).ok).toBe(true)
  })

  it("honors HTTP-date Retry-After, including a cooldown beyond the query deadline", async () => {
    const raw = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": new Date(60_000).toUTCString() } }))
    const transport = createSourceFetch("s2", raw)
    const result = withSourceDeadline(undefined, (signal) => transport("https://example.test", { signal }), 1000)
    const failed = expect(result).rejects.toMatchObject({ name: "TimeoutError" })
    await vi.advanceTimersByTimeAsync(1000)
    await failed
    await vi.advanceTimersByTimeAsync(60_000)
    expect(raw).toHaveBeenCalledTimes(1) // no ghost retry after timeout
  })

  it("does not retry auth errors, and one source cannot block the other", async () => {
    const s2 = createSourceFetch("s2", async () => new Response(null, { status: 401 }))
    const pubmed = createSourceFetch("pubmed", async () => Response.json({}))
    const first = await s2("https://example.test")
    expect(first.status).toBe(401)
    const waiting = s2("https://example.test/second")
    expect((await pubmed("https://example.test")).ok).toBe(true)
    expect(Date.now()).toBe(0)
    await vi.runAllTimersAsync()
    await waiting
  })

  it("cancels a queued request without issuing it or poisoning later work", async () => {
    const raw = vi.fn<typeof fetch>(async () => Response.json({}))
    const transport = createSourceFetch("s2", raw)
    await transport("https://example.test/first")
    const controller = new AbortController()
    const queued = transport("https://example.test/aborted", { signal: controller.signal })
    const failed = expect(queued).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await failed
    const next = transport("https://example.test/next")
    await vi.runAllTimersAsync()
    await next
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it("aborts active fetches and stalled bodies when the adapter deadline expires", async () => {
    let activeSignal: AbortSignal | undefined
    const pending = searchS2({ query: "x" }, { fetchFn: async (_url, init) => {
      activeSignal = init!.signal!
      return { ok: true, json: () => new Promise(() => {}) } as Response
    } })
    const failed = expect(pending).rejects.toMatchObject({ name: "TimeoutError" })
    await vi.advanceTimersByTimeAsync(20_000)
    await failed
    expect(activeSignal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
