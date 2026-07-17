import { describe, it, expect } from "vitest"
import { loadTrendingSettingsRemote, saveTrendingSettingsRemote } from "../settings-client"
import type { SettingsResponse } from "@/app/api/settings/route"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const BASE: SettingsResponse = {
  settings: {
    keys: {},
    tierModels: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5" },
      strong: { provider: "anthropic", model: "claude-opus-4-8" },
    },
    dailyBudgetUsd: 5,
  },
  companion: { chattiness: "medium", companionName: "Ember" },
  trending: { fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" },
  ui: { theme: "system" },
}

describe("trending settings client", () => {
  it("loadTrendingSettingsRemote GETs /api/settings and returns the trending sub-object", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse(BASE))
    }) as unknown as typeof fetch

    const trending = await loadTrendingSettingsRemote(fetchFn)
    expect(trending).toEqual({ fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" })
    expect(calls[0].url).toBe("/api/settings")
    expect(calls[0].init?.method ?? "GET").toBe("GET")
  })

  it("saveTrendingSettingsRemote PUTs the full trending object and returns the stored view", async () => {
    let sentBody: unknown
    const next = { fields: [{ slug: "cv", label: "CV" }], cadence: "weekly" as const }
    const fetchFn = ((_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body))
      return Promise.resolve(jsonResponse({ ...BASE, trending: next }))
    }) as unknown as typeof fetch

    const result = await saveTrendingSettingsRemote(next, fetchFn)
    expect(sentBody).toEqual({ trending: next })
    expect(result).toEqual(next)
  })

  it("surfaces the server error message on a non-ok response", async () => {
    const fetchFn = (() =>
      Promise.resolve(jsonResponse({ error: "settings are managed via /api/settings" }, 403))) as unknown as typeof fetch
    await expect(saveTrendingSettingsRemote({ fields: [], cadence: "weekly" }, fetchFn)).rejects.toThrow(
      "settings are managed via /api/settings",
    )
  })
})
