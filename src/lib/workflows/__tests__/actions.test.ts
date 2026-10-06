import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"
import { workflowFixture } from "./fixtures"
import { writeRun } from "../store"
import { claimRunLease, journalStep, transitionRun, releaseRunLease, commitUncertainResolution, hasUncertainWork } from "../journal"
import { reserveAttempt, claimAttemptDispatch, getRunUsage } from "../usage"
import { RunActionInputSchema, UsageJournalSchema } from "../contracts"

async function uncertain() {
  const f = workflowFixture(); await writeRun(f.ctx, f.run)
  const lease = (await claimRunLease(f.ctx, f.run.id))!
  const step = { id: randomUUID(), kind: "model" as const, replay: "reconcile" as const, inputHash: "a".repeat(64) }
  const estimate = { modelCalls: 1, commandCalls: 0, activeSeconds: 10, costUsd: .1, accountingOwner: "workflow" as const }
  await expect(journalStep(f.ctx, f.run.id, lease, step, async () => {
    const ticket = await reserveAttempt(f.ctx, f.run.id, step, estimate); await claimAttemptDispatch(f.ctx, ticket); throw new Error("response lost")
  })).rejects.toThrow("response lost")
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  return { ...f, step, estimate }
}
describe("typed uncertain checkpoint decisions", () => {
  it("accepts strict scoped recovery and supporting choices", () => {
    expect(RunActionInputSchema.parse({ action: "resolve-uncertain", operationId: randomUUID(), stepId: randomUUID(), resolution: "retry" }).action).toBe("resolve-uncertain")
    expect(RunActionInputSchema.safeParse({ action: "choose-helper", operationId: randomUUID(), choiceId: randomUUID(), tool: workflowFixture().tool.ref, input: {} }).success).toBe(false)
  })
  it("records one concurrent retry, retains its old charge, and dispatches a fresh attempt", async () => {
    const f = await uncertain(), op = randomUUID()
    await Promise.all([1, 2].map(() => commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")))
    expect(await hasUncertainWork(f.ctx, f.run.id)).toBe(false)
    const lease = (await claimRunLease(f.ctx, f.run.id))!
    await journalStep(f.ctx, f.run.id, lease, f.step, async () => {
      const ticket = await reserveAttempt(f.ctx, f.run.id, f.step, f.estimate); await claimAttemptDispatch(f.ctx, ticket); return "new result"
    })
    const usage = UsageJournalSchema.parse(JSON.parse((await f.ctx.storage.read(`.scispark/tool-runs/${f.run.id}/usage.json`))!))
    expect(usage.attempts).toHaveLength(2)
    expect(new Set(usage.attempts.map(a => a.ticket.id)).size).toBe(2)
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(2)
    await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "stop")).rejects.toThrow()
  })
  it("stop retains uncertainty and never refunds usage", async () => {
    const f = await uncertain()
    expect((await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "stop")).status).toBe("cancelled")
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
  })
  it("repairs accepted retry after checkpoint publication response loss", async () => {
    const f = await uncertain(), op = randomUUID(), write = f.ctx.storage.write.bind(f.ctx.storage)
    let fail = true
    f.ctx.storage.write = async (path, text) => { await write(path, text); if (fail && path.endsWith(`/steps/${f.step.id}.json`)) { fail = false; throw new Error("publication lost") } }
    await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow("publication lost")
    expect((await commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).status).toBe("queued")
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
  })
})

it("associates a second uncertain retry with its original checkpoint and conservatively counts all generations", async () => {
  const f = await uncertain()
  await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "retry")
  const lease = (await claimRunLease(f.ctx, f.run.id))!
  await expect(journalStep(f.ctx, f.run.id, lease, f.step, async () => {
    const ticket = await reserveAttempt(f.ctx, f.run.id, f.step, f.estimate); await claimAttemptDispatch(f.ctx, ticket); throw new Error("second lost response")
  })).rejects.toThrow("second lost response")
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "retry")
  expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(2)
  expect((await getRunUsage(f.ctx, f.run.id)).heldAttempts).toBe(0)
  const next = (await claimRunLease(f.ctx, f.run.id))!
  await journalStep(f.ctx, f.run.id, next, f.step, async () => {
    const ticket = await reserveAttempt(f.ctx, f.run.id, f.step, f.estimate); await claimAttemptDispatch(f.ctx, ticket); return true
  })
  expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(3)
})
it("a competing stop cannot replace the winner after lost acceptance response", async () => {
  const f = await uncertain(), op = randomUUID(), write = f.ctx.storage.write.bind(f.ctx.storage)
  let fail = true
  f.ctx.storage.write = async (path, text) => { await write(path, text); if (fail && path.includes("uncertain-winners")) { fail = false; throw new Error("lost acceptance") } }
  await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow("lost acceptance")
  await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "stop")).rejects.toThrow("already selected")
  expect((await commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).status).toBe("queued")
})
it("repairs queue publication without replacing an already progressed checkpoint", async () => {
  const f = await uncertain(), op = randomUUID(), write = f.ctx.storage.write.bind(f.ctx.storage)
  let fail = true
  f.ctx.storage.write = async (path, text) => { await write(path, text); if (fail && path.endsWith("journal.json") && JSON.parse(text).status === "queued") { fail = false; throw new Error("queue response lost") } }
  await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow("queue response lost")
  const lease = (await claimRunLease(f.ctx, f.run.id))!
  await journalStep(f.ctx, f.run.id, lease, f.step, async () => "saved answer")
  await releaseRunLease(f.ctx, f.run.id, lease)
  const path = `.scispark/tool-runs/${f.run.id}/steps/${f.step.id}.json`, before = await f.ctx.storage.read(path)
  await commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")
  expect(await f.ctx.storage.read(path)).toBe(before)
})
it("keeps completed nested checkpoints cached and pending children individually gated", async () => {
  const f = workflowFixture(); await writeRun(f.ctx, f.run)
  let lease = (await claimRunLease(f.ctx, f.run.id))!, calls = 0
  const outer = { id: randomUUID(), kind: "read" as const, replay: "reconcile" as const, inputHash: "c".repeat(64) }
  const child = { ...outer, id: randomUUID() }, pending = { ...outer, id: randomUUID() }
  const body = async () => { await journalStep(f.ctx, f.run.id, lease, child, async () => { calls++; return "kept" }); await journalStep(f.ctx, f.run.id, lease, pending, async () => { throw new Error("lost nested") }) }
  await expect(journalStep(f.ctx, f.run.id, lease, outer, body)).rejects.toThrow()
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  expect((await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), outer.id, "retry")).status).toBe("needs_attention")
  await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), pending.id, "retry")
  lease = (await claimRunLease(f.ctx, f.run.id))!
  await journalStep(f.ctx, f.run.id, lease, outer, async () => {
    await journalStep(f.ctx, f.run.id, lease, child, async () => { calls++; return "wrong" })
    return journalStep(f.ctx, f.run.id, lease, pending, async () => "recovered")
  })
  expect(calls).toBe(1)
})
it("does not remap a command identity twice and retains one accounting ticket", async () => {
  const f = await uncertain()
  await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "retry")
  const { workflowRetryIdentity } = await import("../journal"), lease = (await claimRunLease(f.ctx, f.run.id))!
  await journalStep(f.ctx, f.run.id, lease, f.step, async () => {
    const commandId = workflowRetryIdentity(f.step.id)
    expect(commandId).not.toBe(f.step.id); expect(workflowRetryIdentity(commandId)).toBe(commandId)
    const ticket = await reserveAttempt(f.ctx, f.run.id, { ...f.step, id: commandId, kind: "command" }, { ...f.estimate, modelCalls: 0, commandCalls: 1, costUsd: 0 })
    expect(ticket.step.id).toBe(commandId); expect(ticket.checkpointId).toBe(f.step.id)
    await claimAttemptDispatch(f.ctx, ticket); return true
  })
  expect((await getRunUsage(f.ctx, f.run.id)).commandCalls).toBe(1)
})
it("refuses owner races, native uncertainty and wiki blind retries", async () => {
  const f = await uncertain(), op = randomUUID()
  await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/steps/${f.step.id}.json`, JSON.stringify({ schemaVersion: 1, runId: f.run.id, intent: { ...f.step, kind: "wiki_write" }, leaseId: randomUUID(), state: "pending" }))
  await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow(/changeset/)
  const g = await uncertain(), raw = JSON.parse((await g.ctx.storage.read(`.scispark/tool-runs/${g.run.id}/usage.json`))!)
  raw.attempts[0].ticket.estimate.accountingOwner = "native"
  await g.ctx.storage.write(`.scispark/tool-runs/${g.run.id}/usage.json`, JSON.stringify(raw))
  await expect(commitUncertainResolution(g.ctx, g.run.id, randomUUID(), g.step.id, "retry")).rejects.toThrow(/other uncertain usage/)
})
it("retains acknowledged generation when the next reservation reaches its limit", async () => {
  const f = await uncertain(), usagePath = `.scispark/tool-runs/${f.run.id}/usage.json`
  const raw = JSON.parse((await f.ctx.storage.read(usagePath))!); raw.allowance.modelCalls = 1; await f.ctx.storage.write(usagePath, JSON.stringify(raw))
  const op = randomUUID(); await commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")
  let lease = (await claimRunLease(f.ctx, f.run.id))!
  await expect(journalStep(f.ctx, f.run.id, lease, f.step, () => reserveAttempt(f.ctx, f.run.id, f.step, f.estimate))).rejects.toThrow(/limit/)
  await transitionRun(f.ctx, f.run.id, "paused_limit", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  const { extendAllowance } = await import("../usage"), { actionOnRun } = await import("../journal")
  await extendAllowance(f.ctx, f.run.id, randomUUID(), { modelCalls: 1 }); await actionOnRun(f.ctx, f.run.id, randomUUID(), "resume")
  lease = (await claimRunLease(f.ctx, f.run.id))!
  const ticket = await journalStep(f.ctx, f.run.id, lease, f.step, () => reserveAttempt(f.ctx, f.run.id, f.step, f.estimate))
  expect(ticket.retryOperation).toBe(op); expect(ticket.step.id).not.toBe(f.step.id)
})
it("selects one winner for concurrent retry versus stop", async () => {
  const f = await uncertain()
  const results = await Promise.allSettled([commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "retry"), commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.step.id, "stop")])
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
  expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
})
it("refuses acknowledgement until a live owner and cancellation have stopped", async () => {
  const f = workflowFixture(); await writeRun(f.ctx, f.run)
  const lease = (await claimRunLease(f.ctx, f.run.id))!, step = { id: randomUUID(), kind: "read" as const, replay: "reconcile" as const, inputHash: "d".repeat(64) }
  await expect(journalStep(f.ctx, f.run.id, lease, step, async () => { throw new Error("lost") })).rejects.toThrow()
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease)
  await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), step.id, "retry")).rejects.toThrow(/still stopping/)
  const { actionOnRun } = await import("../journal")
  await actionOnRun(f.ctx, f.run.id, randomUUID(), "cancel"); await releaseRunLease(f.ctx, f.run.id, lease)
  await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), step.id, "retry")).rejects.toThrow(/still stopping/)
  expect(await f.ctx.storage.list(`.scispark/tool-runs/${f.run.id}/uncertain-resolutions/`)).toEqual([])
})
it("binds the complete decision before a winner publication response is lost", async () => {
  const f = await uncertain(), op = randomUUID(), write = f.ctx.storage.write.bind(f.ctx.storage)
  let fail = true
  f.ctx.storage.write = async (path, text) => { await write(path, text); if (fail && path.includes("uncertain-winners")) { fail = false; throw new Error("lost winner") } }
  await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow("lost winner")
  await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "stop")).rejects.toThrow(/selected|conflict/)
})
it("refuses only the exact native wording-revision checkpoint, including helper frames", async () => {
  const { nativeStepId } = await import("../../extensions/native-adapters"), { checkpointRetryable, checkpointRecovery } = await import("../journal")
  const f = workflowFixture(); await writeRun(f.ctx, f.run)
  const frame = randomUUID(), generation = 2, step = { id: nativeStepId(frame, `revision-${generation}`), kind: "read" as const, replay: "reconcile" as const, inputHash: "d".repeat(64) }
  await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/native-review-${frame}.json`, JSON.stringify({ reviewId: `review_${"a".repeat(32)}`, generation, operationId: randomUUID(), action: { action: "revise", parent: randomUUID(), instruction: "Clarify wording" } }))
  expect(await checkpointRetryable(f.ctx, f.run.id, step)).toBe(false)
  expect(await checkpointRecovery(f.ctx, f.run.id, step)).toEqual({ retryable: false, recovery: { kind: "native_revision", reviewId: `review_${"a".repeat(32)}` } })
  expect(await checkpointRecovery(f.ctx, f.run.id, { ...step, kind: "wiki_write" })).toEqual({ retryable: false, recovery: { kind: "wiki_changeset" } })
  expect(await checkpointRetryable(f.ctx, f.run.id, { ...step, id: nativeStepId(frame, "report-version") })).toBe(true)
  const lease = (await claimRunLease(f.ctx, f.run.id))!
  await expect(journalStep(f.ctx, f.run.id, lease, step, async () => { throw new Error("lost revision") })).rejects.toThrow()
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  const { workflowSnapshot } = await import("../../server/workflow-api")
  const snapshot = await workflowSnapshot(f.ctx, f.run.id)
  expect(snapshot.observation!.uncertainSteps).toEqual([{ id: step.id, kind: "read", retryable: false, recovery: { kind: "native_revision", reviewId: `review_${"a".repeat(32)}` } }])
  expect(JSON.stringify(snapshot)).not.toContain("Clarify wording")
  await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), step.id, "retry")).rejects.toThrow("new explicit native revision")
  await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), step.id, "stop")
  expect((await workflowSnapshot(f.ctx, f.run.id)).observation!.uncertainSteps).toEqual(snapshot.observation!.uncertainSteps)
})
it("repairs a durable accepted decision after reopening filesystem storage", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"), { NodeFsVaultStorage } = await import("../../vault/node-fs-storage")
  const directory = await mkdtemp("/tmp/scispark-task17-recovery-")
  try {
    const f = await uncertain(), disk = new NodeFsVaultStorage(directory)
    for (const path of await f.ctx.storage.list()) await disk.write(path, (await f.ctx.storage.read(path))!)
    f.ctx.storage = disk
    const op = randomUUID(), write = disk.write.bind(disk); let fail = true
    disk.write = async (path, text) => { await write(path, text); if (fail && path.endsWith(`/steps/${f.step.id}.json`)) { fail = false; throw new Error("process response lost") } }
    await expect(commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).rejects.toThrow("process response lost")
    f.ctx.storage = new NodeFsVaultStorage(directory)
    expect((await commitUncertainResolution(f.ctx, f.run.id, op, f.step.id, "retry")).status).toBe("queued")
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(1)
    const lease = (await claimRunLease(f.ctx, f.run.id))!
    const ticket = await journalStep(f.ctx, f.run.id, lease, f.step, () => reserveAttempt(f.ctx, f.run.id, f.step, f.estimate))
    expect(ticket.retryOperation).toBe(op)
    expect((await getRunUsage(f.ctx, f.run.id)).modelCalls).toBe(2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function twoUncertainTickets() {
  const f = workflowFixture(); await writeRun(f.ctx, f.run)
  const lease = (await claimRunLease(f.ctx, f.run.id))!
  const steps = [0, 1].map(() => ({ id: randomUUID(), kind: "model" as const, replay: "reconcile" as const, inputHash: "a".repeat(64) }))
  for (const step of steps) await expect(journalStep(f.ctx, f.run.id, lease, step, async () => {
    const ticket = await reserveAttempt(f.ctx, f.run.id, step, { modelCalls: 1, commandCalls: 0, activeSeconds: 5, costUsd: .1, accountingOwner: "workflow" })
    await claimAttemptDispatch(f.ctx, ticket); throw new Error("lost")
  })).rejects.toThrow("lost")
  await transitionRun(f.ctx, f.run.id, "needs_attention", lease); await releaseRunLease(f.ctx, f.run.id, lease)
  return { ...f, steps }
}
it("acknowledges the selected second ticket only, then queues after the other decision without refunding either", async () => {
  const f = await twoUncertainTickets(), operation = randomUUID()
  expect((await getRunUsage(f.ctx, f.run.id)).heldAttempts).toBe(2)
  expect((await commitUncertainResolution(f.ctx, f.run.id, operation, f.steps[1].id, "retry")).status).toBe("needs_attention")
  const usage = UsageJournalSchema.parse(JSON.parse((await f.ctx.storage.read(`.scispark/tool-runs/${f.run.id}/usage.json`))!))
  expect(usage.attempts[0].acknowledgedBy).toBeUndefined(); expect(usage.attempts[1].acknowledgedBy).toBe(operation)
  expect(await getRunUsage(f.ctx, f.run.id)).toMatchObject({ heldAttempts: 1, modelCalls: 2, activeSeconds: 5, heldActiveSeconds: 5 })
  await expect(commitUncertainResolution(f.ctx, f.run.id, operation, f.steps[0].id, "retry")).rejects.toThrow()
  expect((await commitUncertainResolution(f.ctx, f.run.id, operation, f.steps[1].id, "retry")).status).toBe("needs_attention")
  expect((await commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.steps[0].id, "retry")).status).toBe("queued")
  expect(await getRunUsage(f.ctx, f.run.id)).toMatchObject({ heldAttempts: 0, modelCalls: 2, activeSeconds: 10 })
})
it("serializes two checkpoint decisions and duplicate/conflicting replays", async () => {
  const f = await twoUncertainTickets(), operations = [randomUUID(), randomUUID()]
  const results = await Promise.all(f.steps.map((step, index) => commitUncertainResolution(f.ctx, f.run.id, operations[index], step.id, "retry")))
  expect(results.map(run => run.status).sort()).toEqual(["needs_attention", "queued"])
  await Promise.all(f.steps.map((step, index) => commitUncertainResolution(f.ctx, f.run.id, operations[index], step.id, "retry")))
  await expect(commitUncertainResolution(f.ctx, f.run.id, operations[0], f.steps[0].id, "stop")).rejects.toThrow()
  expect(await getRunUsage(f.ctx, f.run.id)).toMatchObject({ heldAttempts: 0, modelCalls: 2, activeSeconds: 10 })
})
it("does not guess an unmatched uncertain workflow ticket's checkpoint", async () => {
  const f = await twoUncertainTickets(), path = `.scispark/tool-runs/${f.run.id}/usage.json`
  const usage = JSON.parse((await f.ctx.storage.read(path))!); usage.attempts[0].ticket.step.id = randomUUID()
  await f.ctx.storage.write(path, JSON.stringify(usage))
  await expect(commitUncertainResolution(f.ctx, f.run.id, randomUUID(), f.steps[1].id, "retry")).rejects.toThrow(/other uncertain usage/)
  expect((await getRunUsage(f.ctx, f.run.id)).heldAttempts).toBe(2)
})
it.each(["live", "cancelling"])("blocks fresh native admission while terminal owner's %s fence remains", async fence => {
  const f = workflowFixture(), reviewId = `review_${"d".repeat(32)}`
  await writeRun(f.ctx, { ...f.run, status: "cancelled", nativeRunRef: { kind: "deep-review", id: reviewId } })
  const { readWorkflowJournal } = await import("../journal"), { assertNativeReviewAdmission } = await import("../review-ownership"), { withVaultExclusive } = await import("../../vault/exclusive")
  const journal = await readWorkflowJournal(f.ctx, f.run.id)
  if (fence === "live") journal.lease = { id: randomUUID(), processId: randomUUID(), pid: process.pid, expiresAt: 0 }
  else journal.cancelRequested = randomUUID()
  await f.ctx.storage.write(`.scispark/tool-runs/${f.run.id}/journal.json`, JSON.stringify(journal))
  await expect(withVaultExclusive(f.ctx.storage, "workflow-coordinator", () => assertNativeReviewAdmission(f.ctx, reviewId))).rejects.toThrow(/owning workflow/)
})
