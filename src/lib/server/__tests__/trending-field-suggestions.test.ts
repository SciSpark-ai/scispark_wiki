import { describe, it, expect, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { POST } from "../../../app/api/settings/trending/suggestions/route"

afterEach(() => { setServerVaultForTests(null); setSkillTestOverrides() })
function request(body: unknown) { return new Request("http://localhost/api/settings/trending/suggestions", { method: "POST", body: JSON.stringify(body) }) }

describe("Trending field suggestions", () => {
  it("returns canonical suggestions without changing settings or selecting them", async () => {
    const storage = new MemoryVaultStorage()
    const original = JSON.stringify({ trending: { anchors: [], anchorsOverridden: false }, llm: { keys: { openai: "fixture-secret" } } })
    await storage.write(".scispark/settings.json", original)
    setServerVaultForTests(storage)
    const queries: string[] = []
    setSkillTestOverrides({ fieldGroupFn: async (query) => {
      queries.push(query.query)
      return [{ key: "28", label: "Anything", count: 100 }]
    } })
    const response = await POST(request({ labels: ["hearing", "attention"] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ anchors: [{ id: "https://openalex.org/fields/28", label: "Neuroscience" }] })
    expect(queries).toEqual(["hearing", "attention"])
    expect(await storage.read(".scispark/settings.json")).toBe(original)
  })
  it("reports unavailable suggestions rather than substituting arbitrary topics", async () => {
    setSkillTestOverrides({ fieldGroupFn: async () => { throw new Error("offline") } })
    expect((await POST(request({ labels: ["hearing"] }))).status).toBe(503)
  })
  it.each([{ labels: [] }, { labels: [""] }, { labels: ["a", "b", "c", "d"] }, { labels: ["a".repeat(121)] }, { labels: ["x"], extra: "ignored?" }])("rejects invalid inputs before retrieval: %j", async (body) => {
    let calls = 0
    setSkillTestOverrides({ fieldGroupFn: async () => { calls++; return [] } })
    expect((await POST(request(body))).status).toBe(400)
    expect(calls).toBe(0)
  })
})
