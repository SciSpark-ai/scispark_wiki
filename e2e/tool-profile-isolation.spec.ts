import { expect, test } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { toolKey } from "../src/lib/extensions/contracts"
import { join } from "node:path"
import { saveSettings } from "../src/lib/llm/settings"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { importTool, startTool, snapshot, providerRows, runDir } from "./fixtures/modular"

test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} })

test("explicit profiles isolate tools, overrides and live runs while switching does not cancel the owner", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const api = context.request
  try {
    const a = (await (await api.post("/api/local-profiles", { data: { name: "Modular Ada" } })).json()).profile
    const b = (await (await api.post("/api/local-profiles", { data: { name: "Modular Grace" } })).json()).profile
    for (const profile of [a, b]) {
      expect(profile.vaultPath.startsWith(join(runDir(), "profiles")) || profile.vaultPath.startsWith(join("/private", runDir(), "profiles"))).toBe(true)
      await saveSettings(new NodeFsVaultStorage(profile.vaultPath), { keys: { openai: "fixture-local-only" }, tierModels: { fast: { provider: "openai", model: "gpt-5.4-mini" }, strong: { provider: "openai", model: "gpt-5.4-mini" } }, dailyBudgetUsd: 100 })
    }
    await api.post("/api/local-profiles/session", { data: { profileId: a.id } })
    await context.setExtraHTTPHeaders({ "x-scispark-profile": a.id })
    const { ref } = await importTool(api, "Ada private evidence")
    const bound = await api.post(`/api/tools/${encodeURIComponent(toolKey(ref))}`, { data: { action: "binding", operationId: randomUUID(), patch: { defaultAllowance: { modelCalls: 4 }, roleTiers: { root: "fast" } } } })
    expect(bound.ok(), await bound.text()).toBe(true)
    const run = await startTool(api, ref, "MODULAR:profile")
    expect(run.allowance.modelCalls).toBe(4)
    await expect.poll(async () => (await providerRows("profile")).some(r => r.phase === "review-synthesis")).toBe(true)
    const page = await context.newPage()
    await page.goto(`/tools/runs/${run.id}`)
    await expect(page.getByText("Working", { exact: true })).toBeVisible()
    await api.post("/api/local-profiles/session", { data: { profileId: b.id } })
    await context.setExtraHTTPHeaders({ "x-scispark-profile": b.id })
    await page.goto("/tools")
    await expect(page.getByRole("heading", { name: "No tools installed" })).toBeVisible()
    expect((await (await api.get("/api/tools/runs")).json()).result).toEqual([])
    expect((await api.get(`/api/tools/runs/${run.id}`)).status()).toBe(404)
    expect((await api.get(`/api/tools/runs/${run.id}`, { headers: { "x-scispark-profile": a.id } })).status()).toBe(409)
    await api.post("/api/local-profiles/session", { data: { profileId: a.id } })
    await context.setExtraHTTPHeaders({ "x-scispark-profile": a.id })
    await page.goto(`/tools/runs/${run.id}`)
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 25000 })
    expect((await snapshot(api, run.id)).tool).toEqual(ref)
    const owner = new NodeFsVaultStorage(a.vaultPath)
    const saved = JSON.parse((await owner.read(`.scispark/tool-runs/${run.id}/run.json`))!)
    expect(saved.model.roleTiers.root).toBe("fast")
    expect(JSON.parse((await new NodeFsVaultStorage(b.vaultPath).read(".scispark/tools/state.json"))!).overrides).toEqual([])
    expect((await providerRows("profile")).filter(row => row.phase === "review-synthesis")).toHaveLength(1)
  } finally { await context.close() }
})
