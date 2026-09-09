import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { getServerS2Key, saveS2Key } from "../paper-source-settings"
import * as settings from "../../../app/api/settings/paper-sources/route"
import * as testConnection from "../../../app/api/settings/paper-sources/test-connection/route"
import * as allSettings from "../../../app/api/settings/route"
import * as searchRoute from "../../../app/api/search/[source]/route"
import * as citationRoute from "../../../app/api/citations/route"

const mocks = vi.hoisted(() => ({ search: vi.fn(), citations: vi.fn(), s2: vi.fn() }))
vi.mock("../../papers/search-core", () => ({ handleSearch: mocks.search }))
vi.mock("../../papers/citations-core", () => ({ handleCitations: mocks.citations }))
vi.mock("../../papers/s2", () => ({ searchS2: mocks.s2 }))

let storage: MemoryVaultStorage
const request = (method: string, data: unknown, origin = "http://127.0.0.1:3113") => new Request("http://127.0.0.1:3113/api/settings/paper-sources", {
  method, headers: { host: "127.0.0.1:3113", origin }, body: JSON.stringify(data),
})
beforeEach(() => {
  storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  vi.stubEnv("S2_API_KEY", "")
  vi.clearAllMocks()
  mocks.search.mockResolvedValue({ status: 200, body: { papers: [] } })
  mocks.citations.mockResolvedValue({ status: 200, body: { references: [] } })
  mocks.s2.mockResolvedValue([])
})
afterEach(() => { setServerVaultForTests(null); vi.unstubAllEnvs() })

describe("paper source APIs", () => {
  it("saves, reads and removes without returning secret material on any settings response", async () => {
    const saved = await settings.PUT(request("PUT", { apiKey: "private-s2-secret" }))
    expect(saved.status).toBe(200)
    expect(await saved.text()).not.toContain("private-s2-secret")
    expect(await getServerS2Key()).toBe("private-s2-secret")
    const read = await settings.GET()
    expect(read.headers.get("cache-control")).toBe("no-store")
    expect(await read.json()).toEqual({ enabledSources: ["arxiv", "openalex", "s2", "pubmed"], s2: { mode: "authenticated", keySource: "vault", savedKeyPresent: true } })
    expect(await (await allSettings.GET()).text()).not.toContain("private-s2-secret")
    expect((await settings.PUT(request("PUT", { apiKey: null }))).status).toBe(200)
    expect(await getServerS2Key()).toBeUndefined()
  })
  it.each([{}, [], { apiKey: 3 }, { apiKey: "bad\nheader" }, { apiKey: "valid", baseUrl: "https://evil.test" },
    { enabledSources: [] }, { enabledSources: ["bogus"] }, { enabledSources: ["s2", "s2"] }, { enabledSources: null },
  ])("rejects malformed settings %j", async (payload) => {
    expect((await settings.PUT(request("PUT", payload))).status).toBe(400)
    expect(await getServerS2Key()).toBeUndefined()
  })
  it("rejects cross-origin writes and probes before reading a credential or calling the source", async () => {
    expect((await settings.PUT(request("PUT", { enabledSources: ["pubmed"] }, "https://evil.test"))).status).toBe(403)
    expect((await settings.PUT(request("PUT", { apiKey: "secret" }, "https://evil.test"))).status).toBe(403)
    expect((await testConnection.POST(request("POST", {}, "https://evil.test"))).status).toBe(403)
    expect(mocks.s2).not.toHaveBeenCalled()
    expect(await storage.read(".scispark/settings.json")).toBeNull()
  })
  it("persists multiple selections without changing or testing the key, and blocks disabled search relays", async () => {
    await saveS2Key(storage, "private-key")
    const response = await settings.PUT(request("PUT", { enabledSources: ["arxiv", "pubmed"] }))
    expect(response.status).toBe(200)
    expect((await response.json()).enabledSources).toEqual(["arxiv", "pubmed"])
    expect(await getServerS2Key()).toBe("private-key")
    expect(mocks.s2).not.toHaveBeenCalled()
    expect((await (await settings.GET()).json()).enabledSources).toEqual(["arxiv", "pubmed"])
    const denied = await searchRoute.GET(new NextRequest("http://127.0.0.1:3113/api/search/s2?q=test"), { params: Promise.resolve({ source: "s2" }) })
    expect(denied.status).toBe(403)
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it("tests only the stored key and rejects arbitrary probe payloads", async () => {
    await saveS2Key(storage, "saved-secret")
    expect((await testConnection.POST(request("POST", { apiKey: "forged-secret" }))).status).toBe(400)
    const result = await testConnection.POST(request("POST", {}))
    expect((await result.json()).result.outcome).toBe("ok")
    expect(mocks.s2).toHaveBeenCalledWith({ query: "machine learning", limit: 1 }, expect.objectContaining({ apiKey: "saved-secret" }))
  })
  it("wires the saved key into the search relay and citation route", async () => {
    await saveS2Key(storage, "saved-secret")
    await searchRoute.GET(new NextRequest("http://127.0.0.1:3113/api/search/s2?q=attention"), { params: Promise.resolve({ source: "s2" }) })
    expect(mocks.search).toHaveBeenCalledWith("s2", expect.anything(), expect.objectContaining({ env: expect.objectContaining({ S2_API_KEY: "saved-secret" }) }))
    await citationRoute.GET(new NextRequest("http://127.0.0.1:3113/api/citations?id=DOI:10.1/example"))
    expect(mocks.citations).toHaveBeenCalledWith({ id: "DOI:10.1/example" }, { apiKey: "saved-secret" })
  })
  it("does not echo corrupted settings in error responses or overwrite them", async () => {
    await storage.write(".scispark/settings.json", "malformed-private-secret")
    for (const response of [await settings.GET(), await settings.PUT(request("PUT", { apiKey: "replacement" })), await testConnection.POST(request("POST", {}))]) {
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain("malformed-private-secret")
    }
    expect(await storage.read(".scispark/settings.json")).toBe("malformed-private-secret")
  })
})
