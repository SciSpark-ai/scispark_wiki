import { actOnReview } from "../review/coordinator"
import { reconcileNativeAccounting } from "../workflows/native-recovery"
import { resolveRunModel, settingsForRunModel } from "../workflows/model"
import { reviewModel } from "../review/budget"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { getWorkflowContext, type WorkflowContext } from "../workflows/context"
import { startRun, observeRun, recoverWorkflowRuns, cancelRun } from "../workflows/coordinator"
import { readWorkflowJournal, transitionRun, leaseOwnerAlive, hasUncertainWork } from "../workflows/journal"
import { requireEnabledTool, ToolDisabledError } from "../extensions/require-tool"
import { toolKey } from "../extensions/contracts"
import { nativePath, nativeStepId, NativeReviewContinuationSchema } from "../extensions/native-adapters"
import { loadReview } from "../review/store"
import { ReviewActionSchema, ReviewId } from "../review/contracts"
import { withVaultExclusive } from "../vault/exclusive"
import { readRun } from "../workflows/store"

class NativeObservationError extends Error {}
let testContext: WorkflowContext | undefined
/** Disposable fixture injection, analogous to setServerVaultForTests. */
export function setNativeWorkflowContextForTests(ctx?: WorkflowContext) { testContext = ctx }
export const nativeContext = () => testContext ? Promise.resolve(testContext) : getWorkflowContext()
export const nativeKey = (skill: string) => toolKey({ packageId: "scispark.builtin", skillId: skill })
const operation = (value: unknown) => typeof value === "string" && value ? nativeStepId(value, "legacy-operation") : randomUUID()

export async function startNativeWorkflow(ctx: WorkflowContext, skill: string, input: Record<string, unknown>) {
  const tool = await requireEnabledTool(ctx, nativeKey(skill))
  return startRun(ctx, { operationId: operation(input.operationId), tool: tool.ref, input, contextRefs: [], writeIntent: "outputs_only" })
}
export async function observeNativeResult(ctx: WorkflowContext, id: string, emit: (event: object) => void = () => {}) {
  let cursor = 0
  for (;;) {
    const progress = await ctx.storage.read(nativePath(id, "progress"))
    if (progress) { const events: object[] = JSON.parse(progress); for (const event of events.slice(cursor)) emit(event); cursor = events.length }
    const run = await observeRun(ctx, id), journal = await readWorkflowJournal(ctx, id)
    const result = await ctx.storage.read(nativePath(id, `result-${id}`))
    if (!["queued", "running"].includes(journal.status) && !leaseOwnerAlive(journal.lease)) {
      if (result && ["completed", "waiting_for_choice", "needs_attention"].includes(journal.status)) return JSON.parse(result)
      throw new NativeObservationError(run.status === "waiting_for_setup" ? "Connect the captured AI model in Settings before continuing." : run.status === "waiting_for_choice" ? "Enter a research question or complete the tool input to continue." : `The workflow is ${run.status}. Its saved work is retained.`)
    }
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}
/** Guard before committing streaming headers. Observer cancellation never cancels work. */
export function nativeSkillRoute(skill: string, transport: "json" | "ndjson", map: (raw: unknown) => Record<string, unknown>) {
  return async (request: Request) => {
    try {
      const ctx = await nativeContext()
      await requireEnabledTool(ctx, nativeKey(skill))
      const input = map(await request.json())
      const run = await startNativeWorkflow(ctx, skill, input)
      if (transport === "json") return Response.json({ result: await observeNativeResult(ctx, run.id) }, { headers: { "x-scispark-workflow-id": run.id } })
      let closed = false
      return new Response(new ReadableStream({
        async start(controller) {
          const emit = (event: object) => { if (!closed) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")) }
          try { emit({ type: "result", payload: await observeNativeResult(ctx, run.id, emit) }) }
          catch (error) { emit({ type: "error", message: error instanceof Error ? error.message : "Workflow stopped" }) }
          finally { if (!closed) controller.close(); closed = true }
        }, cancel() { closed = true },
      }), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "x-scispark-workflow-id": run.id } })
    } catch (error) { return Response.json({ error: error instanceof ToolDisabledError || error instanceof NativeObservationError ? error.message : "The native workflow could not start." }, { status: error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 409 }) }
  }
}

/** Explicit native continuation, shared by the legacy review UI and Task17.
 * The same envelope/counters survive retries. A stable receipt prevents replay. */
const ContinuationReceiptSchema = z.object({
  operationId: z.string().uuid(), choice: z.enum(["retry", "keep"]), action: ReviewActionSchema.optional(),
  next: NativeReviewContinuationSchema.optional(), complete: z.boolean(),
}).strict()
const CONTINUABLE_REVIEW_STATES = ["waiting_for_choice", "needs_attention", "paused_limit", "interrupted", "waiting_for_setup"]
const RESUMABLE_NATIVE_STATES = ["paused", "interrupted", "failed", "partial"]
type ContinuationReceipt = z.infer<typeof ContinuationReceiptSchema>

/** Called while holding native-review-control and the native review-control
 * exclusion. Validate the exact native revision/state before accepting intent,
 * and therefore before any financial acknowledgement or journal mutation. */
async function prepareReviewContinuation(ctx: WorkflowContext, id: string, reviewId: string, operationId: string,
  choice: "retry" | "keep", action: z.infer<typeof ReviewActionSchema> | undefined): Promise<ContinuationReceipt> {
  const review = await loadReview(ctx.storage, reviewId)
  const path = nativePath(id, `review-${id}`)
  const raw = await ctx.storage.read(path)
  const previous = raw ? NativeReviewContinuationSchema.parse(JSON.parse(raw)) : null
  if (previous && previous.reviewId !== reviewId) throw new Error("Native continuation identity mismatch")
  const selected = action ?? { action: review.status === "awaiting-approval" ? "approve" as const : "resume" as const, revision: review.revision }
  if (choice === "retry") {
    if (!(selected.action === "approve" || selected.action === "resume") || selected.revision !== review.revision) throw new Error("Review changed; reload before resuming")
    const eligible = selected.action === "approve" ? review.status === "awaiting-approval" : RESUMABLE_NATIVE_STATES.includes(review.status)
    if (!eligible) throw new Error("This review action no longer applies; reload before continuing")
    if (review.status === "partial" && review.versions.at(-1)?.verification === "checked-draft" && review.versions.at(-1)?.answerCoverage?.status === "limited") throw new Error("This answer needs additional evidence; start a new review with a revised scope")
  } else if (!["partial", "paused", "interrupted", "failed", "completed"].includes(review.status) || !review.versions.length) {
    throw new Error("No stopped review report is available to keep")
  }
  const next = NativeReviewContinuationSchema.parse({
    reviewId, action: choice === "keep" ? previous?.action ?? selected : selected,
    generation: previous ? previous.generation + (choice === "retry" ? 1 : 0) : 0,
    operationId, ...(choice === "keep" ? { kept: true } : {}),
  })
  return ContinuationReceiptSchema.parse({ operationId, choice, action, next, complete: false })
}

async function reconcileAcceptedContinuation(ctx: WorkflowContext, id: string, receipt: ContinuationReceipt) {
  const action = receipt.next?.action
  const acknowledge = receipt.choice === "retry" && action && (action.action === "approve" || action.action === "resume") && action.acknowledgeUncertainCharge
  const operationId = acknowledge ? receipt.operationId : nativeStepId(receipt.operationId, "reconcile")
  await reconcileNativeAccounting(ctx, id, operationId, acknowledge ? "acknowledge" : "reconcile")
  if (await hasUncertainWork(ctx, id)) throw new Error("Review needs reconciliation before continuing")
}

async function publishReviewContinuation(ctx: WorkflowContext, id: string, path: string, receipt: ContinuationReceipt) {
  if (receipt.next) await ctx.storage.write(nativePath(id, `review-${id}`), JSON.stringify(receipt.next))
  const journal = await readWorkflowJournal(ctx, id)
  if (CONTINUABLE_REVIEW_STATES.includes(journal.status)) await transitionRun(ctx, id, "queued")
  else if (!["queued", "completed"].includes(journal.status)) throw new Error("Review continuation no longer applies")
  await ctx.storage.write(path, JSON.stringify({ ...receipt, complete: true }))
}

/** A completed receipt records queue admission, not successful preflight. Only
 * its still-current, unconsumed native action may be admitted after setup fails. */
async function setupAdmissionStillPending(ctx: WorkflowContext, id: string, receipt: ContinuationReceipt) {
  if (receipt.choice !== "retry" || !receipt.next) return false
  const action = receipt.next.action
  if (action.action !== "approve" && action.action !== "resume") return false
  const raw = await ctx.storage.read(nativePath(id, `review-${id}`))
  if (!raw || JSON.stringify(NativeReviewContinuationSchema.parse(JSON.parse(raw))) !== JSON.stringify(receipt.next)) return false
  const review = await loadReview(ctx.storage, receipt.next.reviewId)
  return review.revision === action.revision
}

export async function continueNativeReview(ctx: WorkflowContext, id: string, operationId: string, choice: "retry" | "keep", action?: unknown) {
  await requireEnabledTool(ctx, nativeKey("deep-review"))
  const parsedAction = action === undefined ? undefined : ReviewActionSchema.parse(action)
  if (parsedAction && !["approve", "resume"].includes(parsedAction.action)) throw new Error("Invalid review continuation action")
  await withVaultExclusive(ctx.storage, "native-review-control", () => withVaultExclusive(ctx.storage, "review-control", async () => {
    const run = await readRun(ctx, id)
    if (!run || run.nativeRunRef?.kind !== "deep-review") throw new Error("Native review workflow unavailable")
    const receiptPath = nativePath(id, `continuation-${z.string().uuid().parse(operationId)}`)
    const receiptRaw = await ctx.storage.read(receiptPath)
    let receipt = receiptRaw ? ContinuationReceiptSchema.parse(JSON.parse(receiptRaw)) : null
    if (receipt && (receipt.choice !== choice || JSON.stringify(receipt.action) !== JSON.stringify(parsedAction))) throw new Error("Review continuation identity conflict")
    const journal = await readWorkflowJournal(ctx, id)
    if (receipt?.complete) {
      if (journal.status !== "waiting_for_setup" || journal.cancelRequested || leaseOwnerAlive(journal.lease)
        || !await setupAdmissionStillPending(ctx, id, receipt)) return
      // Revalidate the native action under review-control before reacceptance.
      // Progressed, replaced, active and completed actions retain idempotency.
      receipt = await prepareReviewContinuation(ctx, id, run.nativeRunRef.id, operationId, choice, parsedAction)
      await ctx.storage.write(receiptPath, JSON.stringify(receipt))
    }
    if (journal.cancelRequested || leaseOwnerAlive(journal.lease)) throw new Error("Wait for the review owner to stop")
    if (!receipt) {
      if (!CONTINUABLE_REVIEW_STATES.includes(journal.status)) throw new Error("Review has no pending continuation")
      receipt = await prepareReviewContinuation(ctx, id, run.nativeRunRef.id, operationId, choice, parsedAction)
      // Durable acceptance follows validation and precedes financial mutation.
      // An accepted incomplete receipt remains repairable after native revisions
      // advance; new/stale requests never inherit that authority.
      await ctx.storage.write(receiptPath, JSON.stringify(receipt))
    }
    await reconcileAcceptedContinuation(ctx, id, receipt)
    await publishReviewContinuation(ctx, id, receiptPath, receipt)
  }))
  await recoverWorkflowRuns([ctx])
}

async function observeReviewAdmission(ctx: WorkflowContext, id: string, reviewId: string, revision: number) {
  for (;;) {
    const review = await loadReview(ctx.storage, reviewId)
    if (review.revision !== revision || !["queued", "running"].includes((await observeRun(ctx, id)).status)) return review
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}
export async function legacyReviewAction(ctx: WorkflowContext, reviewId: string, raw: unknown) {
  ReviewId.parse(reviewId)
  const action = ReviewActionSchema.parse(raw)
  const index = `.scispark/reviews/${reviewId}/workflow.json`
  return withVaultExclusive(ctx.storage, `native-review-${reviewId}`, async () => {
    const previous = await ctx.storage.read(index)
    const old = previous ? z.object({ id: z.string().uuid() }).parse(JSON.parse(previous)) : null
    if (action.action === "cancel") { if (old) await cancelRun(ctx, old.id, randomUUID()); return actOnReview(ctx.storage, reviewId, action) }
    await requireEnabledTool(ctx, nativeKey("deep-review"))
    const operationId = createHash("sha256").update(JSON.stringify({ reviewId, action })).digest("hex")
    if (old) {
      const run = await observeRun(ctx, old.id)
      if (CONTINUABLE_REVIEW_STATES.includes(run.status) && (action.action === "approve" || action.action === "resume")) {
        await continueNativeReview(ctx, old.id, nativeStepId(operationId, "resume"), "retry", action)
        return observeReviewAdmission(ctx, old.id, reviewId, action.revision)
      }
      if (["queued", "running"].includes(run.status)) return loadReview(ctx.storage, reviewId)
      if (run.status === "waiting_for_choice" && action.action === "revise") {
        await continueNativeReview(ctx, old.id, nativeStepId(operationId, "keep"), "keep")
        await observeNativeResult(ctx, old.id)
      }
      else if (!["completed", "failed", "cancelled"].includes(run.status)) throw new Error("Resolve the owning workflow before starting more review work")
    }
    const brief = (await loadReview(ctx.storage, reviewId)).brief
    const manifest = await requireEnabledTool(ctx, nativeKey("deep-review"))
    const captured = await resolveRunModel(ctx, manifest.ref)
    const target = reviewModel(await settingsForRunModel(ctx, captured))
    if (target.provider !== brief.model.provider || target.model !== brief.model.model || target.endpoint !== brief.model.endpoint) throw new Error("The approved review model differs from this tool. Review its brief before continuing.")
    const run = await startNativeWorkflow(ctx, "deep-review", { reviewId, action, operationId })
    await ctx.storage.write(index, JSON.stringify({ id: run.id }))
    if (action.action === "revise") return observeNativeResult(ctx, run.id)
    if (action.action === "approve" || action.action === "resume") return observeReviewAdmission(ctx, run.id, reviewId, action.revision)
    return loadReview(ctx.storage, reviewId)
  })
}
