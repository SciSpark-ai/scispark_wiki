import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { getPaperSourceStatus, getServerS2Key, saveS2Key, testS2Connection } from "../paper-source-settings"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import { exportVaultZip } from "../../vault/export"
import { unzipSync } from "fflate"

let storage: MemoryVaultStorage
beforeEach(() => {
  storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  vi.stubEnv("S2_API_KEY", "")
})
afterEach(() => { setServerVaultForTests(null); vi.unstubAllEnvs() })

describe("personal Semantic Scholar credentials", () => {
  it("is anonymous by default; vault keys override the environment without a restart", async () => {
    expect(await getPaperSourceStatus()).toEqual({ mode: "anonymous", keySource: null, savedKeyPresent: false })
    vi.stubEnv("S2_API_KEY", "environment-key")
    expect(await getServerS2Key()).toBe("environment-key")
    await saveS2Key(storage, "  private-key  ")
    expect(await getServerS2Key()).toBe("private-key")
    const status = await getPaperSourceStatus()
    expect(status).toEqual({ mode: "authenticated", keySource: "vault", savedKeyPresent: true })
    expect(JSON.stringify(status)).not.toContain("private-key")
    await saveS2Key(storage, null)
    expect(await getServerS2Key()).toBe("environment-key")
    expect((await getPaperSourceStatus()).keySource).toBe("environment")
    vi.stubEnv("S2_API_KEY", "")
    expect(await getServerS2Key()).toBeUndefined()
  })

  it("preserves concurrent AI settings and excludes source secrets from vault exports", async () => {
    await Promise.all([
      saveS2Key(storage, "source-secret"),
      saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "ai-secret" } }),
    ])
    const file = JSON.parse((await storage.read(".scispark/settings.json"))!)
    expect(file.llm.keys.openai).toBe("ai-secret")
    expect(await getServerS2Key()).toBe("source-secret")
    const exported = unzipSync(await exportVaultZip(storage))
    expect(Object.keys(exported)).not.toContain(".scispark/settings.json")
  })

  it.each(["", "two words", "key\nforged", "x".repeat(2049)])("rejects invalid credentials without storing them", async (key) => {
    await expect(saveS2Key(storage, key)).rejects.toThrow()
    expect(await storage.read(".scispark/settings.json")).toBeNull()
  })

  it("tests the saved key against the fixed S2 search endpoint, not the AI provider", async () => {
    await saveS2Key(storage, "private-key")
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }))
    const result = await testS2Connection({ fetchFn })
    expect(result.outcome).toBe("ok")
    const [url, init] = fetchFn.mock.calls[0]
    expect(new URL(String(url)).origin).toBe("https://api.semanticscholar.org")
    expect(new URL(String(url)).pathname).toBe("/graph/v1/paper/search")
    expect(new URL(String(url)).searchParams.get("limit")).toBe("1")
    expect(new Headers(init?.headers).get("x-api-key")).toBe("private-key")
    expect(JSON.stringify(result)).not.toContain("private-key")
  })

  it.each([[429, "rate_limited"], [401, "rejected"], [403, "rejected"], [500, "unavailable"]])("maps HTTP %s safely", async (status, outcome) => {
    await saveS2Key(storage, "private-key")
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-key", { status: Number(status) }))
    const result = await testS2Connection({ fetchFn })
    expect(result.outcome).toBe(outcome)
    expect(JSON.stringify(result)).not.toContain("private-key")
  })

  it("does not send an anonymous probe, and sanitizes network failures", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-key"))
    expect((await testS2Connection({ fetchFn })).outcome).toBe("missing_key")
    expect(fetchFn).not.toHaveBeenCalled()
    await saveS2Key(storage, "private-key")
    const result = await testS2Connection({ fetchFn })
    expect(result.outcome).toBe("unavailable")
    expect(JSON.stringify(result)).not.toContain("private-key")
  })
  it.each(["null", "[]", '{"paperSources":{"s2":{"apiKey":123}}}'])("does not overwrite corrupt settings %s", async (raw) => {
    await storage.write(".scispark/settings.json", raw)
    await expect(saveS2Key(storage, "replacement")).rejects.toThrow()
    expect(await storage.read(".scispark/settings.json")).toBe(raw)
  })
  it.each([null, [], {}, { data: "unexpected" }])("does not call malformed success responses verified: %j", async (body) => {
    await saveS2Key(storage, "private-key")
    expect((await testS2Connection({ fetchFn: async () => Response.json(body) })).outcome).toBe("unavailable")
  })
  it("never includes malformed key-file fragments in errors returned to source callers", async () => {
    await storage.write(".scispark/settings.json", "private-key-fragment")
    await expect(getServerS2Key()).rejects.toThrow("Invalid settings file")
    await expect(getServerS2Key()).rejects.not.toThrow("private-key-fragment")
  })
})
