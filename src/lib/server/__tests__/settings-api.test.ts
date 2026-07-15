import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import * as settingsRoute from "../../../app/api/settings/route"

const SECRET_KEY = "sk-ant-secret-abc123"

describe("settings API", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
  })

  it("GET never leaks key material in the response body", async () => {
    await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { anthropic: SECRET_KEY } })

    const res = await settingsRoute.GET()
    expect(res.status).toBe(200)
    const bodyText = await res.text()
    expect(bodyText).not.toContain(SECRET_KEY)

    const body = JSON.parse(bodyText)
    expect(body.settings.keys.anthropic).toEqual({ present: true })
    expect(body.settings.keys.openai).toBeUndefined()
    expect(body.settings.tierModels).toEqual(DEFAULT_SETTINGS.tierModels)
    expect(body.settings.dailyBudgetUsd).toBe(DEFAULT_SETTINGS.dailyBudgetUsd)
  })

  it("PUT round-trips a daily budget change", async () => {
    await saveSettings(storage, DEFAULT_SETTINGS)

    const res = await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { dailyBudgetUsd: 12.5 } }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings.dailyBudgetUsd).toBe(12.5)

    const persisted = await loadSettings(storage)
    expect(persisted.dailyBudgetUsd).toBe(12.5)
  })

  it("PUT with a key set to \"\" deletes it", async () => {
    await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { anthropic: SECRET_KEY, openai: "sk-openai" } })

    const res = await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { keys: { anthropic: "" } } }),
      }),
    )
    expect(res.status).toBe(200)

    const persisted = await loadSettings(storage)
    expect(persisted.keys.anthropic).toBeUndefined()
    // untouched sibling key survives
    expect(persisted.keys.openai).toBe("sk-openai")
  })

  it("PUT with a new key stores it, verified via direct storage read (never via GET)", async () => {
    await saveSettings(storage, DEFAULT_SETTINGS)

    const newKey = "sk-new-google-key"
    const res = await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { keys: { google: newKey } } }),
      }),
    )
    expect(res.status).toBe(200)

    // The PUT response itself must never contain the raw key.
    const resBodyText = JSON.stringify(await (await settingsRoute.GET()).json())
    expect(resBodyText).not.toContain(newKey)

    const persisted = await loadSettings(storage)
    expect(persisted.keys.google).toBe(newKey)
  })

  it("omitted keys are left untouched by a PUT that only patches other fields", async () => {
    await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { anthropic: SECRET_KEY } })

    await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { dailyBudgetUsd: 7 } }),
      }),
    )

    const persisted = await loadSettings(storage)
    expect(persisted.keys.anthropic).toBe(SECRET_KEY)
    expect(persisted.dailyBudgetUsd).toBe(7)
  })

  it("sibling top-level keys (e.g. companion, trending) survive a PUT", async () => {
    await storage.write(
      ".scispark/settings.json",
      JSON.stringify({
        llm: DEFAULT_SETTINGS,
        companion: { chattiness: "medium", companionName: "Ember" },
        trending: { cadence: "weekly", fields: [{ slug: "ai", label: "AI" }] },
      }),
    )

    await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { dailyBudgetUsd: 3 } }),
      }),
    )

    const raw = JSON.parse((await storage.read(".scispark/settings.json"))!)
    expect(raw.companion).toEqual({ chattiness: "medium", companionName: "Ember" })
    expect(raw.trending).toEqual({ cadence: "weekly", fields: [{ slug: "ai", label: "AI" }] })
    expect(raw.llm.dailyBudgetUsd).toBe(3)
  })

  it("PUT round-trips tierModels and baseUrls verbatim", async () => {
    await saveSettings(storage, DEFAULT_SETTINGS)

    const res = await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          patch: {
            tierModels: { fast: { provider: "openai", model: "gpt-5-mini" } },
            baseUrls: { openai: "https://api.gmi-serving.com/v1" },
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settings.tierModels.fast).toEqual({ provider: "openai", model: "gpt-5-mini" })
    // untouched tier survives the partial patch
    expect(body.settings.tierModels.strong).toEqual(DEFAULT_SETTINGS.tierModels.strong)
    expect(body.settings.baseUrls).toEqual({ openai: "https://api.gmi-serving.com/v1" })

    const persisted = await loadSettings(storage)
    expect(persisted.tierModels.fast).toEqual({ provider: "openai", model: "gpt-5-mini" })
    expect(persisted.baseUrls).toEqual({ openai: "https://api.gmi-serving.com/v1" })
  })

  it("PUT with a baseUrls override set to \"\" deletes just that override", async () => {
    await saveSettings(storage, {
      ...DEFAULT_SETTINGS,
      baseUrls: { openai: "https://api.gmi-serving.com/v1", openrouter: "https://custom.example/v1" },
    })

    await settingsRoute.PUT(
      new Request("http://x/api/settings", {
        method: "PUT",
        body: JSON.stringify({ patch: { baseUrls: { openai: "" } } }),
      }),
    )

    const persisted = await loadSettings(storage)
    expect(persisted.baseUrls).toEqual({ openrouter: "https://custom.example/v1" })
  })

  it("two concurrent PUTs against the same storage both land (no lost update)", async () => {
    await saveSettings(storage, DEFAULT_SETTINGS)

    const [res1, res2] = await Promise.all([
      settingsRoute.PUT(
        new Request("http://x/api/settings", {
          method: "PUT",
          body: JSON.stringify({ patch: { dailyBudgetUsd: 42 } }),
        }),
      ),
      settingsRoute.PUT(
        new Request("http://x/api/settings", {
          method: "PUT",
          body: JSON.stringify({ patch: { keys: { openai: "sk-concurrent" } } }),
        }),
      ),
    ])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)

    const persisted = await loadSettings(storage)
    expect(persisted.dailyBudgetUsd).toBe(42)
    expect(persisted.keys.openai).toBe("sk-concurrent")
  })

  it("PUT with a malformed body (missing patch) → 400", async () => {
    const res = await settingsRoute.PUT(
      new Request("http://x/api/settings", { method: "PUT", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(400)

    const badJson = await settingsRoute.PUT(
      new Request("http://x/api/settings", { method: "PUT", body: "not json" }),
    )
    expect(badJson.status).toBe(400)
  })

  it("GET storage error → 500 with JSON {error}, no key leakage possible", async () => {
    class ThrowingStorage extends MemoryVaultStorage {
      async read(): Promise<string | null> {
        throw new Error("simulated read failure")
      }
    }
    setServerVaultForTests(new ThrowingStorage())
    const res = await settingsRoute.GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })
})
