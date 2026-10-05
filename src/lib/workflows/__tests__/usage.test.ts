import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_ENGINES } from "../../engines/contracts"
import { toolKey } from "../../extensions/contracts"
import { writeProfileTools } from "../../extensions/store"
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../../llm/settings"
import { Meter, checkBudget } from "../../llm/metering"
import type { LLMProvider } from "../../llm/types"
import { resolveRunModel, settingsForRunModel } from "../model"
import { claimAttemptDispatch, extendAllowance, getRunUsage, reserveAttempt, settleAttempt } from "../usage"
import { currentRunAttemptScope, withRunAttemptScope, withWorkflowAttempt, completeWorkflowModel } from "../attempt-scope"
import { readRun, writeRun } from "../store"
import { workflowFixture } from "./fixtures"
import type { AttemptEstimate, StepIntent } from "../contracts"

const step = (): StepIntent => ({ id: randomUUID(), kind: "model", replay: "reconcile", inputHash: "d".repeat(64) })
const estimate: AttemptEstimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: 0.1, accountingOwner: "workflow" }
const result = { modelCalls: 1, commandCalls: 0, activeSeconds: 1, costUsd: 0.05, outcome: "known" as const }
async function fixture() { const f = workflowFixture(); await writeRun(f.ctx, f.run); return f }
afterEach(() => vi.useRealTimers())

describe("captured workflow model", () => {
  it("captures both tiers and explicit overrides without changing settings or later snapshots", async () => {
    const { ctx, tool, run } = workflowFixture()
    await saveSettings(ctx.storage, { ...DEFAULT_SETTINGS, keys: { openai: "secret-api-key" }, tierModels: { fast: { provider: "openai", model: "fast-old" }, strong: { provider: "openai", model: "strong-old" } }, baseUrls: { openai: "https://fixture.invalid/v1" } })
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [{ tool: tool.ref, enabled: true }], pins: [], migrated: true, overrides: [{ toolKey: toolKey(tool.ref), tierModels: { strong: { provider: "openai", model: "strong-tool" } }, roleTiers: { helper: "fast" } }] })
    const before = await loadSettings(ctx.storage)
    const model = await resolveRunModel(ctx, tool.ref)
    expect(model.tierModels.strong).toEqual({ provider: "openai", model: "strong-tool", baseUrl: "https://fixture.invalid/v1" })
    expect(model.roleTiers.helper).toBe("fast")
    expect(await loadSettings(ctx.storage)).toEqual(before)
    await writeRun(ctx, { ...run, model })
    await saveSettings(ctx.storage, { ...before, tierModels: DEFAULT_SETTINGS.tierModels, engines: { ...DEFAULT_ENGINES, kind: "codex" } })
    const reopened = (await readRun(ctx, run.id))!
    expect(reopened.model).toEqual(model)
    const effective = await settingsForRunModel(ctx, reopened.model)
    expect(effective.engines?.kind).toBe("api")
    expect(effective.tierModels).toEqual({ fast: { provider: "openai", model: "fast-old" }, strong: { provider: "openai", model: "strong-tool" } })
    expect(JSON.stringify(reopened)).not.toContain("secret-api-key")
  })
  it("rejects unsupported endpoint overrides and credential-bearing endpoint selections", async () => {
    const { ctx, tool, run } = workflowFixture()
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], migrated: true, overrides: [{ toolKey: toolKey(tool.ref), tierModels: { strong: { provider: "anthropic", model: "example", baseUrl: "https://unsupported.invalid" } } }] })
    await expect(resolveRunModel(ctx, tool.ref)).rejects.toThrow(/endpoint/)
    await expect(settingsForRunModel(ctx, { ...run.model, tierModels: { ...run.model.tierModels, strong: { ...run.model.tierModels.strong, baseUrl: "https://unsupported.invalid" } } })).rejects.toThrow(/endpoint/)
    await saveSettings(ctx.storage, { ...DEFAULT_SETTINGS, tierModels: { fast: { provider: "openai", model: "fixture" }, strong: { provider: "openai", model: "fixture" } }, baseUrls: { openai: "https://secret:password@fixture.invalid/v1" } })
    await expect(resolveRunModel(ctx, tool.ref)).rejects.toThrow()
  })
  it("captures CLI models and refuses provider switching through tier overrides", async () => {
    const { ctx, tool } = workflowFixture()
    await saveSettings(ctx.storage, { ...DEFAULT_SETTINGS, engines: { ...DEFAULT_ENGINES, kind: "codex" } })
    expect((await resolveRunModel(ctx, tool.ref)).tierModels.fast.model).toBe(DEFAULT_ENGINES.models.codex.fast)
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], migrated: true, overrides: [{ toolKey: toolKey(tool.ref), tierModels: { strong: { provider: "anthropic", model: "sonnet" } } }] })
    await expect(resolveRunModel(ctx, tool.ref)).rejects.toThrow(/provider/)
  })
})

describe("cumulative reservations", () => {
  it("serializes concurrent reservations at the limit and deduplicates a step", async () => {
    const { ctx, run } = workflowFixture(); run.allowance.modelCalls = 1; await writeRun(ctx, run)
    const intent = step()
    const tickets = await Promise.all([reserveAttempt(ctx, run.id, intent, estimate), reserveAttempt(ctx, run.id, intent, estimate)])
    expect(tickets[0]).toEqual(tickets[1])
    await expect(reserveAttempt(ctx, run.id, step(), estimate)).rejects.toThrow(/limit/)
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(1)
  })
  it.each(["cancelled", "completed", "failed"] as const)("rejects an unclaimed reservation after reopening a %s run", async (status) => {
    const root = await mkdtemp(join(tmpdir(), "workflow-terminal-"))
    try {
      const { ctx: memory, run } = workflowFixture(), intent = step()
      const ctx = { ...memory, storage: new NodeFsVaultStorage(root) }
      await writeRun(ctx, run)
      const ticket = await reserveAttempt(ctx, run.id, intent, estimate)
      await writeRun(ctx, { ...(await readRun(ctx, run.id))!, status })
      const reopened = { ...memory, storage: new NodeFsVaultStorage(root) }
      expect(await reserveAttempt(reopened, run.id, intent, estimate)).toEqual(ticket)
      await expect(claimAttemptDispatch(reopened, ticket)).rejects.toThrow(/terminal/)
      const callback = vi.fn(async () => ({ value: "never", result }))
      await expect(withWorkflowAttempt(reopened, run.id, intent, estimate, callback)).rejects.toThrow(/terminal/)
      expect(callback).not.toHaveBeenCalled()
      const journal = JSON.parse((await reopened.storage.read(`.scispark/tool-runs/${run.id}/usage.json`))!)
      expect(journal.attempts[0].dispatchedAt).toBeUndefined()
      expect(await getRunUsage(reopened, run.id)).toMatchObject({ modelCalls: 1, heldAttempts: 1 })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("rejects a terminal transition queued between reservation and dispatch claim", async () => {
    const { ctx, run } = await fixture(), intent = step()
    const write = ctx.storage.write.bind(ctx.storage)
    let transition: Promise<void> | undefined
    let queued = false
    ctx.storage.write = async (path, content) => {
      await write(path, content)
      if (!queued && path.endsWith("/run.json")) {
        queued = true
        // Reservation still owns the workflow lock. Queue cancellation ahead of
        // the wrapper's claim, without awaiting it inside that same lock.
        transition = writeRun(ctx, { ...JSON.parse(content), status: "cancelled" })
      }
    }
    const callback = vi.fn(async () => ({ value: "never", result }))
    await expect(withWorkflowAttempt(ctx, run.id, intent, estimate, callback)).rejects.toThrow(/terminal/)
    await transition
    expect(queued).toBe(true)
    expect((await readRun(ctx, run.id))!.status).toBe("cancelled")
    expect(callback).not.toHaveBeenCalled()
    const journal = JSON.parse((await ctx.storage.read(`.scispark/tool-runs/${run.id}/usage.json`))!)
    expect(journal.attempts[0].dispatchedAt).toBeUndefined()
  })
  it("settles idempotently and retains unknown reservations across reopen and resume", async () => {
    const { ctx, run } = await fixture()
    const ticket = await reserveAttempt(ctx, run.id, step(), estimate)
    await settleAttempt(ctx, ticket, { ...result, outcome: "unknown", costUsd: null })
    await writeRun(ctx, { ...(await readRun(ctx, run.id))!, status: "interrupted" })
    expect(await getRunUsage({ ...ctx }, run.id)).toMatchObject({ modelCalls: 1, heldCostUsd: 0.1, uncertain: true })
    await expect(reserveAttempt(ctx, run.id, step(), estimate)).rejects.toThrow(/uncertain/)
    await settleAttempt(ctx, ticket, result)
    await settleAttempt(ctx, ticket, result)
    expect(await getRunUsage(ctx, run.id)).toMatchObject({ modelCalls: 1, costUsd: 0.05, heldCostUsd: 0, uncertain: false })
    await expect(settleAttempt(ctx, { ...ticket, id: randomUUID() }, result)).rejects.toThrow(/ticket/)
  })
  it("rejects unknown API prices, preserves null CLI cost, and validates native ledger ownership", async () => {
    const { ctx, run } = await fixture()
    await expect(reserveAttempt(ctx, run.id, step(), { ...estimate, costUsd: null })).rejects.toThrow(/pric/)
    const native = await reserveAttempt(ctx, run.id, step(), { ...estimate, accountingOwner: "native" })
    await expect(settleAttempt(ctx, native, result)).rejects.toThrow(/ledger/)
    await settleAttempt(ctx, native, { ...result, financialLedgerRef: { ledger: "review", attemptId: randomUUID() } })
    expect((await new Meter(ctx.storage).spendingToday()).knownUsd).toBe(0)
    const cli = workflowFixture(); cli.run.model.engine = "codex"; cli.run.allowance.costUsd = null; cli.run.usage.costUsd = null; await writeRun(cli.ctx, cli.run)
    const ticket = await reserveAttempt(cli.ctx, cli.run.id, step(), { ...estimate, costUsd: null })
    await settleAttempt(cli.ctx, ticket, { ...result, costUsd: null })
    expect((await getRunUsage(cli.ctx, cli.run.id)).costUsd).toBeNull()
  })
  it("extends exactly once without resetting spent usage, including a failed mirror write", async () => {
    const { ctx, run } = await fixture()
    await settleAttempt(ctx, await reserveAttempt(ctx, run.id, step(), estimate), result)
    const usedBefore = (await getRunUsage(ctx, run.id)).modelCalls
    const id = randomUUID(), write = ctx.storage.write.bind(ctx.storage)
    let fail = true
    ctx.storage.write = async (path, contents) => { if (path.endsWith("/run.json") && fail) { fail = false; throw new Error("mirror failed") }; await write(path, contents) }
    await expect(extendAllowance(ctx, run.id, id, { modelCalls: 5 })).rejects.toThrow(/mirror/)
    await extendAllowance(ctx, run.id, id, { modelCalls: 5 })
    expect((await readRun(ctx, run.id))!.allowance.modelCalls).toBe(35)
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(usedBefore)
    await expect(extendAllowance(ctx, run.id, id, { modelCalls: 6 })).rejects.toThrow(/operation/)
    await expect(extendAllowance(ctx, run.id, randomUUID(), { modelCalls: -1 })).rejects.toThrow()
  })
  it("makes sibling scopes share the root allowance and rejects changing root ownership", async () => {
    const { ctx, run } = await fixture()
    await withRunAttemptScope(ctx, run.id, async () => {
      expect(currentRunAttemptScope()?.runId).toBe(run.id)
      await withRunAttemptScope(ctx, run.id, async () => settleAttempt(ctx, await reserveAttempt(ctx, run.id, step(), estimate), result))
      await expect(withRunAttemptScope(ctx, randomUUID(), async () => {})).rejects.toThrow(/root/)
    })
    expect(currentRunAttemptScope()).toBeUndefined()
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(1)
  })
  it("aborts while an attempt is in flight and retains the uncertain hold", async () => {
    vi.useFakeTimers()
    const { ctx, run } = await fixture()
    let signal: AbortSignal | undefined
    const work = withWorkflowAttempt(ctx, run.id, step(), { ...estimate, activeSeconds: 0.05 }, async (s) => {
      signal = s
      await new Promise<void>((_, reject) => s.addEventListener("abort", () => reject(new Error("aborted"))))
      return { value: "never", result }
    })
    const check = expect(work).rejects.toThrow(/limit/)
    await vi.advanceTimersByTimeAsync(100)
    await check
    expect(signal?.aborted).toBe(true)
    expect((await getRunUsage(ctx, run.id)).uncertain).toBe(true)
  })
  it("preserves reservations across independent filesystem handles and prevents counter/allowance edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-usage-"))
    try {
      const { ctx: memory, run } = workflowFixture()
      run.allowance.modelCalls = 1
      const ctx = { ...memory, storage: new NodeFsVaultStorage(root) }, reopened = { ...memory, storage: new NodeFsVaultStorage(root) }
      await writeRun(ctx, run)
      const attempts = await Promise.allSettled([reserveAttempt(ctx, run.id, step(), estimate), reserveAttempt(reopened, run.id, step(), estimate)])
      expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(1)
      expect(await getRunUsage(reopened, run.id)).toMatchObject({ modelCalls: 1, heldAttempts: 1, heldCostUsd: 0.1 })
      const current = (await readRun(reopened, run.id))!
      await expect(writeRun(ctx, { ...current, allowance: { ...current.allowance, modelCalls: 999 } })).rejects.toThrow(/journal/)
      await expect(writeRun(ctx, { ...current, usage: { ...current.usage, modelCalls: 2 } })).rejects.toThrow(/journal/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it("never redispatches a claimed ticket and keeps overrun evidence", async () => {
    const { ctx, run } = await fixture(), intent = step()
    const callback = vi.fn(async () => ({ value: "answer", result: { ...result, costUsd: 0.2 } }))
    await expect(withWorkflowAttempt(ctx, run.id, intent, estimate, callback)).rejects.toThrow(/uncertain/)
    expect(await getRunUsage(ctx, run.id)).toMatchObject({ heldCostUsd: 0.2, uncertain: true })
    const ticket = await reserveAttempt(ctx, run.id, intent, estimate)
    await settleAttempt(ctx, ticket, { ...result, costUsd: null, outcome: "unknown" })
    expect(await getRunUsage(ctx, run.id)).toMatchObject({ heldCostUsd: 0.2, uncertain: true })
    await expect(withWorkflowAttempt(ctx, run.id, intent, estimate, callback)).rejects.toThrow(/dispatched|reconcil/)
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it("rejects cross-profile tickets and wrong scoped rates before any dispatch", async () => {
    const { ctx, other, run } = await fixture()
    const ticket = await reserveAttempt(ctx, run.id, step(), estimate)
    await expect(settleAttempt({ ...other, storage: ctx.storage }, ticket, result)).rejects.toThrow(/owner/)
    await expect(reserveAttempt(ctx, run.id, step(), { ...estimate, apiKey: "secret" } as AttemptEstimate)).rejects.toThrow()
    const complete = vi.fn()
    await expect(completeWorkflowModel(ctx, run.id, step(), "fast", { messages: [] }, { provider: { id: "anthropic", complete }, price: { provider: "anthropic", model: run.model.tierModels.fast.model, baseUrl: "https://wrong.invalid", rates: { inputPerMillion: 1, outputPerMillion: 1 }, provenance: "fixture", recordedAt: new Date().toISOString() } })).rejects.toThrow(/pricing/)
    expect(complete).not.toHaveBeenCalled()
  })
  it("shares daily controls with existing API work and never writes prompt or response content", async () => {
    const { ctx, run } = await fixture()
    const ticket = await reserveAttempt(ctx, run.id, step(), { ...estimate, costUsd: 0.7 })
    await expect(checkBudget(new Meter(ctx.storage), { ...DEFAULT_SETTINGS, dailyBudgetUsd: 0.5 })).rejects.toThrow(/budget/i)
    await settleAttempt(ctx, ticket, result)
    const provider: LLMProvider = { id: "anthropic", complete: vi.fn(async (model, request) => {
      expect(request.singleAttempt).toBe(true)
      return { text: "secret-response", model, provider: "anthropic" as const, stopReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } }
    }) }
    await completeWorkflowModel(ctx, run.id, step(), "fast", { messages: [{ role: "user", content: "secret-prompt" }], maxTokens: 10 }, { provider, price: { provider: "anthropic", model: run.model.tierModels.fast.model, baseUrl: "https://api.anthropic.com", rates: { inputPerMillion: 1, outputPerMillion: 1 }, provenance: "fixture", recordedAt: new Date().toISOString() } })
    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect((await new Meter(ctx.storage).recordsForDay(new Date().toISOString().slice(0, 10)))).toHaveLength(1)
    const journal = await ctx.storage.read(`.scispark/tool-runs/${run.id}/usage.json`)
    expect(journal).not.toContain("secret-prompt"); expect(journal).not.toContain("secret-response")
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(2)
  })
})
