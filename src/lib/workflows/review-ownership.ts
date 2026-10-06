import { ReviewId } from "../review/contracts"
import type { WorkflowContext } from "./context"
import { leaseOwnerAlive, readWorkflowJournal } from "./journal"
import { getRunUsage } from "./usage"

/** Caller holds workflow-coordinator. Existing start receipts and native frame
 * continuations are the bindings; there is no second owner index or worker lock. */
export async function assertNativeReviewAdmission(ctx: WorkflowContext, reviewId: string, ownRootId?: string) {
  ReviewId.parse(reviewId)
  const { restoreAndListWorkflowRuns } = await import("./coordinator")
  const { NativeReviewContinuationSchema } = await import("../extensions/native-adapters")
  for (const run of await restoreAndListWorkflowRuns(ctx)) {
    if (run.id === ownRootId) continue
    let owns = run.nativeRunRef?.kind === "deep-review" && run.nativeRunRef.id === reviewId
    const prefix = `.scispark/tool-runs/${run.id}/native-review-`
    for (const path of await ctx.storage.list(prefix)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(path.slice(prefix.length))) continue
      if (NativeReviewContinuationSchema.parse(JSON.parse((await ctx.storage.read(path))!)).reviewId === reviewId) owns = true
    }
    if (!owns) continue
    const journal = await readWorkflowJournal(ctx, run.id)
    if (!["completed", "failed", "cancelled"].includes(journal.status) || leaseOwnerAlive(journal.lease) || journal.cancelRequested || (await getRunUsage(ctx, run.id)).uncertain) {
      throw new Error("Resolve the owning workflow before starting more review work")
    }
    // Explicitly stopped terminal checkpoints remain audit evidence. A new
    // envelope never resumes them, and financial uncertainty still blocks above.
  }
}
