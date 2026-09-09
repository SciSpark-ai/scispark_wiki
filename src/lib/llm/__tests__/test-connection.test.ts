import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS, saveSettings, type LLMSettings } from "../settings"
import { MockProvider } from "../mock-provider"
import type { LLMResult } from "../types"
import { testConnection } from "../test-connection"
import { setServerVaultForTests } from "../../server/vault"
import { setSkillTestOverrides } from "../../server/skill-route"
import { POST } from "@/app/api/settings/test-connection/route"

const ready: LLMResult = { text: '{"message":"ready"}', json: { message: "ready" }, model: "gpt-5.4-mini",
  provider: "openai", stopReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } }
const settings: LLMSettings = { ...DEFAULT_SETTINGS, keys: { openai: "test-secret" }, tierModels: {
  strong: { provider: "openai", model: "gpt-5.6-sol" }, fast: { provider: "openai", model: "gpt-5.4-mini" },
} }
describe("BYOK connection verification", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => { storage = new MemoryVaultStorage(); await saveSettings(storage, settings); setServerVaultForTests(storage) })
  afterEach(() => { setServerVaultForTests(null); setSkillTestOverrides() })
  it("tests analysis and quick-steps models before reporting success", async () => {
    const strong = new MockProvider([ready]), fast = new MockProvider([ready])
    const result = await testConnection(storage, { strong, fast })
    expect(result.status).toBe("ok")
    expect(result.testedTiers).toEqual(["strong", "fast"])
    expect(strong.calls[0].model).toBe("gpt-5.6-sol")
    expect(fast.calls[0].model).toBe("gpt-5.4-mini")
    expect(result.costUsd).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain("test-secret")
    expect(JSON.stringify(strong.calls)).not.toContain("test-secret")
  })
  it("does not hand off if the analysis model fails, even if the fast model works", async () => {
    const strong = new MockProvider([new Error("Provider echoed Authorization: test-secret")]), fast = new MockProvider([ready])
    const result = await testConnection(storage, { strong, fast })
    expect(result.status).toBe("error")
    expect(result.error).toContain("analysis model")
    expect(result.testedTiers).toEqual([])
    expect(JSON.stringify(result)).not.toContain("test-secret")
    expect(fast.calls).toHaveLength(0)
  })
  it("does not hand off if only the fast model fails", async () => {
    const result = await testConnection(storage, { strong: new MockProvider([ready]), fast: new MockProvider([new Error("Model not available")]) })
    expect(result.status).toBe("error")
    expect(result.error).toContain("quick-steps model")
    expect(result.testedTiers).toEqual(["strong"])
  })
  it("makes one call when both tiers use the same model and preserves unknown pricing", async () => {
    const model = { provider: "openai" as const, model: "google/gemini-3.8-flash" }
    await saveSettings(storage, { ...settings, tierModels: { strong: model, fast: model } })
    const strong = new MockProvider([{ ...ready, model: model.model }]), fast = new MockProvider([])
    const result = await testConnection(storage, { strong, fast })
    expect(result).toMatchObject({ status: "ok", testedTiers: ["strong", "fast"], costUsd: null })
    expect(strong.calls).toHaveLength(1)
    expect(fast.calls).toHaveLength(0)
  })
  it("rejects unsafe origins and client-supplied configuration before calling a provider", async () => {
    const strong = new MockProvider([ready])
    setSkillTestOverrides({ providerOverride: { strong } })
    for (const [headers, body, status] of [
      [{ host: "127.0.0.1:3112", origin: "https://evil.example" }, "{}", 403],
      [{ host: "evil.example" }, "{}", 403],
      [{ host: "127.0.0.1:3112" }, '{"key":"forged"}', 400],
    ] as const) {
      const response = await POST(new Request("http://127.0.0.1:3112/api/settings/test-connection", { method: "POST", headers, body }))
      expect(response.status).toBe(status)
    }
    expect(strong.calls).toHaveLength(0)
  })
})
