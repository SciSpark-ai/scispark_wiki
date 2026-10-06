import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import type { VaultStorage } from "../../vault/storage"
import { initializeProfileTools } from "../profile-state"
import { cancelRun } from "../../workflows/coordinator"
import { readSkillJob } from "../../server/skill-jobs"
import { describe, it, expect } from "vitest"
import { workflowFixture } from "../../workflows/__tests__/fixtures"
import { writeProfileTools } from "../store"
import { NATIVE_TOOL_MANIFESTS } from "../native-catalog"
import { toolKey } from "../contracts"
import { requireEnabledTool } from "../require-tool"
import { registerNativeAdapters } from "../native-adapters"
import { getWorkflowAdapter } from "../../workflows/adapters"
import { ToolRunSchema } from "../../workflows/contracts"

describe("native workflow boundaries", () => {
  it("requires the exact enabled native binding without enabling defaults", async () => {
    const { ctx } = workflowFixture(), tool = NATIVE_TOOL_MANIFESTS[1]
    await expect(requireEnabledTool(ctx, toolKey(tool.ref))).rejects.toThrow(/enabled/)
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [{ tool: tool.ref, enabled: true }], pins: [tool.ref], overrides: [], migrated: true })
    expect(await requireEnabledTool(ctx, toolKey(tool.ref))).toEqual(tool)
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [tool.ref], overrides: [], migrated: true })
    await expect(requireEnabledTool(ctx, toolKey(tool.ref))).rejects.toThrow(/enabled/)
  })
  it("registers all four explicit root and helper adapters", () => {
    registerNativeAdapters()
    for (const tool of NATIVE_TOOL_MANIFESTS) {
      expect(getWorkflowAdapter(tool.entrypoint)?.execute).toBeTypeOf("function")
      expect(getWorkflowAdapter(tool.entrypoint)?.executeHelper).toBeTypeOf("function")
    }
  })
  it("preserves exact native review identity while refusing unsafe references", () => {
    const { run } = workflowFixture()
    expect(ToolRunSchema.parse({ ...run, nativeRunRef: { kind: "deep-review", id: `review_${"a".repeat(32)}` } }).nativeRunRef?.id).toBe(`review_${"a".repeat(32)}`)
    for (const id of ["../review", "review_a", "/tmp/review", "run-123-abcd"]) expect(ToolRunSchema.safeParse({ ...run, nativeRunRef: { kind: "deep-review", id } }).success).toBe(false)
  })
})

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { afterEach, vi } from "vitest"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { Meter, checkBudget } from "../../llm/metering"
import { withRunAttemptScope } from "../../workflows/attempt-scope"
import { resolveRunModel } from "../../workflows/model"
import { writeRun } from "../../workflows/store"
import { getRunUsage } from "../../workflows/usage"
import { runSkill } from "../../skills/runner"
import { defineSkill } from "../../skills/types"
import { setSkillTestOverrides } from "../../server/skill-route"
import { setServerVaultForTests } from "../../server/vault"
import { setNativeWorkflowContextForTests, startNativeWorkflow } from "../../server/native-workflow"
import { waitForWorkflowIdle, recoverWorkflowRuns, observeRun } from "../../workflows/coordinator"
import { reconcileNativeAccounting } from "../../workflows/native-recovery"
import { nativeWorkflowAdapter } from "../native-adapters"
import type { WorkflowIO } from "../../workflows/adapters"
import { runHeartbeatTick } from "../../scheduler/heartbeat"
import { POST as searchRoute } from "../../../app/api/skills/research-search/route"
import { POST as quickRoute } from "../../../app/api/skills/spark/quick/route"
import { POST as estimateRoute } from "../../../app/api/skills/spark/estimate/route"
import { POST as trendingRoute } from "../../../app/api/skills/trending/refresh/route"
import { POST as autoTrendingRoute } from "../../../app/api/skills/trending/auto-refresh/route"
import { POST as deepRoute } from "../../../app/api/skills/spark/deep/route"
import { POST as chatRoute } from "../../../app/api/skills/chat/route"
import { POST as reviewRoute } from "../../../app/api/reviews/route"
import { runFeed } from "../../skills/feed"

const completion = (json: unknown): LLMResult => ({ json, text: JSON.stringify(json), model: "claude-opus-4-8", provider: "anthropic", stopReason: "end_turn", usage: { inputTokens: 20, outputTokens: 10 } })
const temporaryRoots: string[] = []
async function nativeFixture(storage?: VaultStorage, subscription = false) {
  const f = workflowFixture()
  if (storage) f.ctx.storage = storage
  f.ctx.profileId = randomUUID(); f.run.profileId = f.ctx.profileId
  await saveSettings(f.ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "disposable-never-sent" },
    tierModels: { fast: { provider: "anthropic", model: "claude-haiku-4-5" }, strong: { provider: "anthropic", model: "claude-opus-4-8" } } })
  await writeProfileTools(f.ctx, { schemaVersion: 1, enabled: NATIVE_TOOL_MANIFESTS.map(m => ({ tool: m.ref, enabled: true })), pins: [], overrides: [], migrated: true })
  f.run.tool = NATIVE_TOOL_MANIFESTS[3].ref
  f.run.model = subscription ? { engine: "codex", tierModels: { fast: { provider: "openai", model: "fixture" }, strong: { provider: "openai", model: "fixture" } }, roleTiers: { root: "strong", helper: "fast" } } : await resolveRunModel(f.ctx, f.run.tool)
  await writeRun(f.ctx, f.run)
  setServerVaultForTests(f.ctx.storage); setNativeWorkflowContextForTests(f.ctx)
  return f
}
afterEach(async () => { await waitForWorkflowIdle(); setNativeWorkflowContextForTests(); setServerVaultForTests(null); setSkillTestOverrides(); for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true }) })
const sampleSkill = defineSkill({ name: "native-accounting-fixture", version: "1", async run(ctx) { return ctx.llmStructured("strong", { messages: [{ role: "user", content: "Fixture" }], maxTokens: 40 }, z.object({ value: z.string() })) } })

describe("actual native dispatch accounting", () => {
  it("counts structured repairs once each with the original captured model and a single native bill", async () => {
    const { ctx, run } = await nativeFixture()
    const provider = new MockProvider([completion({ invalid: true }), completion({ value: "repaired" })])
    await saveSettings(ctx.storage, { ...DEFAULT_SETTINGS, keys: { anthropic: "changed-unused" } })
    const result = await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
    expect(result.output).toEqual({ value: "repaired" })
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls.every(call => call.model === run.model.tierModels.strong.model && call.req.singleAttempt)).toBe(true)
    const usage = await getRunUsage(ctx, run.id), meter = new Meter(ctx.storage)
    expect(usage.modelCalls).toBe(2)
    expect(usage.costUsd).toBeCloseTo((await meter.spendingToday()).knownUsd)
    expect(await meter.nativeReservationsToday()).toBe(0)
    expect(await meter.workflowReservationsToday()).toBe(0)
    const rows = await meter.recordsForDay(new Date().toISOString().slice(0, 10))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.runId)).size).toBe(2)
  })
  it("retains lost-response native holds across reopen, refuses daily reuse, and acknowledges idempotently", async () => {
    const folder = await mkdtemp(join(tmpdir(), "scispark-native-lost-")); temporaryRoots.push(folder)
    const { ctx, run } = await nativeFixture(new NodeFsVaultStorage(folder))
    const provider = new MockProvider([new Error("Lost response")])
    await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
    const meter = new Meter(ctx.storage), held = await meter.nativeReservationsToday()
    expect(held).toBeGreaterThan(0)
    const tomorrow = new Meter(ctx.storage, () => new Date(Date.now() + 86_400_000))
    expect(await tomorrow.nativeReservationsToday()).toBe(held)
    expect((await getRunUsage(ctx, run.id)).uncertain).toBe(true)
    await expect(checkBudget(meter, { ...DEFAULT_SETTINGS, dailyBudgetUsd: held }, 0)).rejects.toThrow(/budget/i)
    const op = randomUUID()
    const usage = await reconcileNativeAccounting({ ...ctx, storage: new NodeFsVaultStorage(folder) }, run.id, op, "acknowledge")
    expect(usage.modelCalls).toBe(1); expect(usage.uncertain).toBe(false)
    expect(usage.costUsd).toBe(held)
    expect(await reconcileNativeAccounting(ctx, run.id, op, "acknowledge")).toEqual(usage)
    expect(await meter.nativeReservationsToday()).toBe(held) // counted conservatively, never refunded or billed twice
    expect((await meter.recordsForDay(new Date().toISOString().slice(0, 10))).length).toBe(0)
    expect(provider.calls).toHaveLength(1)
    expect(await tomorrow.nativeReservationsToday()).toBe(0) // acknowledgement stays on the reservation day
  })
  it("runs an explicit helper against the unchanged root and reuses stable frame checkpoints", async () => {
    const { ctx, run } = await nativeFixture(), frameId = randomUUID()
    run.tool = NATIVE_TOOL_MANIFESTS[1].ref; run.dependencies = [NATIVE_TOOL_MANIFESTS[3].ref]
    const provider = new MockProvider([completion({ seeds: [{ title: "Idea", hook: "Fixture", rationale: "Fixture", groundingPageIds: [] }] })])
    setSkillTestOverrides({ providerOverride: { strong: provider } })
    const cached = new Map<string, unknown>(), publish = vi.fn(async () => ({ id: randomUUID(), kind: "file" as const, title: "Fixture", path: "artifacts/fixture.json", sha256: "a".repeat(64), mediaType: "application/json", sourceRefs: [] }))
    const io: WorkflowIO = { signal: new AbortController().signal, emit: async () => {}, submitWikiProposal: async () => {}, publishArtifact: publish,
      step: async (intent, work) => { if (!cached.has(intent.id)) cached.set(intent.id, await work()); return cached.get(intent.id) as Awaited<ReturnType<typeof work>> } }
    const invocation = { frameId, tool: NATIVE_TOOL_MANIFESTS[3].ref, input: { mode: "quick", direction: "Fixture idea" } }
    const before = JSON.stringify(run)
    const first = await withRunAttemptScope(ctx, run.id, () => nativeWorkflowAdapter.executeHelper(ctx, run, invocation, io))
    expect(await withRunAttemptScope(ctx, run.id, () => nativeWorkflowAdapter.executeHelper(ctx, run, invocation, io))).toEqual(first)
    expect(provider.calls).toHaveLength(1); expect(publish).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(run)).toBe(before)
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(1)
  })
  it("leaves an opaque interrupted workflow uncertain and never restarts it during recovery", async () => {
    const { ctx } = await nativeFixture()
    const provider = new MockProvider([new Error("lost")]); setSkillTestOverrides({ providerOverride: { strong: provider } })
    const run = await startNativeWorkflow(ctx, "idea-spark", { mode: "quick", direction: "Fixture" })
    await waitForWorkflowIdle()
    expect((await observeRun(ctx, run.id)).status).toBe("needs_attention")
    await recoverWorkflowRuns([ctx]); await waitForWorkflowIdle()
    expect(provider.calls).toHaveLength(1)
  })
})

describe("legacy entrypoint gates and core independence", () => {
  it("returns 409 before model/source calls from every disabled endpoint", async () => {
    const { ctx } = await nativeFixture()
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true })
    const provider = new MockProvider([]), searchFn = vi.fn(async () => [])
    setSkillTestOverrides({ providerOverride: { strong: provider, fast: provider }, searchFn })
    for (const route of [searchRoute, quickRoute, estimateRoute, trendingRoute, autoTrendingRoute, deepRoute, reviewRoute, chatRoute]) {
      const response = await route(new Request("http://fixture/api", { method: "POST", body: JSON.stringify({ mode: "search", query: "Fixture", question: "Fixture question", sessionId: null, readSourcesOnly: false }) }))
      expect(response.status).toBe(409)
    }
    expect(provider.calls).toHaveLength(0); expect(searchFn).not.toHaveBeenCalled()
    expect((await ctx.storage.list(".scispark/tool-runs/start-operations/"))).toHaveLength(0)
  })
  it("skips only optional Trending and keeps heartbeat core work and feed available", async () => {
    const { ctx } = await nativeFixture()
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true })
    const trending = vi.fn(async () => "fresh" as const), consolidation = vi.fn(async () => ({ status: "skipped" as const })), lint = vi.fn(async () => ({ findings: [], reviewIds: [] }))
    await runHeartbeatTick({ storage: ctx.storage, topWorksFn: async () => [], jobs: { maybeAutoRefreshTrending: trending, runConsolidation: consolidation, runLintDeterministic: lint } })
    expect(trending).not.toHaveBeenCalled(); expect(consolidation).toHaveBeenCalledTimes(1); expect(lint).toHaveBeenCalledTimes(1)
    await ctx.storage.write("interests.md", "# Interests\n\n## Active topics\n\n- Fictional fixture research\n")
    const feed = await runFeed(ctx.storage, { searchFn: async () => [{ ids: { arxiv: "fixture" }, title: "Fictional fixture research", abstract: "A fictional research fixture", authors: [], fields: [], source: "arxiv" }], providerOverride: { fast: new MockProvider([]), strong: new MockProvider([]) } })
    expect(feed).toBeDefined()
  })
})


describe("native ownership and legacy migration", () => {
  it("migrates legacy tools once and keeps a new profile core-only", async () => {
    const folder = await mkdtemp(join(tmpdir(), "scispark-native-migrate-")); temporaryRoots.push(folder)
    const { ctx } = workflowFixture(); ctx.runtimeRoot = join(folder, "extensions")
    expect((await initializeProfileTools(ctx, "legacy")).enabled).toHaveLength(4)
    for (const manifest of NATIVE_TOOL_MANIFESTS) expect(await requireEnabledTool(ctx, toolKey(manifest.ref))).toEqual(manifest)
    await writeProfileTools(ctx, { schemaVersion: 1, enabled: [], pins: [], overrides: [], migrated: true })
    expect((await initializeProfileTools(ctx, "legacy")).enabled).toHaveLength(0)
    const fresh = workflowFixture().other; fresh.runtimeRoot = join(folder, "extensions")
    expect((await initializeProfileTools(fresh, "new")).enabled).toHaveLength(0)
  })
  it("fences an in-flight model on cancellation and retains its native financial hold", async () => {
    const { ctx } = await nativeFixture()
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const complete = vi.fn(async (_model, request) => { started(); return new Promise<LLMResult>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) })
    setSkillTestOverrides({ providerOverride: { strong: { id: "anthropic", complete } } })
    const run = await startNativeWorkflow(ctx, "idea-spark", { mode: "quick", direction: "Fixture cancellation" })
    await entered
    await cancelRun(ctx, run.id, randomUUID())
    await waitForWorkflowIdle()
    expect((await observeRun(ctx, run.id)).status).toBe("cancelled")
    expect(complete).toHaveBeenCalledTimes(1)
    expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(1)
    expect(await new Meter(ctx.storage).nativeReservationsToday()).toBeGreaterThan(0)
  })
  it("lets a disconnected legacy observer reconnect to the coordinator-owned saved job without another call", async () => {
    const { ctx } = await nativeFixture()
    let finish!: (value: LLMResult) => void
    const complete = vi.fn(() => new Promise<LLMResult>(resolve => { finish = resolve }))
    setSkillTestOverrides({ providerOverride: { strong: { id: "anthropic", complete } }, searchFn: async () => [] })
    const response = await deepRoute(new Request("http://fixture/deep", { method: "POST", body: JSON.stringify({ direction: "Fixture" }) }))
    await response.body!.cancel()
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    finish(completion({ routing: "do_not_generate", bottleneck: "", whyItMatters: "", refusalReason: "Fixture contains insufficient evidence" }))
    await waitForWorkflowIdle()
    const id = response.headers.get("x-scispark-workflow-id")!
    expect((await observeRun(ctx, id)).status).toBe("completed")
    const first = await readSkillJob(ctx.storage, "spark-deep")
    expect(first?.status).toBe("completed")
    expect(await readSkillJob(ctx.storage, "spark-deep")).toEqual(first)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})


it("reconciles a native Meter success after workflow settlement loss without another bill or call", async () => {
  const { ctx, run } = await nativeFixture()
  const provider = new MockProvider([completion({ value: "Saved" })])
  const write = ctx.storage.write.bind(ctx.storage)
  let injected = false
  ctx.storage.write = async (path, content) => {
    if (!injected && path.endsWith("/usage.json") && content.includes('"state":"known"')) { injected = true; throw new Error("Settlement response lost") }
    return write(path, content)
  }
  await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
  ctx.storage.write = write
  expect(injected).toBe(true)
  expect((await getRunUsage(ctx, run.id)).uncertain).toBe(true)
  const before = (await new Meter(ctx.storage).spendingToday()).knownUsd
  const reconciled = await reconcileNativeAccounting(ctx, run.id, randomUUID(), "reconcile")
  expect(reconciled.uncertain).toBe(false)
  expect(reconciled.costUsd).toBeCloseTo(before)
  expect((await new Meter(ctx.storage).spendingToday()).knownUsd).toBe(before)
  expect(provider.calls).toHaveLength(1)
})


it.each([false, true])("reopens native subscription accounting with null dollars (lost response=%s)", async lost => {
  const folder = await mkdtemp(join(tmpdir(), "scispark-native-local-")); temporaryRoots.push(folder)
  const { ctx, run } = workflowFixture(); ctx.storage = new NodeFsVaultStorage(folder)
  run.model = { engine: "codex", tierModels: { fast: { provider: "openai", model: "fixture" }, strong: { provider: "openai", model: "fixture" } }, roleTiers: { root: "strong", helper: "fast" } }
  await writeRun(ctx, run)
  const provider = { id: "openai" as const, billingMode: "subscription" as const, complete: vi.fn(async () => {
    if (lost) throw new Error("Lost local response")
    return { ...completion({ value: "Local fixture" }), provider: "openai" as const, model: "fixture",
      usage: { inputTokens: 0, outputTokens: 0, billingMode: "subscription" as const, engine: "codex" as const, reported: false } }
  }) }
  await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
  const reopened = { ...ctx, storage: new NodeFsVaultStorage(folder) }, meter = new Meter(reopened.storage)
  const before = await getRunUsage(reopened, run.id)
  expect(before.uncertain).toBe(lost)
  const op = randomUUID(), usage = await reconcileNativeAccounting(reopened, run.id, op, lost ? "acknowledge" : "reconcile")
  expect(usage.uncertain).toBe(false); expect(usage.modelCalls).toBe(1); expect(usage.costUsd).toBeNull()
  expect(await reconcileNativeAccounting(reopened, run.id, op, lost ? "acknowledge" : "reconcile")).toEqual(usage)
  expect(await meter.nativeReservationsToday()).toBe(0); expect(await meter.workflowReservationsToday()).toBe(0)
  expect((await meter.spendingToday()).knownUsd).toBe(0)
  const rows = JSON.parse((await reopened.storage.read(".scispark/usage/native-attempts.json"))!)
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ billingMode: "subscription", reservedUsd: null, costUsd: null, state: lost ? "acknowledged" : "settled" })
  expect(provider.complete).toHaveBeenCalledTimes(1)
})

it("reconciles an actual persisted Meter charge after its write response is lost", async () => {
  const { ctx, run } = await nativeFixture(), provider = new MockProvider([completion({ value: "Saved" })])
  const write = ctx.storage.write.bind(ctx.storage)
  let injected = false
  ctx.storage.write = async (path, content) => {
    await write(path, content)
    if (!injected && path.startsWith(".scispark/usage/") && path.endsWith(".jsonl")) { injected = true; throw new Error("Meter response lost") }
  }
  await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
  ctx.storage.write = write
  expect(injected).toBe(true); expect((await getRunUsage(ctx, run.id)).uncertain).toBe(true)
  const meter = new Meter(ctx.storage), billed = (await meter.spendingToday()).knownUsd
  expect(billed).toBeGreaterThan(0)
  const usage = await reconcileNativeAccounting(ctx, run.id, randomUUID(), "reconcile")
  expect(usage.uncertain).toBe(false); expect(usage.costUsd).toBeCloseTo(billed)
  expect(await meter.nativeReservationsToday()).toBe(0); expect((await meter.spendingToday()).knownUsd).toBe(billed)
  expect(provider.calls).toHaveLength(1)
})


it.each(["link-before", "link-after", "reservation-before", "reservation-after", "dispatch-before", "dispatch-after"].flatMap(fault => [false, true].map(subscription => ({ fault, subscription }))))("reconciles predispatch $fault publication (subscription=$subscription)", async ({ fault, subscription }) => {
  const folder = await mkdtemp(join(tmpdir(), "scispark-native-prepare-")); temporaryRoots.push(folder)
  const { ctx, run } = await nativeFixture(new NodeFsVaultStorage(folder), subscription)
  const complete = vi.fn(async () => { throw new Error("Must never dispatch") })
  const provider = { id: subscription ? "openai" as const : "anthropic" as const, ...(subscription ? { billingMode: "subscription" as const } : {}), complete }
  const write = ctx.storage.write.bind(ctx.storage)
  let injected = false
  ctx.storage.write = async (path, content) => {
    const target = fault.startsWith("dispatch") ? path.includes("/native-financial-links/") && content.includes('"dispatching"') : fault.startsWith("link") ? path.includes("/native-financial-links/") : path.endsWith("/native-attempts.json")
    if (!injected && target) {
      injected = true
      if (fault.endsWith("after")) await write(path, content)
      throw new Error("Native preparation publication failure")
    }
    return write(path, content)
  }
  await withRunAttemptScope(ctx, run.id, () => runSkill({ skill: sampleSkill, input: {}, storage: ctx.storage, providerOverride: { strong: provider } }))
  expect(injected).toBe(true); expect(complete).not.toHaveBeenCalled()
  const reopened = { ...ctx, storage: new NodeFsVaultStorage(folder) }, op = randomUUID()
  const usage = await reconcileNativeAccounting(reopened, run.id, op, "reconcile")
  if (fault === "dispatch-after") {
    expect(usage).toMatchObject({ uncertain: true, heldAttempts: 1, modelCalls: 1 })
    const acknowledged = await reconcileNativeAccounting(reopened, run.id, randomUUID(), "acknowledge")
    expect(acknowledged).toMatchObject({ uncertain: false, heldAttempts: 0, modelCalls: 1 })
    if (subscription) expect(acknowledged.costUsd).toBeNull()
    else expect(acknowledged.costUsd).toBeGreaterThan(0)
  } else {
    expect(usage).toMatchObject({ uncertain: false, heldAttempts: 0, modelCalls: 0, heldCostUsd: 0, costUsd: subscription ? null : 0 })
    const { hasUncertainWork } = await import("../../workflows/journal")
    expect(await hasUncertainWork(reopened, run.id)).toBe(false)
    expect(await new Meter(reopened.storage).nativeReservationsToday()).toBe(0)
    expect(await reconcileNativeAccounting(reopened, run.id, op, "reconcile")).toEqual(usage)
    const raw = await reopened.storage.read(`.scispark/tool-runs/${run.id}/usage.json`)
    if (raw) {
      const { UsageJournalSchema } = await import("../../workflows/contracts")
      const journal = UsageJournalSchema.parse(JSON.parse(raw))
      expect(journal.attempts[0].state).toBe("not_dispatched")
      journal.attempts[0].ticket.estimate.accountingOwner = "workflow"
      expect(UsageJournalSchema.safeParse(journal).success).toBe(false)
    }
  }
  expect((await new Meter(reopened.storage).recordsForDay(new Date().toISOString().slice(0, 10)))).toHaveLength(0)
})

it.each([false, true])("finishes core heartbeat while enabled Trending waits (cancel optional=%s)", async cancelOptional => {
  const { ctx, run } = await nativeFixture()
  const { claimRunLease, transitionRun, releaseRunLease } = await import("../../workflows/journal")
  const lease = (await claimRunLease(ctx, run.id))!
  const consolidate = vi.fn(async () => ({ status: "skipped" as const, costUsd: 0, reason: "fixture" })), lint = vi.fn(async () => ({ findings: [], reviewIds: [] }))
  const deps = { storage: ctx.storage, workflowContext: ctx, topWorksFn: async () => [], jobs: { runConsolidation: consolidate, runLintDeterministic: lint } }
  const tick = runHeartbeatTick(deps)
  await new Promise(resolve => setTimeout(resolve, 100))
  const completedCoreBeforeRelease = consolidate.mock.calls.length === 1 && lint.mock.calls.length === 1
  await runHeartbeatTick(deps)
  const queued = (await ctx.storage.list(".scispark/tool-runs/")).filter(path => path.endsWith("/run.json") && !path.includes(run.id))
  if (cancelOptional && queued[0]) await cancelRun(ctx, queued[0].split("/")[2], randomUUID())
  await transitionRun(ctx, run.id, "completed", lease); await releaseRunLease(ctx, run.id, lease)
  await recoverWorkflowRuns([ctx]); await tick; await waitForWorkflowIdle()
  const { waitForHeartbeatOptionalWork } = await import("../../scheduler/heartbeat")
  await waitForHeartbeatOptionalWork(ctx.storage)
  expect(completedCoreBeforeRelease).toBe(true)
  expect(queued).toHaveLength(1)
  const { readLedger } = await import("../../runs/ledger")
  const scheduled = (await readLedger(ctx.storage)).filter(row => row.orchestrator === "trending-refresh" && row.trigger === "schedule")
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0].status).toBe(cancelOptional ? "failed" : "skipped")
})


it("releases only financial preparation while retaining the opaque native checkpoint decision", async () => {
  const { ctx } = await nativeFixture()
  const provider = new MockProvider([completion({ seeds: [] })])
  setSkillTestOverrides({ providerOverride: { strong: provider } })
  const write = ctx.storage.write.bind(ctx.storage)
  ctx.storage.write = async (path, content) => {
    if (path.endsWith("/native-attempts.json")) throw new Error("Predispatch native reservation failure")
    return write(path, content)
  }
  const run = await startNativeWorkflow(ctx, "idea-spark", { mode: "quick", direction: "Disposable fixture" })
  await waitForWorkflowIdle(); ctx.storage.write = write
  expect((await observeRun(ctx, run.id)).status).toBe("needs_attention")
  const usage = await reconcileNativeAccounting(ctx, run.id, randomUUID(), "reconcile")
  expect(usage).toMatchObject({ modelCalls: 0, uncertain: false, heldAttempts: 0 })
  const { hasUncertainWork } = await import("../../workflows/journal")
  expect(await hasUncertainWork(ctx, run.id)).toBe(true)
  await recoverWorkflowRuns([ctx]); await waitForWorkflowIdle()
  expect(provider.calls).toHaveLength(0)
  expect((await observeRun(ctx, run.id)).status).toBe("needs_attention")
})


it.each([false, true])("releases local-review preparation without plan usage (committed=%s)", async committed => {
  const { ctx, run } = await nativeFixture(undefined, true)
  const { localReviewComplete, localReviewSpend } = await import("../../review/local-budget")
  const { BriefSchema } = await import("../../review/contracts")
  const reviewId = `review_${"b".repeat(32)}`
  const brief = BriefSchema.parse({ question: "Disposable fixture", scope: "Fixture", sources: ["openalex"], allowanceUsd: 1,
    usePersonalContext: false, context: [], limits: { searchRounds: 2, papers: 2 },
    model: { provider: "openai", model: "fixture", engine: "codex", endpoint: "local://codex", rates: null } })
  const provider = { id: "openai" as const, billingMode: "subscription" as const, complete: vi.fn(async () => { throw new Error("Must never dispatch") }) }
  const write = ctx.storage.write.bind(ctx.storage)
  let failed = false
  ctx.storage.write = async (path, content) => {
    if (!failed && path.endsWith("/engine-attempts.json")) {
      failed = true
      if (committed) await write(path, content)
      throw new Error("Local review preparation failure")
    }
    return write(path, content)
  }
  await expect(withRunAttemptScope(ctx, run.id, () => localReviewComplete(ctx.storage, reviewId, brief, "fixture", "Fixture", z.object({ value: z.string() }), 20, async () => {}, provider))).rejects.toThrow()
  ctx.storage.write = write
  const usage = await reconcileNativeAccounting(ctx, run.id, randomUUID(), "reconcile")
  expect(usage).toMatchObject({ modelCalls: 0, heldAttempts: 0, uncertain: false, costUsd: null })
  expect(await localReviewSpend(ctx.storage, reviewId)).toEqual({ calls: 0, uncertain: false })
  expect(provider.complete).not.toHaveBeenCalled()
  expect(await new Meter(ctx.storage).nativeReservationsToday()).toBe(0)
})

it("routes an explicit Find Papers request through its real native adapter and internal chat exactly once", async () => {
  const { askChat } = await import("../../chat/orchestrator"), { loadSession } = await import("../../chat/session")
  const { ctx } = await nativeFixture()
  // Remove the accounting-only fixture root before actual coordinator execution.
  for (const path of await ctx.storage.list(".scispark/tool-runs/")) await ctx.storage.delete(path)
  const provider = new MockProvider([completion({ interpretation:"Speech research",sort:"relevance",fromDate:null,queries:[{source:"arxiv",query:"speech",rationale:"Relevant"}] }), completion({items:[{key:"doi:10.1/intent",score:95,whyMatch:"Speech research"}]})])
  setSkillTestOverrides({providerOverride:{strong:provider,fast:provider},searchFn:async()=>[{ids:{doi:"10.1/intent"},title:"Speech research",abstract:"Speech methods",authors:[],fields:[],source:"arxiv"}]})
  const tool = NATIVE_TOOL_MANIFESTS.find(t=>t.ref.skillId==="find-papers")!
  const input = {sessionId:"chat_native_intent",question:"Find papers about speech",readSourcesOnly:false,explicitTool:tool.ref,operationId:randomUUID()}
  const result = await askChat(ctx.storage,{input,workflowContext:ctx})
  expect(result.message.blocks?.[0].type).toBe("tool-run")
  await waitForWorkflowIdle()
  const runs = (await ctx.storage.list(".scispark/tool-runs/")).filter(p=>p.endsWith("/run.json"))
  expect(runs).toHaveLength(1)
  expect(await ctx.storage.list(".scispark/tools/classifications/")).toEqual([])
  const session = await loadSession(ctx.storage,input.sessionId)
  expect(session?.messages.some(m=>m.blocks?.some(b=>b.type==="paper-results")), JSON.stringify(session)).toBe(true)
  expect(session?.messages.filter(m=>m.role === "user")).toHaveLength(1)
  const replay = await askChat(ctx.storage,{input,workflowContext:ctx})
  expect(replay).toEqual(result); expect(provider.calls).toHaveLength(2)
})


it("keeps a new top-level native review awaiting explicit brief approval even with known prices", async () => {
  const { ctx } = await nativeFixture()
  const provider = new MockProvider([])
  setSkillTestOverrides({ providerOverride: { strong: provider } })
  const run = await startNativeWorkflow(ctx, "deep-review", { question: "Compare adult decoding methods", sources: ["openalex"] })
  await waitForWorkflowIdle()
  const { loadReview } = await import("../../review/store")
  const review = await loadReview(ctx.storage, run.nativeRunRef!.id)
  expect(review.brief.model.rates).not.toBeNull()
  expect(review.status).toBe("awaiting-approval")
  expect(review.approvedRevision).toBeNull()
  expect(provider.calls).toHaveLength(0)
  expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(0)
  expect((await observeRun(ctx, run.id)).status).toBe("waiting_for_choice")
})


it("routes explicit brief approval through the exact stopped root and refuses generic approval", async () => {
  const { ctx } = await nativeFixture()
  const provider = new MockProvider([])
  setSkillTestOverrides({ providerOverride: { strong: provider } })
  const run = await startNativeWorkflow(ctx, "deep-review", { question: "Compare adult decoding methods", sources: ["openalex"] })
  await waitForWorkflowIdle()
  const { continueNativeReview } = await import("../../server/native-workflow")
  const { resumeRun, startRun } = await import("../../workflows/coordinator")
  const { workflowSnapshot } = await import("../../server/workflow-api")
  const { loadReview } = await import("../../review/store")
  const reviewId = run.nativeRunRef!.id
  expect((await workflowSnapshot(ctx, run.id)).observation?.nativeReviewId).toBe(reviewId)
  expect((await workflowSnapshot(ctx, run.id)).observation?.nativeReview?.retry).toBe(false)
  await expect(resumeRun(ctx, run.id, randomUUID())).rejects.toThrow()
  await expect(continueNativeReview(ctx, run.id, randomUUID(), "retry")).rejects.toThrow(/explicitly/)
  expect(provider.calls).toHaveLength(0)
  const rootsBefore = (await ctx.storage.list(".scispark/tool-runs/")).filter(path => path.endsWith("/run.json"))
  const captured = (await observeRun(ctx, run.id)).model
  for (const input of [{ reviewId }, { reviewId, action: { action: "approve", revision: 0 } }]) {
    await expect(startRun(ctx, { operationId: randomUUID(), tool: run.tool, input, contextRefs: [], writeIntent: "outputs_only" })).rejects.toThrow(/native review action/i)
  }
  expect(provider.calls).toHaveLength(0)
  const { POST } = await import("../../../app/api/reviews/[id]/route")
  const result = await POST(new Request("http://fixture/api/reviews", { method: "POST", body: JSON.stringify({ action: "approve", revision: 0 }) }), { params: Promise.resolve({ id: reviewId }) })
  expect(result.status).toBe(200)
  await waitForWorkflowIdle()
  const review = await loadReview(ctx.storage, reviewId)
  expect(review.approvedRevision).toBe(0)
  expect(review.approvals).toHaveLength(1)
  expect(provider.calls.length).toBeGreaterThan(0)
  expect((await ctx.storage.list(".scispark/tool-runs/")).filter(path => path.endsWith("/run.json"))).toEqual(rootsBefore)
  expect((await observeRun(ctx, run.id)).model).toEqual(captured)
  expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(provider.calls.length)
})

it.each(["cancelled", "competitor", "helper"])("refuses explicit native approval when owner is %s", async mode => {
  const { ctx } = await nativeFixture()
  const provider = new MockProvider([])
  setSkillTestOverrides({ providerOverride: { strong: provider } })
  const run = await startNativeWorkflow(ctx, "deep-review", { question: "Compare adult decoding methods", sources: ["openalex"] })
  await waitForWorkflowIdle()
  if (mode === "cancelled") { await cancelRun(ctx, run.id, randomUUID()); await waitForWorkflowIdle() }
  else {
    const competitor = { ...run, id: randomUUID(), operationId: randomUUID(), ...(mode === "helper" ? { nativeRunRef: undefined } : {}) }
    await writeRun(ctx, competitor)
    if (mode === "helper") {
      const { nativePath } = await import("../native-adapters")
      await ctx.storage.write(nativePath(competitor.id, `review-${randomUUID()}`), JSON.stringify({ reviewId: run.nativeRunRef!.id, action: { action: "approve", revision: 0 }, generation: 0, operationId: competitor.operationId }))
    }
  }
  const { legacyReviewAction } = await import("../../server/native-workflow")
  await expect(legacyReviewAction(ctx, run.nativeRunRef!.id, { action: "approve", revision: 0 })).rejects.toThrow()
  expect(provider.calls).toHaveLength(0)
})


it("rejects injected approval at generic start before preparing or dispatching an unseen native brief", async () => {
  const { ctx } = await nativeFixture()
  const provider = new MockProvider([])
  setSkillTestOverrides({ providerOverride: { strong: provider } })
  const { startRun } = await import("../../workflows/coordinator")
  const tool = NATIVE_TOOL_MANIFESTS.find(item => item.ref.skillId === "deep-review")!.ref
  await expect(startRun(ctx, { operationId: randomUUID(), tool, input: { question: "Compare adult decoding methods", sources: ["openalex"], action: { action: "approve", revision: 0 } }, contextRefs: [], writeIntent: "outputs_only" })).rejects.toThrow(/native review action/i)
  await waitForWorkflowIdle()
  expect(provider.calls).toHaveLength(0)
  expect(await ctx.storage.list(".scispark/tool-runs/start-operations/")).toEqual([])
  expect(await ctx.storage.list(".scispark/reviews/")).toEqual([])
})
