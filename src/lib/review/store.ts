import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { withVaultExclusive } from "../vault/exclusive"
import { BriefInputSchema, ReviewId, ReviewRunSchema, type ReviewRun } from "./contracts"
import { hashReviewData, reviewModel } from "./budget"
import { reviewContext, reviewConversationContext } from "./context"
import { loadSettings, isAiReady } from "../llm/settings"
import { PRICES } from "../llm/pricing"
import { readEnabledPaperSources } from "../papers/source-preferences"
import { deriveTitle, loadSession, saveSession, type ChatMessage } from "../chat/session"

export const REVIEW_DIR = ".scispark/reviews"
export const reviewPath = (id: string) => `${REVIEW_DIR}/${ReviewId.parse(id)}/run.json`
export async function loadReview(storage: VaultStorage, id: string): Promise<ReviewRun> {
  const raw = await storage.read(reviewPath(id))
  if (!raw) throw new Error("Review not found")
  const run = ReviewRunSchema.parse(JSON.parse(raw))
  if (run.id !== id) throw new Error("Review identity mismatch")
  return run
}
export async function updateReview(storage: VaultStorage, id: string, mutate: (run: ReviewRun) => void | Promise<void>) {
  return withVaultExclusive(storage, "review-control", async () => {
    const run = await loadReview(storage, id)
    await mutate(run)
    run.revision++; run.updatedAt = new Date().toISOString()
    await storage.write(reviewPath(id), JSON.stringify(ReviewRunSchema.parse(run)))
    return run
  })
}
export async function appendReviewMessage(storage: VaultStorage, run: ReviewRun, message: ChatMessage) {
  await withVaultExclusive(storage, `chat-${run.sessionId}`, async () => {
    const session = await loadSession(storage, run.sessionId)
    if (!session) throw new Error("The review conversation is unavailable")
    if (message.operationId && session.messages.some((m) => m.operationId === message.operationId)) return
    session.messages.push(message); session.updatedAt = new Date().toISOString()
    await saveSession(storage, session)
  })
}
export async function createReview(storage: VaultStorage, raw: unknown) {
  const input = BriefInputSchema.parse(raw)
  const link = async (run: ReviewRun) => withVaultExclusive(storage, `chat-${input.sessionId}`, async () => {
    const current = await loadSession(storage, input.sessionId) ?? { id: input.sessionId, title: deriveTitle(input.question), createdAt: run.createdAt, updatedAt: run.createdAt, messages: [] }
    if (!current.messages.some((m) => m.operationId === input.operationId)) current.messages.push({ role: "user", content: input.question, operationId: input.operationId })
    if (!current.messages.some((m) => m.operationId === `${run.id}-brief`)) current.messages.push({ role: "assistant", operationId: `${run.id}-brief`,
      content: "Here is the review brief. Adjust the scope or context, then start when you're ready. No research calls have started.", blocks: [{ type: "review", runId: run.id }] })
    current.updatedAt = new Date().toISOString()
    await saveSession(storage, current)
  })
  return withVaultExclusive(storage, "review-control", async () => {
    const id = `review_${hashReviewData({ session: input.sessionId, operation: input.operationId }).slice(0, 32)}`
    if (await storage.read(reviewPath(id))) {
      const old = await loadReview(storage, id)
      if (old.brief.question !== input.question || JSON.stringify(old.brief.sources) !== JSON.stringify(input.sources)) throw new Error("This request already belongs to another review")
      await link(old)
      return old
    }
    const enabled = await readEnabledPaperSources(storage)
    if (input.sources.some((s) => !enabled.includes(s))) throw new Error("One of the requested paper sources is disabled")
    const session = await loadSession(storage, input.sessionId)
    const settings = await loadSettings(storage)
    const target = reviewModel(settings)
    if (!await isAiReady(settings)) throw new Error("Connect your AI in Settings before preparing a review")
    // Do not apply direct-provider tariffs to a third-party endpoint.
    const direct = !settings.baseUrls?.[target.provider as "openai" | "openrouter"] && target.provider !== "openrouter"
    const price = direct && !("engine" in target) ? PRICES[target.model] : null
    const context = [...await reviewContext(storage, input.question, session?.projectId), ...await reviewConversationContext(storage, input.sessionId, input.question)]
    const now = new Date().toISOString()
    const run: ReviewRun = { version: 1, id, sessionId: input.sessionId, revision: 0, createdAt: now, updatedAt: now,
      brief: { question: input.question, scope: "Compare findings and methods, include disagreements, limitations and unanswered questions. Do not assume a date or population restriction.",
        sources: [...new Set(input.sources)], allowanceUsd: 2, usePersonalContext: true, context,
        model: { ...target, rates: price ? { inputPerMillion: price.inPerM, outputPerMillion: price.outPerM } : null },
        ...(session?.projectId ? { projectId: session.projectId } : {}), limits: { searchRounds: 2, papers: 16 } },
      status: "awaiting-approval", stage: "Review brief", approvedRevision: null, ownerPid: null,
      groundingAttempt: 0, checkpoints: {}, evidence: [], versions: [], warnings: [], error: null, completionEvent: false, draft: null, uploads: [], approvals: [] }
    // Write the manifest first. Idempotent create can recover a interrupted chat-link append.
    await storage.write(reviewPath(id), JSON.stringify(ReviewRunSchema.parse(run)))
    await link(run)
    return run
  })
}

/** Publish immutable content before atomically adding it to the manifest.
 * Orphan outputs after a crash are ignored; manifest hashes are verified on read. */
export async function reviewCheckpoint<T>(storage: VaultStorage, id: string, step: string, input: unknown,
  schema: z.ZodType<T>, work: () => Promise<T>): Promise<T> {
  const key = hashReviewData({ step, input })
  const current = await loadReview(storage, id)
  if (current.checkpoints[key]) {
    const raw = await storage.read(`${REVIEW_DIR}/${id}/objects/${current.checkpoints[key]}.json`)
    if (raw === null) throw new Error("Review checkpoint is missing; original run preserved")
    const data = JSON.parse(raw)
    if (hashReviewData(data) !== current.checkpoints[key]) throw new Error("Review checkpoint was changed")
    return schema.parse(data)
  }
  const output = schema.parse(await work())
  const hash = hashReviewData(output)
  await storage.write(`${REVIEW_DIR}/${id}/objects/${hash}.json`, JSON.stringify(output))
  await updateReview(storage, id, (r) => { r.checkpoints[key] = hash })
  return output
}
