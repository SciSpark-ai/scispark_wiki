import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { registerToolManifest } from "../../extensions/registry"
import { writeProfileTools } from "../../extensions/store"
import * as settings from "../../llm/settings"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import { workflowFixture } from "./fixtures"
import { readRun, writeRun, listRunEvents } from "../store"
import { registerWorkflowAdapter } from "../adapters"
import { startRun, observeRun, cancelRun, resumeRun, recoverWorkflowRuns, waitForWorkflowIdle, startWorkflowCoordinator } from "../coordinator"
import { claimRunLease, releaseRunLease, journalStep, readWorkflowJournal, transitionRun } from "../journal"
import { reserveAttempt, claimAttemptDispatch, getRunUsage, extendAllowance } from "../usage"
import { withWorkflowAttempt } from "../attempt-scope"
import type { StepIntent, RunStatus } from "../contracts"

const cleanups: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { await waitForWorkflowIdle(); vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
const step = (kind: StepIntent["kind"] = "read"): StepIntent => ({ id: randomUUID(), kind, replay: kind === "read" ? "read_only" : "reconcile", inputHash: "a".repeat(64) })
async function fixture() {
  const f = workflowFixture()
  const root = await mkdtemp(join(tmpdir(), "workflow-recovery-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  f.ctx.storage = new NodeFsVaultStorage(root)
  f.ctx.vaultPath = await realpath(root)
  f.ctx.vaultId = createHash("sha256").update(f.ctx.vaultPath).digest("hex")
  f.run.vaultId = f.ctx.vaultId
  f.tool.ref = { ...f.tool.ref, packageId: `fixture/${randomUUID()}` }
  f.tool.entrypoint = randomUUID()
  f.request.tool = f.tool.ref
  f.run.tool = f.tool.ref
  cleanups.push(registerToolManifest(f.tool))
  await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: [{ tool: f.tool.ref, enabled: true }], pins: [f.tool.ref], overrides: [], migrated: true })
  await saveSettings(f.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "fixture-only" } })
  return { ...f, reopen: () => ({ ...f.ctx, storage: new NodeFsVaultStorage(root) }) }
}
async function until(check: () => Promise<boolean>) { await vi.waitFor(async () => expect(await check()).toBe(true), { timeout: 4000, interval: 10 }) }
async function child() {
  const proc = spawn(process.execPath, ["-e", 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { stdio: ["ignore", "pipe", "pipe"] })
  await once(proc.stdout!, "data")
  cleanups.push(() => kill(proc))
  return proc
}
async function kill(proc: ChildProcess) { if (proc.exitCode === null && proc.signalCode === null) { const exit = once(proc, "exit"); proc.kill("SIGKILL"); await exit } }

describe("durable workflow recovery", () => {
  it("starts once with immutable settings and conflicts on changed input, independent of observers", async () => {
    const f = await fixture()
    let calls = 0
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { calls++; await io.emit({ type: "text", text: "Saved progress" }) } })
    const [a, b] = await Promise.all([startRun(f.ctx, f.request), startRun(f.reopen(), f.request)])
    expect(a.id).toBe(b.id)
    await expect(startRun(f.ctx, { ...f.request, input: { topic: "Changed" } })).rejects.toThrow(/conflict/i)
    await until(async () => (await observeRun(f.reopen(), a.id)).status === "completed")
    expect(calls).toBe(1)
    expect((await listRunEvents(f.ctx, a.id, 0)).some(e => e.type === "text" && e.text === "Saved progress")).toBe(true)
    expect(JSON.stringify(await readRun(f.ctx, a.id))).not.toContain("fixture-only")
  })

  it("reuses committed reads and resumes only safe pending steps after disk reopen", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const lease = (await claimRunLease(f.ctx, f.run.id))!
    const read = step(), pending = step()
    const cached = vi.fn(async () => ({ evidence: "durable" }))
    expect(await journalStep(f.ctx, f.run.id, lease, read, cached)).toEqual({ evidence: "durable" })
    await expect(journalStep(f.ctx, f.run.id, lease, pending, async () => { throw new Error("lost read") })).rejects.toThrow("lost read")
    await releaseRunLease(f.ctx, f.run.id, lease)
    const resumed = vi.fn(async () => "resumed")
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => {
      expect(await io.step(read, cached)).toEqual({ evidence: "durable" }); expect(await io.step(pending, resumed)).toBe("resumed")
    } })
    await recoverWorkflowRuns([f.reopen()])
    await until(async () => (await observeRun(f.ctx, f.run.id)).status === "completed")
    expect(cached).toHaveBeenCalledTimes(1); expect(resumed).toHaveBeenCalledTimes(1)
  })

  it("never replays an unsettled model or opaque command, even when labeled idempotent", async () => {
    for (const kind of ["model", "command"] as const) {
      const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
      const lease = (await claimRunLease(f.ctx, f.run.id))!
      const work = vi.fn(async () => { throw new Error("connection lost") })
      await expect(journalStep(f.ctx, f.run.id, lease, { ...step(kind), replay: "idempotent" }, work)).rejects.toThrow()
      await releaseRunLease(f.ctx, f.run.id, lease)
      const execute = vi.fn()
      registerWorkflowAdapter(f.tool.entrypoint, { execute })
      await recoverWorkflowRuns([f.reopen()])
      expect((await observeRun(f.ctx, f.run.id)).status).toBe("needs_attention")
      expect(work).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled()
      await expect(resumeRun(f.ctx, f.run.id, randomUUID())).rejects.toThrow(/reconcil|attention/i)
    }
  })

  it("blocks recovery on a dispatched held attempt even without a step record", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const ticket = await reserveAttempt(f.ctx, f.run.id, step("model"), { modelCalls: 1, commandCalls: 0, activeSeconds: 20, costUsd: 0.1, accountingOwner: "workflow" })
    await claimAttemptDispatch(f.ctx, ticket)
    await recoverWorkflowRuns([f.reopen()])
    expect((await observeRun(f.ctx, f.run.id)).status).toBe("needs_attention")
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
  })

  it("does not steal an expired lease from a live owner and recovers after that process dies", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const proc = await child()
    const lease = (await claimRunLease(f.ctx, f.run.id))!
    const journal = await readWorkflowJournal(f.ctx, f.run.id)
    await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/journal.json`, JSON.stringify({ ...journal, lease: { ...lease, pid: proc.pid } }))
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 120_000)
    expect(await claimRunLease(f.reopen(), f.run.id)).toBeNull()
    await kill(proc)
    const replacement = await claimRunLease(f.reopen(), f.run.id)
    expect(replacement?.id).not.toBe(lease.id)
    await releaseRunLease(f.ctx, f.run.id, lease)
    expect((await readWorkflowJournal(f.ctx, f.run.id)).lease?.id).toBe(replacement?.id)
    await releaseRunLease(f.ctx, f.run.id, replacement!)
  })

  it("serializes two disk owners while cancellation aborts active work and is idempotent", async () => {
    const f = await fixture(); let active = 0, peak = 0, cancelled = false
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, run, io) => {
      active++; peak = Math.max(peak, active)
      if (run.operationId === f.request.operationId) await new Promise<void>(resolve => io.signal.addEventListener("abort", () => { cancelled = true; resolve() }, { once: true }))
      active--
    } })
    const a = await startRun(f.ctx, f.request)
    await until(async () => active === 1)
    const b = await startRun(f.reopen(), { ...f.request, operationId: randomUUID() })
    await recoverWorkflowRuns([f.reopen(), f.ctx])
    expect((await observeRun(f.ctx, b.id)).status).toBe("queued")
    const op = randomUUID()
    await cancelRun(f.reopen(), a.id, op); await cancelRun(f.ctx, a.id, op)
    await until(async () => (await observeRun(f.ctx, b.id)).status === "completed")
    expect(cancelled).toBe(true); expect(peak).toBe(1)
    expect((await observeRun(f.ctx, a.id)).status).toBe("cancelled")
    await expect(resumeRun(f.ctx, a.id, op)).rejects.toThrow(/conflict/i)
  })

  it.each(["cancelled", "paused_limit", "waiting_for_choice", "waiting_for_setup", "needs_attention"] as RunStatus[])("preserves %s during recovery", async status => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status })
    const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    await recoverWorkflowRuns([f.reopen()])
    expect((await observeRun(f.ctx, f.run.id)).status).toBe(status)
    expect(execute).not.toHaveBeenCalled()
  })

  it("requires explicit setup resume and never substitutes missing pinned versions or models", async () => {
    const f = await fixture(); const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    await writeRun(f.ctx, { ...f.run, status: "running", tool: { ...f.tool.ref, digest: "d".repeat(64) } })
    await recoverWorkflowRuns([f.ctx])
    expect((await observeRun(f.ctx, f.run.id)).status).toBe("waiting_for_setup")
    expect(execute).not.toHaveBeenCalled()
    const g = await fixture(); registerWorkflowAdapter(g.tool.entrypoint, { execute })
    await writeRun(g.ctx, { ...g.run, status: "running" })
    await saveSettings(g.ctx.storage, { ...DEFAULT_SETTINGS, keys: {} })
    await recoverWorkflowRuns([g.ctx])
    await until(async () => (await observeRun(g.ctx, g.run.id)).status === "waiting_for_setup")
    await saveSettings(g.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "fixture-only" } })
    await recoverWorkflowRuns([g.ctx])
    expect((await observeRun(g.ctx, g.run.id)).status).toBe("waiting_for_setup")
    await resumeRun(g.ctx, g.run.id, randomUUID())
    await until(async () => (await observeRun(g.ctx, g.run.id)).status === "completed")
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("persists adapter waiting states without completing or resuming them automatically", async () => {
    const f = await fixture()
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, _run, io) => { await io.emit({ type: "status", status: "waiting_for_choice" }) } })
    const run = await startRun(f.ctx, f.request)
    await until(async () => (await observeRun(f.ctx, run.id)).status === "waiting_for_choice")
    await expect(resumeRun(f.ctx, run.id, randomUUID())).rejects.toThrow(/choice/i)
    await recoverWorkflowRuns([f.ctx])
    expect((await observeRun(f.ctx, run.id)).status).toBe("waiting_for_choice")
  })

  it("propagates the root stop signal to nested attempts even without an explicit signal", async () => {
    const f = await fixture(), dispatch = vi.fn(async () => ({ value: "must not dispatch", result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: 0.05, outcome: "known" as const } }))
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (ctx, run, io) => {
      await io.emit({ type: "status", status: "paused_limit" })
      await withWorkflowAttempt(ctx, run.id, step("model"), { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" }, dispatch)
    } })
    const run = await startRun(f.ctx, f.request); await waitForWorkflowIdle()
    expect(dispatch).not.toHaveBeenCalled()
    expect((await observeRun(f.ctx, run.id)).status).toBe("paused_limit")
    expect((await getRunUsage(f.ctx, run.id)).modelCalls).toBe(0)
  })

  it("keeps a pre-dispatch limit paused across reopen and extends without refunding calls", async () => {
    const f = await fixture(); const first = step("model"), second = step("model")
    let calls = 0
    const estimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" as const }
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (ctx, run, io) => {
      for (const intent of [first, second]) await io.step(intent, () => withWorkflowAttempt(ctx, run.id, intent, estimate, async () => {
        calls++
        return { value: `answer-${calls}`, result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: 0.05, outcome: "known" as const } }
      }, io.signal))
    } })
    const run = await startRun(f.ctx, { ...f.request, allowance: { modelCalls: 1 } })
    await waitForWorkflowIdle()
    expect((await observeRun(f.ctx, run.id)).status).toBe("paused_limit")
    expect(calls).toBe(1)
    await recoverWorkflowRuns([f.reopen()]); await waitForWorkflowIdle()
    expect((await observeRun(f.ctx, run.id)).status).toBe("paused_limit")
    const extension = randomUUID(), resume = randomUUID()
    await extendAllowance(f.reopen(), run.id, extension, { modelCalls: 1 })
    await extendAllowance(f.ctx, run.id, extension, { modelCalls: 1 })
    await resumeRun(f.reopen(), run.id, resume); await waitForWorkflowIdle()
    await resumeRun(f.ctx, run.id, resume); await waitForWorkflowIdle()
    expect((await observeRun(f.ctx, run.id)).status).toBe("completed")
    expect((await getRunUsage(f.ctx, run.id)).modelCalls).toBe(2)
    expect(calls).toBe(2)
    expect((await observeRun(f.ctx, run.id)).allowance.modelCalls).toBe(2)
  })

  it("recovers an actual killed coordinator process without replaying its dispatched model attempt", async () => {
    const f = await fixture(), intent = step("model")
    const script = `
      import { createServer } from "vite";
      const server = await createServer({ configFile: false, logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
      const load = path => server.ssrLoadModule("/src/lib/" + path + ".ts");
      const data = JSON.parse(process.argv[1]);
      const { NodeFsVaultStorage } = await load("vault/node-fs-storage");
      const ctx = { ...data.ctx, storage: new NodeFsVaultStorage(data.ctx.vaultPath) };
      const { registerToolManifest } = await load("extensions/registry");
      const { registerWorkflowAdapter } = await load("workflows/adapters");
      const { withWorkflowAttempt } = await load("workflows/attempt-scope");
      const { startRun } = await load("workflows/coordinator");
      registerToolManifest(data.tool);
      registerWorkflowAdapter(data.tool.entrypoint, { execute: async (ctx, run, io) => {
        await io.step(data.intent, () => withWorkflowAttempt(ctx, run.id, data.intent,
          { modelCalls: 1, commandCalls: 0, activeSeconds: 1200, costUsd: 0.1, accountingOwner: "workflow" },
          async () => {
            await ctx.storage.write(".scispark/test-dispatched-count", "1");
            process.stdout.write(JSON.stringify({ dispatchedRun: run.id }) + "\\n");
            await new Promise(() => {});
          }, io.signal));
      } });
      await startRun(ctx, data.request);
      setInterval(() => {}, 1000);
    `
    const proc = spawn(process.execPath, ["--input-type=module", "-e", script, JSON.stringify({ ctx: { ...f.ctx, storage: undefined }, tool: f.tool, request: f.request, intent })], { stdio: ["ignore", "pipe", "pipe"] })
    cleanups.push(() => kill(proc))
    let output = "", errors = ""
    proc.stdout!.on("data", data => { output += data.toString() })
    proc.stderr!.on("data", data => { errors += data.toString() })
    await vi.waitFor(() => {
      if (proc.exitCode !== null) throw new Error(errors)
      expect(output).toContain("dispatchedRun")
    }, { timeout: 10_000 })
    const id = JSON.parse(output.trim()).dispatchedRun as string
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 120_000)
    await recoverWorkflowRuns([f.reopen()])
    expect((await observeRun(f.ctx, id)).status).toBe("running")
    await kill(proc)
    const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    await recoverWorkflowRuns([f.reopen()]); await waitForWorkflowIdle()
    expect((await observeRun(f.ctx, id)).status).toBe("needs_attention")
    expect((await getRunUsage(f.ctx, id)).modelCalls).toBe(1)
    expect(await f.ctx.storage.read(".scispark/test-dispatched-count")).toBe("1")
    expect(execute).not.toHaveBeenCalled()
  }, 15_000)

  it("preflights the captured model without substituting later settings", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const preflight = vi.fn(async () => { throw new Error("fixture model unavailable") })
    vi.spyOn(settings, "buildProvider").mockReturnValue({ id: "anthropic", preflight, complete: vi.fn() })
    await saveSettings(f.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "fixture-only" }, tierModels: {
      fast: { provider: "anthropic", model: "changed-fast" }, strong: { provider: "anthropic", model: "changed-strong" },
    } })
    const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    await recoverWorkflowRuns([f.reopen()]); await waitForWorkflowIdle()
    expect(preflight).toHaveBeenCalledWith(f.run.model.tierModels.fast.model)
    expect(preflight).not.toHaveBeenCalledWith("changed-fast")
    expect((await observeRun(f.ctx, f.run.id)).status).toBe("waiting_for_setup")
    expect(execute).not.toHaveBeenCalled()
  })

  it("recovers all registered profile roots and starts only one runtime poller", async () => {
    const f = await fixture(), g = await fixture()
    g.ctx.profileId = randomUUID(); g.run.profileId = g.ctx.profileId
    const registry = await mkdtemp(join(tmpdir(), "workflow-registry-"))
    cleanups.push(() => rm(registry, { recursive: true, force: true }))
    const profiles = [f, g].map(({ ctx }) => ({ id: ctx.profileId, name: "Fixture", vaultPath: ctx.vaultPath }))
    await new NodeFsVaultStorage(registry).write("profiles.json", JSON.stringify({ version: 1, profiles }))
    const executed: string[] = []
    for (const item of [f, g]) {
      await writeRun(item.ctx, item.run)
      registerWorkflowAdapter(item.tool.entrypoint, { execute: async ctx => { executed.push(ctx.profileId) } })
    }
    vi.stubEnv("SCISPARK_VAULT", f.ctx.vaultPath); vi.stubEnv("SCISPARK_PROFILES_DIR", registry)
    const stop = await startWorkflowCoordinator(); cleanups.push(stop)
    expect(await startWorkflowCoordinator()).toBe(stop)
    await waitForWorkflowIdle()
    expect(executed.sort()).toEqual(profiles.map(p => p.id).sort())
    for (const item of [f, g]) expect((await observeRun(item.ctx, item.run.id)).status).toBe("completed")
  })

  it("keeps admission FIFO across disk reopen when starts share the same clock tick", async () => {
    const f = await fixture(), order: string[] = []
    let release!: () => void
    registerWorkflowAdapter(f.tool.entrypoint, { execute: async (_ctx, run) => {
      order.push(run.operationId)
      if (run.operationId === f.request.operationId) await new Promise<void>(resolve => { release = resolve })
    } })
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-05T00:00:00Z"))
    await startRun(f.ctx, f.request)
    await until(async () => order.length === 1)
    const b = await startRun(f.ctx, { ...f.request, operationId: randomUUID() })
    const c = await startRun(f.reopen(), { ...f.request, operationId: randomUUID() })
    expect(Date.parse(c.createdAt)).toBeGreaterThan(Date.parse(b.createdAt))
    await recoverWorkflowRuns([f.reopen()])
    release(); await waitForWorkflowIdle()
    expect(order).toEqual([f.request.operationId, b.operationId, c.operationId])
  })

  it("repairs a start intent committed before run publication without admitting a duplicate", async () => {
    const f = await fixture(), execute = vi.fn()
    registerWorkflowAdapter(f.tool.entrypoint, { execute })
    const write = f.ctx.storage.write.bind(f.ctx.storage)
    vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => {
      if (path.endsWith("/run.json")) throw new Error("crashed before run publication")
      await write(path, text)
    })
    await expect(startRun(f.ctx, f.request)).rejects.toThrow("crashed before run publication")
    const reopened = f.reopen()
    await recoverWorkflowRuns([reopened]); await waitForWorkflowIdle()
    const retry = await startRun(reopened, f.request); await waitForWorkflowIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await observeRun(reopened, retry.id)).status).toBe("completed")
    expect((await reopened.storage.list(".scispark/tool-runs/")).filter(p => p.endsWith("/run.json"))).toHaveLength(1)
  })

  it("repairs cancellation after a journal-first mirror failure and never executes the run", async () => {
    const f = await fixture(); await writeRun(f.ctx, f.run); await readWorkflowJournal(f.ctx, f.run.id)
    const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    const write = f.ctx.storage.write.bind(f.ctx.storage)
    vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => {
      if (path.endsWith("/run.json")) throw new Error("crashed before status mirror")
      await write(path, text)
    })
    const operation = randomUUID()
    await expect(cancelRun(f.ctx, f.run.id, operation)).rejects.toThrow("crashed before status mirror")
    await recoverWorkflowRuns([f.reopen()]); await waitForWorkflowIdle()
    await cancelRun(f.reopen(), f.run.id, operation); await waitForWorkflowIdle()
    expect((await observeRun(f.reopen(), f.run.id)).status).toBe("cancelled")
    expect(execute).not.toHaveBeenCalled()
    expect((await listRunEvents(f.reopen(), f.run.id, 0)).filter(e => e.type === "status" && e.status === "cancelled")).toHaveLength(1)
  })

  it("rejects changed step identities and corrupted checkpoint responses after reopen", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const lease = (await claimRunLease(f.ctx, f.run.id))!, intent = step()
    await journalStep(f.ctx, f.run.id, lease, intent, async () => "original")
    await expect(journalStep(f.ctx, f.run.id, lease, { ...intent, inputHash: "b".repeat(64) }, async () => "changed")).rejects.toThrow(/conflict/i)
    const path = `.scispark/tool-runs/${f.run.id}/steps/${intent.id}.json`
    const record = JSON.parse((await f.ctx.storage.read(path))!)
    await f.ctx.storage.write(path, JSON.stringify({ ...record, response: JSON.stringify({ value: "tampered" }) }))
    await releaseRunLease(f.ctx, f.run.id, lease)
    const execute = vi.fn(); registerWorkflowAdapter(f.tool.entrypoint, { execute })
    await recoverWorkflowRuns([f.reopen()]); await waitForWorkflowIdle()
    expect((await observeRun(f.ctx, f.run.id)).status).toBe("needs_attention")
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(["paused_limit", "waiting_for_choice", "waiting_for_setup", "interrupted", "needs_attention"] as const)("fences already reserved dispatch while %s", async status => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const ticket = await reserveAttempt(f.ctx, f.run.id, step("model"), { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" })
    await transitionRun(f.ctx, f.run.id, status)
    await expect(claimAttemptDispatch(f.reopen(), ticket)).rejects.toThrow(/paused|user action/i)
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
  })

  it.each(["cancelled", "paused_limit", "waiting_for_choice", "waiting_for_setup", "needs_attention"] as const)("fences %s immediately after lifecycle commit when its run mirror fails", async status => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const intent = step("model")
    const estimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" as const }
    const ticket = await reserveAttempt(f.ctx, f.run.id, intent, estimate)
    const wrapperIntent = step("model")
    await reserveAttempt(f.ctx, f.run.id, wrapperIntent, estimate)
    const write = f.ctx.storage.write.bind(f.ctx.storage)
    vi.spyOn(f.ctx.storage, "write").mockImplementation(async (path, text) => {
      if (path.endsWith("/run.json")) throw new Error("lifecycle mirror failed")
      await write(path, text)
    })
    const action = status === "cancelled" ? cancelRun(f.ctx, f.run.id, randomUUID()) : transitionRun(f.ctx, f.run.id, status)
    await expect(action).rejects.toThrow("lifecycle mirror failed")
    const reopened = f.reopen()
    // Inspect raw state, never observe/recover: both repair the failed mirror.
    expect((await readRun(reopened, f.run.id))?.status).toBe("running")
    expect(JSON.parse((await reopened.storage.read(`.scispark/tool-runs/${f.run.id}/journal.json`))!).status).toBe(status)
    const usagePath = `.scispark/tool-runs/${f.run.id}/usage.json`
    const before = await reopened.storage.read(usagePath)
    expect(await reserveAttempt(reopened, f.run.id, intent, estimate)).toEqual(ticket)
    const rejection = status === "cancelled" ? /terminal/ : /paused|user action/
    await expect.soft(claimAttemptDispatch(reopened, ticket)).rejects.toThrow(rejection)
    await expect.soft(reserveAttempt(reopened, f.run.id, step("model"), estimate)).rejects.toThrow(rejection)
    const work = vi.fn(async () => ({ value: "forbidden", result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: 0.05, outcome: "known" as const } }))
    await expect.soft(withWorkflowAttempt(reopened, f.run.id, wrapperIntent, estimate, work)).rejects.toThrow()
    expect.soft(work).not.toHaveBeenCalled()
    expect.soft(await reopened.storage.read(usagePath)).toBe(before)
    expect((await readRun(reopened, f.run.id))?.status).toBe("running")
  })

  it.each([
    ["runId", "55555555-5555-4555-8555-555555555555"],
    ["profileId", "66666666-6666-4666-8666-666666666666"],
    ["vaultId", "f".repeat(64)],
    ["status", "invalid-status"],
  ])("rejects invalid lifecycle %s before authorizing an attempt", async (field, value) => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const estimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" as const }
    const ticket = await reserveAttempt(f.ctx, f.run.id, step("model"), estimate)
    const journal = await readWorkflowJournal(f.ctx, f.run.id)
    await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/journal.json`, JSON.stringify({ ...journal, [field]: value }))
    const reopened = f.reopen(), usagePath = `.scispark/tool-runs/${f.run.id}/usage.json`
    const before = await reopened.storage.read(usagePath)
    await expect.soft(claimAttemptDispatch(reopened, ticket)).rejects.toThrow()
    await expect.soft(reserveAttempt(reopened, f.run.id, step("model"), estimate)).rejects.toThrow()
    expect.soft(await reopened.storage.read(usagePath)).toBe(before)
  })

  it("keeps lifecycle journal ownership when generic run updates try to bypass cancellation", async () => {
    const f = await fixture(); await writeRun(f.ctx, f.run)
    await cancelRun(f.ctx, f.run.id, randomUUID()); await waitForWorkflowIdle()
    const cancelled = await observeRun(f.ctx, f.run.id)
    await expect(writeRun(f.ctx, { ...cancelled, status: "running" })).rejects.toThrow(/lifecycle|coordinator/i)
    expect((await observeRun(f.ctx, f.run.id)).status).toBe("cancelled")
  })

  it("fences late writes from a released lease", async () => {
    const f = await fixture(); await writeRun(f.ctx, { ...f.run, status: "running" })
    const lease = (await claimRunLease(f.ctx, f.run.id))!
    await releaseRunLease(f.ctx, f.run.id, lease)
    await expect(journalStep(f.ctx, f.run.id, lease, step(), async () => "late")).rejects.toThrow(/lease/i)
    await expect(transitionRun(f.ctx, f.run.id, "completed", lease)).rejects.toThrow(/lease/i)
  })
})
