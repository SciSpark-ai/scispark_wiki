import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
// readNdjson is imported from skill-route.ts's re-export here (not from
// ../ndjson directly) to exercise that re-export contract too.
import { jsonSkillRoute, ndjsonSkillRoute, readNdjson, setSkillTestOverrides } from "../skill-route"

describe("jsonSkillRoute", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
  })

  it("happy path: 200 with the handler's return value under {result}", async () => {
    const route = jsonSkillRoute<{ n: number }, number>(async (input, vault) => {
      expect(vault).toBe(storage)
      return input.n * 2
    })
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: JSON.stringify({ n: 21 }) }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(await res.json()).toEqual({ result: 42 })
  })

  it("handler throw → 500 {error}", async () => {
    const route = jsonSkillRoute(async () => {
      throw new Error("boom")
    })
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "boom" })
  })

  it("malformed JSON body → 500 {error}", async () => {
    const route = jsonSkillRoute(async () => "unreached")
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: "not json" }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
  })
})

describe("ndjsonSkillRoute + readNdjson", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
  })

  it("streams progress events in order, then a terminal result event", async () => {
    const route = ndjsonSkillRoute<{ items: string[] }>(async (input, vault, emit) => {
      expect(vault).toBe(storage)
      for (const item of input.items) emit({ type: "progress", item })
      return { done: input.items.length }
    })
    const res = await route(
      new Request("http://x/api/skills/test", { method: "POST", body: JSON.stringify({ items: ["a", "b", "c"] }) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/x-ndjson")

    const seen: unknown[] = []
    const result = await readNdjson(res, (e) => seen.push(e))
    expect(seen).toEqual([{ type: "progress", item: "a" }, { type: "progress", item: "b" }, { type: "progress", item: "c" }])
    expect(result).toEqual({ done: 3 })
  })

  it("handler throw → terminal error event, readNdjson rejects", async () => {
    const route = ndjsonSkillRoute<Record<string, never>>(async (_input, _vault, emit) => {
      emit({ type: "progress", step: 1 })
      throw new Error("skill exploded")
    })
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    expect(res.status).toBe(200) // outcome lives in the terminal NDJSON line, not the HTTP status

    const seen: unknown[] = []
    await expect(readNdjson(res, (e) => seen.push(e))).rejects.toThrow("skill exploded")
    expect(seen).toEqual([{ type: "progress", step: 1 }])
  })

  it("the stream always terminates: body is fully readable to EOF on both success and failure", async () => {
    const okRoute = ndjsonSkillRoute<Record<string, never>>(async () => ({ ok: true }))
    const okRes = await okRoute(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    const okReader = okRes.body!.getReader()
    let okDone = false
    while (!okDone) {
      const { done } = await okReader.read()
      okDone = done
    }
    expect(okDone).toBe(true)

    const failRoute = ndjsonSkillRoute<Record<string, never>>(async () => {
      throw new Error("fail")
    })
    const failRes = await failRoute(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    const failReader = failRes.body!.getReader()
    let failDone = false
    while (!failDone) {
      const { done } = await failReader.read()
      failDone = done
    }
    expect(failDone).toBe(true)
  })

  it("readNdjson handles a line split across multiple chunks, and multiple lines in one chunk", async () => {
    const encoder = new TextEncoder()
    const chunks = [
      '{"type":"progress","fi', // split mid-line
      'eld":"a"}\n{"type":"progress","field":"b"}\n', // two lines in one chunk
      '{"type":"result","payload":{"panels":[1,2]}}\n',
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    const res = new Response(stream)
    const seen: unknown[] = []
    const result = await readNdjson(res, (e) => seen.push(e))
    expect(seen).toEqual([{ type: "progress", field: "a" }, { type: "progress", field: "b" }])
    expect(result).toEqual({ panels: [1, 2] })
  })

  it("a handler result that itself has a `type` property round-trips intact (nested payload, not spread)", async () => {
    const route = ndjsonSkillRoute<Record<string, never>>(async () => ({
      type: "refreshed",
      count: 3,
    }))
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    const result = await readNdjson(res, () => undefined)
    // Before the fix, spreading `{type:"result", ...result}` would let the
    // handler's own `type: "refreshed"` overwrite the terminal tag, so
    // readNdjson would treat this line as a non-terminal progress event and
    // then reject with "stream ended without a result or error event".
    expect(result).toEqual({ type: "refreshed", count: 3 })
  })

  it("a late emit() after the handler has resolved is a silent no-op — no unhandled rejection, stream result intact", async () => {
    let lateEmit: ((event: object) => void) | undefined
    const route = ndjsonSkillRoute<Record<string, never>>(async (_input, _vault, emit) => {
      emit({ type: "progress", step: 1 })
      // Simulate a handler that kicks off async work it doesn't await, which
      // tries to emit again after the handler itself has already resolved
      // and the terminal line has been written.
      lateEmit = emit
      return { done: true }
    })
    const res = await route(new Request("http://x/api/skills/test", { method: "POST", body: "{}" }))
    const seen: unknown[] = []
    const result = await readNdjson(res, (e) => seen.push(e))
    expect(result).toEqual({ done: true })
    expect(seen).toEqual([{ type: "progress", step: 1 }])

    // Calling emit() now must not throw (would otherwise be an unhandled
    // rejection with no catch site, since the route's start() callback has
    // already returned).
    expect(() => lateEmit?.({ type: "progress", step: "too late" })).not.toThrow()
  })

  it("setSkillTestOverrides / getSkillTestOverrides round-trip and reset", async () => {
    const { getSkillTestOverrides } = await import("../skill-route")
    expect(getSkillTestOverrides()).toEqual({})
    const fakeSearchFn = async () => []
    setSkillTestOverrides({ searchFn: fakeSearchFn })
    expect(getSkillTestOverrides().searchFn).toBe(fakeSearchFn)
    setSkillTestOverrides()
    expect(getSkillTestOverrides()).toEqual({})
  })
})
