import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import * as searchIntentRoute from "../../../app/api/skills/search-intent/route"
import type { SearchIntentRouteResult } from "../../../app/api/skills/search-intent/route"

function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}

async function jsonResult<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { result: T }
  return body.result
}

describe("POST /api/skills/search-intent", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    // A key must be present for the happy-path provider build to succeed.
    await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }))
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  it("returns the classified sort from the skill", async () => {
    setSkillTestOverrides({ providerOverride: { fast: new MockProvider([structured({ sort: "date" })]) } })

    const res = await searchIntentRoute.POST(
      new Request("http://x/api/skills/search-intent", { method: "POST", body: JSON.stringify({ query: "latest LLM papers" }) }),
    )
    expect(res.status).toBe(200)
    const result = await jsonResult<SearchIntentRouteResult>(res)
    expect(result.sort).toBe("date")
    expect(typeof result.costUsd).toBe("number")
  })

  it("degrades to 'relevance' (still HTTP 200) when the skill run fails — e.g. no LLM key configured", async () => {
    // No providerOverride; a fresh vault with a key is present, but drop it so
    // buildProvider throws MissingKeyError inside the run.
    await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: {} }))
    setSkillTestOverrides({})

    const res = await searchIntentRoute.POST(
      new Request("http://x/api/skills/search-intent", { method: "POST", body: JSON.stringify({ query: "auditory attention decoding EEG" }) }),
    )
    // The route must NOT propagate the failure — search must never break because
    // intent classification did. It returns the safe default.
    expect(res.status).toBe(200)
    const result = await jsonResult<SearchIntentRouteResult>(res)
    expect(result.sort).toBe("relevance")
    expect(result.costUsd).toBe(0)
  })
})
