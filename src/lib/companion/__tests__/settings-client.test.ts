import { describe, it, expect } from "vitest"
import { loadCompanionSettingsRemote, saveCompanionSettingsRemote } from "../settings-client"
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
  trending: { fields: [], cadence: "weekly" },
  ui: { theme: "system" },
}

describe("companion settings client", () => {
  it("loadCompanionSettingsRemote GETs /api/settings and returns the companion sub-object", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse(BASE))
    }) as unknown as typeof fetch

    const companion = await loadCompanionSettingsRemote(fetchFn)
    expect(companion).toEqual({ chattiness: "medium", companionName: "Ember" })
    expect(calls[0].url).toBe("/api/settings")
    expect(calls[0].init?.method ?? "GET").toBe("GET")
  })

  it("saveCompanionSettingsRemote PUTs the full companion object and returns the stored view", async () => {
    let sentBody: unknown
    const fetchFn = ((_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body))
      return Promise.resolve(jsonResponse({ ...BASE, companion: { chattiness: "high", companionName: "Q" } }))
    }) as unknown as typeof fetch

    const result = await saveCompanionSettingsRemote({ chattiness: "high", companionName: "Q" }, fetchFn)
    expect(sentBody).toEqual({ companion: { chattiness: "high", companionName: "Q" } })
    expect(result).toEqual({ chattiness: "high", companionName: "Q" })
  })

  it("surfaces the server error message on a non-ok response", async () => {
    const fetchFn = (() =>
      Promise.resolve(jsonResponse({ error: "boom" }, 500))) as unknown as typeof fetch
    await expect(loadCompanionSettingsRemote(fetchFn)).rejects.toThrow("boom")
  })
})
