import { getToolManifest } from "../extensions/registry"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { UuidSchema, toolKey } from "../extensions/contracts"
import { readProfileTools } from "../extensions/store"
import { resolvePreparedEnvironmentRefs, resolveToolPreparationClosure, validateCapturedPreparation, resolveToolConnectionRefs } from "../extensions/setup"
import { buildProvider } from "../llm/settings"
import { initializeLocalProfiles } from "../server/local-profiles"
import { ChangesetRecoveryConflictError } from "../vault/changesets"
import { withVaultExclusive } from "../vault/exclusive"
import { publishArtifact } from "./artifacts"
import { markWorkflowOutputsCompleted, saveAuthorizedWorkflowOutputs, submitWikiProposal, workflowOutputsCompleted } from "./wiki-save"
import type { WorkflowIO } from "./adapters"
import { getWorkflowAdapter } from "./adapters"
import { withRunAttemptScope } from "./attempt-scope"
import { resolveWorkflowContext, type WorkflowContext } from "./context"
import { DEFAULT_RUN_ALLOWANCE, RunEventInputSchema, StartRunInputSchema, ToolRunSchema, UsageJournalSchema, type StartRunInput, type ToolRun } from "./contracts"
import { actionOnRun, canonicalJson, claimRunLease, emitRunEvent, hasUncertainWork, journalStep, leaseOwnerAlive,
  readWorkflowJournal, releaseRunLease, renewRunLease, runCancellationRequested, acknowledgeRunCancellation, transitionRun, UncertainWorkflowError, type WorkflowLease } from "./journal"
import { resolveRunModel, settingsForRunModel } from "./model"
import { readRun, writeRun } from "./store"
import { getRunUsage, WorkflowLimitError } from "./usage"

interface Worker { abort: AbortController; done: Promise<void>; cancel?: (operationId: string) => Promise<void> }
interface Runtime { workers: Map<string, Worker>; background: Set<Promise<void>>; stop?: () => void; stopped: boolean }
const globalRuntime = globalThis as typeof globalThis & { __scisparkWorkflowCoordinator?: Runtime }
const runtime: Runtime = globalRuntime.__scisparkWorkflowCoordinator ??= { workers: new Map(), background: new Set(), stopped: false }
const key = (ctx: WorkflowContext, id: string) => `${ctx.profileId}:${ctx.vaultId}:${id}`
const StartRecordSchema = z.object({ schemaVersion: z.literal(1), request: StartRunInputSchema, run: ToolRunSchema }).strict()
const operationPath = (id: string) => `.scispark/tool-runs/start-operations/${UuidSchema.parse(id)}.json`
const reportBackgroundError = () => { console.error("Workflow coordination failed; durable state was preserved for recovery.") }

async function adapterFor(ctx: WorkflowContext, run: ToolRun) {
  const resolved = await resolveToolPreparationClosure(ctx, run.tool)
  await validateCapturedPreparation(ctx, run)
  if (canonicalJson(resolved.dependencies) !== canonicalJson(run.dependencies)) throw new Error("Pinned dependency snapshot is unavailable")
  if (!(resolved.manifest.kind === "native" && !resolved.manifest.engines.length) && !resolved.manifest.engines.includes(run.model.engine)) throw new Error("Captured engine is unavailable for this tool")
  const adapter = getWorkflowAdapter(resolved.manifest.entrypoint) ?? getWorkflowAdapter(resolved.manifest.kind)
  if (!adapter) throw new Error("Workflow adapter is not available")
  return adapter
}
async function listRuns(ctx: WorkflowContext): Promise<ToolRun[]> {
  const runs: ToolRun[] = []
  for (const path of await ctx.storage.list(".scispark/tool-runs/")) {
    const match = /^\.scispark\/tool-runs\/([0-9a-f-]{36})\/run\.json$/.exec(path)
    if (match) { const run = await readRun(ctx, match[1]); if (run) runs.push(run) }
  }
  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
/** Called under profile exclusivity. The start intent is written first so a
 * crash before publishing run.json is recovered without creating another run. */
async function restoreStartRecords(ctx: WorkflowContext): Promise<void> {
  for (const path of await ctx.storage.list(".scispark/tool-runs/start-operations/")) {
    if (!/\/[0-9a-f-]{36}\.json$/.test(path)) continue
    const raw = await ctx.storage.read(path)
    if (raw === null) throw new Error("Workflow start record disappeared")
    const record = StartRecordSchema.parse(JSON.parse(raw))
    if (record.run.profileId !== ctx.profileId || record.run.vaultId !== ctx.vaultId || path !== operationPath(record.request.operationId)
      || record.run.operationId !== record.request.operationId) throw new Error("Workflow start owner mismatch")
    if (!await readRun(ctx, record.run.id)) await writeRun(ctx, record.run)
  }
}
/** Management callers already hold workflow-coordinator exclusivity. Restore
 * accepted starts before asking for finish/cancel; never dispatch work here. */
export async function restoreAndListWorkflowRuns(ctx: WorkflowContext): Promise<ToolRun[]> {
  await restoreStartRecords(ctx)
  return listRuns(ctx)
}
function track(work: Promise<void>): void {
  const pending = work.catch(reportBackgroundError).finally(() => { runtime.background.delete(pending) })
  runtime.background.add(pending)
}
function schedule(ctx: WorkflowContext): void { track(recoverWorkflowRuns([ctx])) }
export async function startRun(ctx: WorkflowContext, input: StartRunInput): Promise<ToolRun> {
  const request = StartRunInputSchema.parse(input)
  const run = await withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
    await restoreStartRecords(ctx)
    const raw = await ctx.storage.read(operationPath(request.operationId))
    if (raw !== null) {
      const previous = StartRecordSchema.parse(JSON.parse(raw))
      if (canonicalJson(previous.request) !== canonicalJson(request)) throw new Error("Workflow start operation conflict")
      if (previous.run.profileId !== ctx.profileId || previous.run.vaultId !== ctx.vaultId) throw new Error("Workflow start owner mismatch")
      if (!await readRun(ctx, previous.run.id)) await writeRun(ctx, previous.run)
      return (await readRun(ctx, previous.run.id))!
    }
    const state = await readProfileTools(ctx)
    const binding = state?.enabled.find(b => b.enabled && toolKey(b.tool) === toolKey(request.tool))
    const pinned = state?.pins.find(ref => toolKey(ref) === toolKey(request.tool))
    if (!binding || canonicalJson(binding.tool) !== canonicalJson(request.tool) || (pinned && canonicalJson(pinned) !== canonicalJson(request.tool))) throw new Error("Tool is not enabled at the requested version")
    const { dependencies } = await resolveToolPreparationClosure(ctx, request.tool)
    const model = await resolveRunModel(ctx, request.tool)
    const preparedEnvironmentRefs = await resolvePreparedEnvironmentRefs(ctx, [request.tool, ...dependencies], model)
    const connectionConfigurationRefs = await resolveToolConnectionRefs(ctx, [request.tool, ...dependencies])
    const previousRun = (await listRuns(ctx)).at(-1)
    const now = new Date(Math.max(Date.now(), previousRun ? Date.parse(previousRun.createdAt) + 1 : 0)).toISOString()
    const id = randomUUID()
    const run = ToolRunSchema.parse({ schemaVersion: 1, id, profileId: ctx.profileId, vaultId: ctx.vaultId,
      ...request, dependencies, model, preparedEnvironmentRefs, connectionConfigurationRefs,
      allowance: { ...DEFAULT_RUN_ALLOWANCE, ...request.allowance, ...(model.engine !== "api" ? { costUsd: null } : {}) },
      usage: { modelCalls: 0, commandCalls: 0, activeSeconds: 0, costUsd: model.engine === "api" ? 0 : null },
      ...(getToolManifest(request.tool)?.kind === "native" && request.tool.packageId === "scispark.builtin" ? { nativeRunRef: { kind: request.tool.skillId, id: request.tool.skillId === "deep-review" ? request.input.reviewId ?? `review_${createHash("sha256").update(JSON.stringify({ session: request.input.sessionId ?? request.sessionId ?? request.operationId, operation: request.operationId })).digest("hex").slice(0, 32)}` : id } } : {}),
      status: "queued", createdAt: now, updatedAt: now, eventCursor: 0, artifacts: [] })
    await ctx.storage.write(operationPath(request.operationId), JSON.stringify(StartRecordSchema.parse({ schemaVersion: 1, request, run })))
    await writeRun(ctx, run)
    await readWorkflowJournal(ctx, run.id)
    return run
  })
  runtime.stopped = false
  schedule(ctx)
  return run
}
export async function observeRun(ctx: WorkflowContext, id: string): Promise<ToolRun> {
  await readWorkflowJournal(ctx, id)
  const run = (await readRun(ctx, id))!
  // Usage is owned by its journal, including a crash before run.json mirroring.
  const usage = await getRunUsage(ctx, id)
  const raw = await ctx.storage.read(`.scispark/tool-runs/${id}/usage.json`)
  return { ...run, allowance: raw === null ? run.allowance : UsageJournalSchema.parse(JSON.parse(raw)).allowance,
    usage: { modelCalls: usage.modelCalls, commandCalls: usage.commandCalls, activeSeconds: usage.activeSeconds, costUsd: usage.costUsd } }
}
export async function cancelRun(ctx: WorkflowContext, id: string, operationId: string): Promise<void> {
  const worker = runtime.workers.get(key(ctx, id))
  if (worker?.cancel) await worker.cancel(operationId)
  else {
    await actionOnRun(ctx, id, operationId, "cancel")
    worker?.abort.abort(new Error("Workflow cancelled"))
  }
  schedule(ctx)
}
export async function resumeRun(ctx: WorkflowContext, id: string, operationId: string): Promise<ToolRun> {
  const run = await actionOnRun(ctx, id, operationId, "resume")
  runtime.stopped = false
  schedule(ctx)
  return run
}

/** Snapshot coalescing belongs at the durable server writer. Even terminal flushes
 * wait for the 250ms spacing, then finish before the lifecycle status commits. */
function textWriter(write: (text: string) => Promise<void>) {
  // The initial delay also preserves spacing across immediate resumes/restarts.
  let pending: string | null = null, lastWrite = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue = Promise.resolve()
  const flush = () => {
    clearTimeout(timer); timer = undefined
    queue = queue.then(async () => {
      if (pending === null) return
      const delay = Math.max(0, 250 - (Date.now() - lastWrite))
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      const text = pending; pending = null
      await write(text)
      lastWrite = Date.now()
    })
    return queue
  }
  return { flush, emit: async (text: string) => {
    pending = text
    if (Date.now() - lastWrite >= 250) await flush()
    else if (!timer) timer = setTimeout(() => { void flush().catch(() => {}) }, Math.max(0, 250 - (Date.now() - lastWrite)))
  } }
}
class WorkflowSetupError extends Error {}
async function executeOwned(ctx: WorkflowContext, id: string, lease: WorkflowLease, abort: AbortController): Promise<void> {
  const text = textWriter(value => emitRunEvent(ctx, id, lease, { type: "text", text: value }))
  let cancellation: Promise<void> | undefined
  const finishCancellation = () => cancellation ??= (async () => {
    abort.abort(new Error("Workflow cancelled"))
    await text.flush()
    await acknowledgeRunCancellation(ctx, id, lease)
  })()
  let heartbeatPending = false, lastRenewal = Date.now()
  // Read pending intents frequently for prompt process/signal cancellation;
  // lease renewal retains its original one-second write cadence.
  const heartbeat = setInterval(() => {
    if (heartbeatPending) return
    heartbeatPending = true
    void (async () => {
      if (await runCancellationRequested(ctx, id, lease)) { await finishCancellation(); return }
      if (Date.now() - lastRenewal >= 1000) {
        const status = await renewRunLease(ctx, id, lease)
        lastRenewal = Date.now()
        if (status !== "running") abort.abort(new Error("Workflow stopped"))
      }
    })().catch(() => abort.abort(new Error("Workflow ownership lost"))).finally(() => { heartbeatPending = false })
  }, 50)
  heartbeat.unref?.()
  try {
    const run = (await readRun(ctx, id))!
    const outputsCompleted = await workflowOutputsCompleted(ctx, id)
    let adapter: Awaited<ReturnType<typeof adapterFor>> | undefined
    try {
      if (!outputsCompleted) {
        adapter = await adapterFor(ctx, run)
        // Preflight the captured choices only, outside all state/profile locks.
        // API model access remains provider-enforced; no probe spends a model call.
        for (const tier of (getToolManifest(run.tool)?.kind === "native" && run.tool.packageId === "scispark.builtin" ? [] : ["fast", "strong"]) as ("fast" | "strong")[]) {
          const provider = buildProvider(await settingsForRunModel(ctx, run.model, tier), tier)
          await provider.preflight?.(run.model.tierModels[tier].model)
        }
      }
    } catch { throw new WorkflowSetupError("Restore the captured tool, model or connection before resuming.") }
    if (await runCancellationRequested(ctx, id, lease)) { await finishCancellation(); return }
    if ((await readWorkflowJournal(ctx, id)).status !== "running" || abort.signal.aborted) return
    const activeWorker = runtime.workers.get(key(ctx, id))
    // Cancellation and emissions share a queue, so an accepted snapshot cannot
    // slip between the final flush and the terminal journal commit. Rejected
    // actions leave the queue usable and never abort the worker.
    let emissions = Promise.resolve()
    const serializeEmission = (work: () => Promise<void>) => {
      const next = emissions.catch(() => {}).then(work)
      emissions = next
      return next
    }
    if (activeWorker) activeWorker.cancel = operationId => serializeEmission(async () => {
      await actionOnRun(ctx, id, operationId, "cancel")
      await finishCancellation()
    })
    const io: WorkflowIO = {
      publishArtifact: async input => {
        let artifact!: Awaited<ReturnType<typeof publishArtifact>>
        await serializeEmission(async () => {
          abort.signal.throwIfAborted()
          artifact = await publishArtifact(ctx, id, input, lease)
          await text.flush()
          await emitRunEvent(ctx, id, lease, { type: "artifact", artifact })
        })
        return artifact
      },
      submitWikiProposal: input => {
        abort.signal.throwIfAborted()
        return submitWikiProposal(ctx, id, input, lease)
      },
      signal: abort.signal,
      step: <T>(intent: Parameters<typeof journalStep>[3], work: () => Promise<T>) => {
        abort.signal.throwIfAborted()
        return journalStep(ctx, id, lease, intent, async () => { abort.signal.throwIfAborted(); return work() })
      },
      emit: (input: Parameters<typeof emitRunEvent>[3]) => serializeEmission(async () => {
        const event = RunEventInputSchema.parse(input)
        abort.signal.throwIfAborted()
        if (event.type === "text") { await text.emit(event.text); return }
        await text.flush()
        await emitRunEvent(ctx, id, lease, event)
        if (event.type === "status") abort.abort(new Error("Workflow waiting for user action"))
      }),
    }
    if (!outputsCompleted) {
      await withRunAttemptScope(ctx, id, () => adapter!.execute(ctx, run, io), abort.signal)
      if (!abort.signal.aborted && (await readWorkflowJournal(ctx, id)).status === "running" && !await hasUncertainWork(ctx, id)) {
        await markWorkflowOutputsCompleted(ctx, id, lease)
      }
    }
    if (await runCancellationRequested(ctx, id, lease)) { await finishCancellation(); return }
    await text.flush()
    if (!abort.signal.aborted && !await hasUncertainWork(ctx, id)) await saveAuthorizedWorkflowOutputs(ctx, id, lease)
    if ((await readWorkflowJournal(ctx, id)).status === "running") {
      await transitionRun(ctx, id, await hasUncertainWork(ctx, id) ? "needs_attention" : abort.signal.aborted ? "interrupted" : "completed", lease)
    }
  } catch (error) {
    if (await runCancellationRequested(ctx, id, lease).catch(() => false)) { await finishCancellation(); return }
    await text.flush().catch(() => {})
    const current = await readWorkflowJournal(ctx, id)
    if (current.status === "running" && current.lease?.id === lease.id) {
      const recoveryConflict = error instanceof ChangesetRecoveryConflictError
      const uncertain = recoveryConflict || error instanceof UncertainWorkflowError || await hasUncertainWork(ctx, id)
      const limit = error instanceof WorkflowLimitError
      const status = uncertain ? "needs_attention" : error instanceof WorkflowSetupError ? "waiting_for_setup" : limit ? "paused_limit" : abort.signal.aborted ? "interrupted" : "failed"
      await emitRunEvent(ctx, id, lease, { type: "error", code: recoveryConflict ? error.code : status,
        message: recoveryConflict ? error.message : status === "needs_attention" ? "An attempt needs reconciliation before this run can continue."
          : status === "waiting_for_setup" ? "Restore the captured tool, model or connection before resuming."
          : status === "paused_limit" ? "This run reached its allowance. Extend the allowance before resuming." : "The workflow stopped. Its saved checkpoints are preserved." })
      await transitionRun(ctx, id, status, lease)
    }
  } finally {
    clearInterval(heartbeat)
    await releaseRunLease(ctx, id, lease)
  }
}
export async function recoverWorkflowRuns(contexts: WorkflowContext[]): Promise<void> {
  for (const ctx of contexts) {
    const claimed = await withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
      await restoreStartRecords(ctx)
      const runs = await listRuns(ctx)
      for (const run of runs) {
        const journal = await readWorkflowJournal(ctx, run.id)
        if (journal.cancelRequested && !leaseOwnerAlive(journal.lease)) await actionOnRun(ctx, run.id, journal.cancelRequested, "cancel")
      }
      // A cancelled/paused owner can still be unwinding a process. Do not start
      // another root until it releases ownership, even after lease expiry.
      for (const run of runs) if (leaseOwnerAlive((await readWorkflowJournal(ctx, run.id)).lease)) return null
      for (const run of runs) {
        const journal = await readWorkflowJournal(ctx, run.id)
        if (!["queued", "running", "interrupted"].includes(journal.status)) continue
        if (await hasUncertainWork(ctx, run.id)) { await transitionRun(ctx, run.id, "needs_attention"); continue }
        try { if (!await workflowOutputsCompleted(ctx, run.id)) await adapterFor(ctx, run) } catch { await transitionRun(ctx, run.id, "waiting_for_setup"); continue }
        const lease = await claimRunLease(ctx, run.id)
        if (lease) return { id: run.id, lease }
      }
      return null
    })
    if (claimed) {
      const workerKey = key(ctx, claimed.id), abort = new AbortController()
      const done = executeOwned(ctx, claimed.id, claimed.lease, abort).catch(reportBackgroundError).finally(() => {
        runtime.workers.delete(workerKey)
        if (!runtime.stopped) schedule(ctx)
      })
      runtime.workers.set(workerKey, { abort, done })
    }
  }
}
/** One poller per Node runtime, including HMR. Startup never awaits adapter work.
 * Profile registry enumeration captures each owner rather than browser selection. */
export async function startWorkflowCoordinator(): Promise<() => void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return () => {}
  if (runtime.stop) return runtime.stop
  runtime.stopped = false
  let pending = false, stopped = false
  const tick = async () => {
    if (pending || stopped || runtime.stopped) return
    pending = true
    try {
      const profiles = await initializeLocalProfiles()
      const contexts = await Promise.all(profiles.map(profile => resolveWorkflowContext(profile)))
      if (!stopped && !runtime.stopped) await recoverWorkflowRuns(contexts)
    } catch { reportBackgroundError() } finally { pending = false }
  }
  const timer = setInterval(() => { track(tick()) }, 5000)
  timer.unref?.()
  runtime.stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer); runtime.stopped = true; runtime.stop = undefined
    for (const worker of runtime.workers.values()) worker.abort.abort(new Error("Workflow runtime stopping"))
  }
  track(tick())
  return runtime.stop
}

/** Observe local work settling without tying execution to an HTTP observer. */
export async function waitForWorkflowIdle(): Promise<void> {
  while (runtime.workers.size || runtime.background.size) {
    await Promise.all([...runtime.workers.values()].map(worker => worker.done).concat([...runtime.background]))
  }
}
