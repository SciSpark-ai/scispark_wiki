import { Meter } from "../llm/metering"
import { NativeFinancialLinkSchema } from "./native-attempt"
import { z } from "zod"
import { withVaultExclusive } from "../vault/exclusive"
import { readNativeReservations, writeNativeReservation } from "../llm/native-reservations"
import { acknowledgeReviewCharge, releaseReviewPreparation } from "../review/budget"
import { UsageJournalSchema } from "./contracts"
import type { WorkflowContext } from "./context"
import { readRun } from "./store"
import { readWorkflowJournal, leaseOwnerAlive } from "./journal"
import { settleAttempt, getRunUsage, releaseUndispatchedNativeAttempt } from "./usage"

const ReconciliationSchema = z.object({ operationId: z.string().uuid(), mode: z.enum(["reconcile", "acknowledge"]), complete: z.boolean() }).strict()
/** Task17 explicit accounting action. Never replays a provider call or clears
 * opaque native checkpoints. Reconcile uses durable known financial records;
 * acknowledge conservatively counts a missing response at its reserved ceiling.
 * No active owner may race this operation. Review ledgers retain their own ack.
 * Lock order: native reconciliation -> coordinator -> native ledger locks ->
 * workflow journal. Coordinator exclusion prevents claiming a stopped root
 * while preparation proof and native financial state are reconciled. */
export async function reconcileNativeAccounting(ctx: WorkflowContext, runId: string, operationId: string, mode: "reconcile" | "acknowledge") {
  const requested = ReconciliationSchema.parse({ operationId, mode, complete: false })
  return withVaultExclusive(ctx.storage, `native-reconcile-${z.string().uuid().parse(runId)}`, async () => withVaultExclusive(ctx.storage, "workflow-coordinator", async () => {
    const run = await readRun(ctx, runId)
    if (!run) throw new Error("Workflow run not found")
    const journal = await readWorkflowJournal(ctx, runId)
    if (leaseOwnerAlive(journal.lease) || journal.cancelRequested) throw new Error("Wait for the owning workflow to stop before reconciling")
    const path = `.scispark/tool-runs/${runId}/native-reconciliations/${operationId}.json`
    const raw = await ctx.storage.read(path)
    if (raw) {
      const old = ReconciliationSchema.parse(JSON.parse(raw))
      if (old.mode !== mode || old.operationId !== operationId) throw new Error("Native reconciliation identity conflict")
      if (old.complete) return getRunUsage(ctx, runId)
    } else await ctx.storage.write(path, JSON.stringify(requested))
    const usageRaw = await ctx.storage.read(`.scispark/tool-runs/${runId}/usage.json`)
    if (usageRaw) {
      const usage = UsageJournalSchema.parse(JSON.parse(usageRaw))
      if (usage.runId !== runId || usage.profileId !== ctx.profileId || usage.vaultId !== ctx.vaultId) throw new Error("Native accounting owner mismatch")
      const links = await Promise.all(usage.attempts.filter(row => row.ticket.estimate.accountingOwner === "native").map(async row => {
        const raw = await ctx.storage.read(`.scispark/tool-runs/${runId}/native-financial-links/${row.ticket.step.id}.json`)
        if (!raw) return null
        const link = NativeFinancialLinkSchema.parse(JSON.parse(raw))
        if (link.id !== row.ticket.step.id) throw new Error("Native financial reference mismatch")
        return link
      }))
      for (const link of links) {
        if (link?.dispatchState === "prepared" && link.nativeRunId && link.ledger !== "meter") {
          await releaseReviewPreparation(ctx.storage, link.nativeRunId, link.id, link.ledger)
        }
      }
      const reviewIds = [...new Set(links.flatMap(link => link?.nativeRunId ? [link.nativeRunId] : []))]
      if (mode === "acknowledge") for (const id of reviewIds) await acknowledgeReviewCharge(ctx.storage, id)
      await withVaultExclusive(ctx.storage, "ai-spend", async () => {
        const native = await readNativeReservations(ctx.storage)
        const reviewRaw = await ctx.storage.read(".scispark/usage/review-attempts.json")
        const review = reviewRaw ? z.array(z.object({ id: z.string().uuid(), runId: z.string(), state: z.string(), costUsd: z.number().nullable(), reservedUsd: z.number() }).passthrough()).parse(JSON.parse(reviewRaw)) : []
        const local = (await Promise.all(reviewIds.map(async id => {
          const raw = await ctx.storage.read(`.scispark/reviews/${id}/engine-attempts.json`)
          return raw ? z.array(z.object({ id: z.string().uuid(), state: z.string() }).passthrough()).parse(JSON.parse(raw)) : []
        }))).flat()
        for (const row of usage.attempts) {
          if (["known", "not_dispatched"].includes(row.state) || row.ticket.estimate.accountingOwner !== "native") continue
          const id = row.ticket.step.id
          let costUsd: number | null, ledger: "meter" | "review" | "local-review"
          const nativeRow = native.find(item => item.id === id && item.runId === runId)
          const link = links.find(item => item?.id === id)
          if (link?.dispatchState === "prepared") {
            // No external provider dispatch became possible. Release the native hold first;
            // response loss can replay this publication before the root mirror.
            if (nativeRow && nativeRow.state !== "released") {
              if (nativeRow.state !== "reserved") throw new Error("Native preparation conflicts with a settled charge")
              await writeNativeReservation(ctx.storage, { ...nativeRow, state: "released", costUsd: nativeRow.billingMode === "subscription" ? null : 0 })
            }
            await releaseUndispatchedNativeAttempt(ctx, row.ticket)
            continue
          }
          const reviewRow = review.find(item => item.id === id && item.runId === links.find(link => link?.id === id)?.nativeRunId)
          const localRow = local.find(item => item.id === id)
          if (nativeRow) {
            const subscription = nativeRow.billingMode === "subscription"
            const billed = (await new Meter(ctx.storage).recordsForDay(nativeRow.day)).find(record => record.runId === id)
            const knownBill = billed && (subscription ? billed.costUsd === null && billed.usage?.billingMode === "subscription"
              : typeof billed.costUsd === "number" && Number.isFinite(billed.costUsd) && billed.costUsd >= 0)
            costUsd = subscription ? null : knownBill ? billed!.costUsd : nativeRow.costUsd ?? nativeRow.reservedUsd
            if (nativeRow.state === "reserved") {
              if (!knownBill && mode !== "acknowledge") continue
              await writeNativeReservation(ctx.storage, { ...nativeRow, state: knownBill ? "settled" : "acknowledged", costUsd })
            }
            ledger = "meter"
          } else if (reviewRow && ["settled", "acknowledged"].includes(reviewRow.state)) {
            costUsd = reviewRow.costUsd ?? reviewRow.reservedUsd
            ledger = "review"
          } else if (localRow && ["settled", "acknowledged"].includes(localRow.state)) {
            costUsd = null
            ledger = "local-review"
          } else {
            continue // Missing proof/records remain conservative; never guess a refund.
          }
          await settleAttempt(ctx, row.ticket, {
            modelCalls: row.ticket.estimate.modelCalls,
            commandCalls: 0,
            activeSeconds: row.result?.activeSeconds ?? row.ticket.estimate.activeSeconds,
            costUsd,
            outcome: "known",
            financialLedgerRef: { ledger, attemptId: id },
          })
        }
      })
    }
    await ctx.storage.write(path, JSON.stringify({ ...requested, complete: true }))
    return getRunUsage(ctx, runId)
  }))
}
