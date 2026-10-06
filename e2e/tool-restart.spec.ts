import { expect, test, request as playwrightRequest } from "@playwright/test"
import { createServer } from "node:net"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { NATIVE_TOOL_MANIFESTS } from "../src/lib/extensions/native-catalog"
import { openVault } from "../src/lib/vault/scaffold"
import { saveSettings } from "../src/lib/llm/settings"
import { importTool, startTool, snapshot, providerRows, readRunFile, runDir } from "./fixtures/modular"

test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} })

test("owned production server kill/restart preserves completed hashes and never repeats uncertain model work", async ({ browser }, info) => {
  test.skip(process.env.SCISPARK_E2E_SERVER_MODE !== "start", "Requires isolated production build")
  test.setTimeout(120000)
  const root = join(runDir(), "dedicated-restart"), vault = join(root, "vault")
  await mkdir(root)
  const storage = new NodeFsVaultStorage(vault)
  await openVault(storage)
  const disabled = NATIVE_TOOL_MANIFESTS[0].ref
  await storage.write(".scispark/tools/state.json", JSON.stringify({ schemaVersion: 1, enabled: [{ tool: disabled, enabled: false }], pins: [disabled], overrides: [], migrated: false }))
  await saveSettings(storage, { keys: { openai: "fixture-local-only" }, tierModels: { fast: { provider: "openai", model: "gpt-5.4-mini" }, strong: { provider: "openai", model: "gpt-5.4-mini" } }, dailyBudgetUsd: 100 })
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening")
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const baseURL = `http://127.0.0.1:${port}`
  const evidence = join(runDir(), "evidence"); await mkdir(evidence, { recursive: true })
  let child: ChildProcess | undefined, logs = ""
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      await appendFile(join(evidence, "restart-process.jsonl"), JSON.stringify({ action: "kill-owned-server", pid: child.pid, signal: "SIGKILL" }) + "\n")
      const ended = once(child, "exit"); child.kill("SIGKILL"); await ended
    }
    child = undefined
  }
  const start = async () => {
    child = spawn(process.execPath, ["--import", "./e2e/fixtures/modular-network.mjs", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, SCISPARK_VAULT: vault, SCISPARK_PROFILES_DIR: join(root, "profiles"), SCISPARK_SCHEDULER: "off", SCISPARK_LIVE_GATE_DIST_DIR: process.env.SCISPARK_E2E_DIST_DIR, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout?.on("data", b => { logs += b }); child.stderr?.on("data", b => { logs += b })
    await appendFile(join(evidence, "restart-process.jsonl"), JSON.stringify({ action: "start-owned-production", pid: child.pid, port }) + "\n")
    await expect.poll(async () => { try { return (await fetch(`${baseURL}/api/local-profiles/session`)).status } catch { return 0 } }, { timeout: 15000 }).toBe(200)
  }
  let api = await playwrightRequest.newContext({ baseURL })
  const hashes = async (id: string) => {
    const dir = join(vault, ".scispark/tool-runs", id, "steps")
    const rows = await Promise.all((await readdir(dir)).map(async f => JSON.parse(await readFile(join(dir, f), "utf8"))))
    return rows.filter(r => r.state === "completed").map(r => ({ id: r.intent.id, inputHash: r.intent.inputHash, responseHash: r.responseHash })).sort((a, b) => a.id.localeCompare(b.id))
  }
  try {
    await start()
    const { profiles } = await (await api.get("/api/local-profiles")).json()
    expect((await api.post("/api/local-profiles/session", { data: { profileId: profiles[0].id } })).ok()).toBe(true)
    const state = await api.storageState(); await api.dispose()
    api = await playwrightRequest.newContext({ baseURL, storageState: state, extraHTTPHeaders: { "x-scispark-profile": profiles[0].id } })
    const migrated = (await (await api.get("/api/tools?view=library")).json()).result
    expect(migrated.tools.find((tool: { ref: { skillId: string } }) => tool.ref.skillId === disabled.skillId).enabled).toBe(false)
    expect(migrated.tools.filter((tool: { enabled: boolean }) => tool.enabled)).toHaveLength(NATIVE_TOOL_MANIFESTS.length - 1)
    const migratedState = JSON.parse((await storage.read(".scispark/tools/state.json"))!)
    expect(migratedState.migrated).toBe(true)
    const { ref } = await importTool(api, "Restart acceptance")
    const completed = await startTool(api, ref, "MODULAR:restart-completed")
    await expect.poll(async () => (await snapshot(api, completed.id)).status, { timeout: 25000 }).toBe("completed")
    const completedHashes = await hashes(completed.id)
    expect(completedHashes.length).toBeGreaterThan(2)
    for (const step of completedHashes) expect(step.responseHash).toMatch(/^[0-9a-f]{64}$/)
    const completedUsage = await readRunFile(completed.id, "usage.json", vault)
    const uncertain = await startTool(api, ref, "MODULAR:restart")
    await expect.poll(async () => (await providerRows("restart")).filter(r => r.phase === "review-synthesis").length).toBe(1)
    const before = await hashes(uncertain.id), usage = await readRunFile(uncertain.id, "usage.json", vault)
    await stop(); await start()
    const context = await browser.newContext({ baseURL, storageState: await api.storageState() })
    try {
      const page = await context.newPage(); await page.goto(`/tools/runs/${uncertain.id}`)
      await expect.poll(async () => (await snapshot(api, uncertain.id)).status).toBe("needs_attention")
      await page.goto("/wiki"); await page.goto(`/tools/runs/${uncertain.id}`); await page.reload()
      expect((await providerRows("restart")).filter(r => r.phase === "review-synthesis")).toHaveLength(1)
      expect(await hashes(uncertain.id)).toEqual(before)
      expect(await hashes(completed.id)).toEqual(completedHashes)
      expect(await readRunFile(completed.id, "usage.json", vault)).toEqual(completedUsage)
      const after = await readRunFile(uncertain.id, "usage.json", vault)
      expect(after.attempts.map((a: { ticket: { id: string } }) => a.ticket.id)).toEqual(usage.attempts.map((a: { ticket: { id: string } }) => a.ticket.id))
      expect((await snapshot(api, uncertain.id)).usage.modelCalls).toBe(3)
      expect(after.attempts.filter((a: { state: string; dispatchedAt?: string }) => a.state !== "known" && a.dispatchedAt)).toHaveLength(1)
      const held = (await snapshot(api, uncertain.id)).observation.usage
      expect(held.heldAttempts).toBe(1)
      expect(held.heldCostUsd).toBeGreaterThan(0)
      await page.screenshot({ path: info.outputPath("restart-needs-attention.png"), fullPage: true })
      await writeFile(join(evidence, "restart-integrity.json"), JSON.stringify({ completed: { id: completed.id, hashes: completedHashes, usage: completedUsage }, uncertain: { id: uncertain.id, before, after, provider: await providerRows("restart") } }, null, 2))
    } finally { await context.close() }
  } finally { await stop(); await api.dispose(); await writeFile(join(evidence, "restart-server.log"), logs) }
})
