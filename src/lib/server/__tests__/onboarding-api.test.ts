import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as route from "@/app/api/onboarding/route"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { ONBOARDING_PATH, type OnboardingState } from "../../onboarding/contract"
import { FEED_CACHE_PATH } from "../../skills/feed-cache"

const origin = "http://127.0.0.1:3112"
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/onboarding", { method: "POST",
    headers: { host: "127.0.0.1:3112", origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
}
describe("onboarding API boundaries", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
    await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "private-fixture-key" },
      tierModels: { strong: { provider: "openai", model: "gpt-5.4-mini" }, fast: { provider: "openai", model: "gpt-5.4-mini" } } })
  })
  afterEach(() => { setServerVaultForTests(null); setSkillTestOverrides() })
  it("returns a name-first draft without exposing settings or initiating a feed", async () => {
    const response = await route.GET()
    expect(response.status).toBe(200)
    const state = await response.json()
    expect(state).toMatchObject({ question: "name", connected: true, onboarded: false, revision: null })
    expect(state.messages[0].content).toContain("What should I call you?")
    expect(JSON.stringify(state)).not.toContain("private-fixture-key")
    expect(await storage.read(ONBOARDING_PATH)).toBeNull()
    expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
  })
  it("rejects unsafe Host/Origin and forged configuration or transcript fields", async () => {
    const before = storage.snapshot()
    for (const [body, headers, status] of [
      [{ action: "message", revision: null, message: "Ada" }, { origin: "https://evil.example" }, 403],
      [{ action: "message", revision: null, message: "Ada" }, { host: "evil.example" }, 403],
      [{ action: "message", revision: null, message: "Ada", draft: { learnFromFeedback: true } }, {}, 400],
      [{ action: "message", revision: "../../settings.json", message: "Ada" }, {}, 400],
    ] as const) expect((await route.POST(request(body, headers))).status).toBe(status)
    expect(storage.snapshot()).toEqual(before)
  })
  it("streams a validated reply, keeps the raw answer, and rejects stale replay without another call", async () => {
    const json = { message: "Which fields do you work in?", draft: { name: "Ada", role: "", fields: "", topics: "", feedPrefs: "", diversity: null, diversityNote: "", learnFromFeedback: null }, question: "research" }
    const provider = new MockProvider([{ json, text: JSON.stringify(json), provider: "openai", model: "gpt-5.4-mini", stopReason: "stop", usage: { inputTokens: 10, outputTokens: 10 } }])
    setSkillTestOverrides({ providerOverride: { strong: provider } })
    const first = await route.POST(request({ action: "message", revision: null, message: "Call me Ada" }))
    expect(first.headers.get("content-type")).toContain("application/x-ndjson")
    const result = await readNdjson(first, () => {}) as { state: OnboardingState }
    expect(result.state.messages[1].content).toBe("Call me Ada")
    expect(result.state.pending).toBe(false)
    const stale = await route.POST(request({ action: "message", revision: null, message: "Duplicate tab" }))
    await expect(readNdjson(stale, () => {})).rejects.toThrow("another tab")
    expect(provider.calls).toHaveLength(1)
    expect(await storage.read("profile.md")).toBeNull()
    expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
  })
  it("preserves corrupted conversation data and refuses confirmation without review", async () => {
    await storage.write(ONBOARDING_PATH, "corrupted")
    expect((await route.GET()).status).toBe(409)
    expect(await storage.read(ONBOARDING_PATH)).toBe("corrupted")
    await storage.delete(ONBOARDING_PATH)
    const unreviewed = await route.POST(request({ action: "confirm", revision: null, answers: {
      name: "Ada", role: "Postdoc", fields: "Neuroscience", topics: "", feedPrefs: "",
      recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null },
    } }))
    expect(unreviewed.status).toBe(409)
    expect(await storage.read("profile.md")).toBeNull()
  })
})
