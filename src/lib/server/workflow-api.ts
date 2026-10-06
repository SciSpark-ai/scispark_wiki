import { ManagementHistoryFullError } from "../extensions/store"
import { ChangesetRecoveryConflictError } from "../vault/changesets"
import { z } from "zod"
import type { NextRequest } from "next/server"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../local-profile-contract"
import { getProfileSession } from "./local-profiles"
import { mutationRequestRejection } from "./mutation-request-security"
import { resolveWorkflowContext, type WorkflowContext } from "../workflows/context"
import { workflowPublicText, workflowPublicPhase, ToolRunDtoSchema } from "../workflows/contracts"
import { checkpointRecovery, uncertainCheckpoints, projectWorkflowRun } from "../workflows/journal"
import { projectRunUsage } from "../workflows/usage"

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export const workflowJson = (result: unknown, status = 200) => Response.json({ result }, { status, headers: { "cache-control": "no-store" } })
/** Defense in depth uses the exact proxy mutation guard and authenticated ownership. */
export async function workflowApi(request: NextRequest, work: (ctx: WorkflowContext) => Promise<Response>): Promise<Response> {
  try {
    const rejection = mutationRequestRejection(request)
    if (rejection) throw new HttpError(403, rejection)
    const profile = await getProfileSession(request.cookies.get(PROFILE_COOKIE)?.value)
    if (!profile || request.headers.get(PROFILE_HEADER) !== profile.id) return Response.json({ error: "Open your local profile to continue." }, {
      status: profile ? 409 : 401, headers: { "cache-control": "no-store", "x-scispark-session-expired": "1" },
    })
    return await work(await resolveWorkflowContext(profile, process.env, request.method === "GET"))
  } catch (error) {
    if (error instanceof ManagementHistoryFullError) return Response.json({ error: error.message, code: error.code }, { status: 409, headers: { "cache-control": "no-store" } })
    if (error instanceof ChangesetRecoveryConflictError) return Response.json({
      error: "A pending wiki save conflicts with edited pages. Review its preserved recovery record before retrying.",
      code: error.code, runId: error.runId, changesetId: error.changesetId, conflicts: error.conflicts,
    }, { status: 409, headers: { "cache-control": "no-store" } })
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : error instanceof Error && error.message === "Workflow run not found" ? 404 : 409
    // Provider/configuration and filesystem errors are never returned verbatim.
    return Response.json({ error: status === 413 ? "Request exceeds 64 KiB." : status === 400 ? "Invalid workflow request." : status === 404 ? "Workflow run not found." : "The workflow request could not be applied. Refresh its saved state." }, { status, headers: { "cache-control": "no-store" } })
  }
}
/** Count actual streamed bytes, including requests with no or misleading Content-Length. */
export async function workflowBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, "Body required")
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 65536) { await reader.cancel(); throw new HttpError(413, "Body too large") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(bytes); let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)))
}
export async function workflowSnapshot(ctx: WorkflowContext, id: string) {
  const run = await projectWorkflowRun(ctx, id)
  const [{ detailedUsage, ...usage }, events, saves, steps] = await Promise.all([
    projectRunUsage(ctx, id), (await import("../workflows/store")).listRunEvents(ctx, id, 0),
    (await import("../workflows/wiki-save")).projectWorkflowSaves(ctx, id), uncertainCheckpoints(ctx, id),
  ])
  const text = events.filter(e => e.seq <= run.eventCursor).filter(e => e.type === "text").map(e => workflowPublicText(e.text)).filter(text => text !== null).at(-1) ?? ""
  const diagnostics = events.filter(e => e.type === "error").map(e => e.message)
  const uncertainSteps = await Promise.all(steps.map(async step => ({ id: step.intent.id, kind: step.intent.kind, ...await checkpointRecovery(ctx, id, step.intent) })))
  let choice, nativeReview
  if (run.status === "waiting_for_choice") {
    const { readHostContinuation, resolveHostManifest } = await import("../workflows/host-tools")
    const continuation = await readHostContinuation(ctx, id)
    const waiting = continuation?.waitingChoice
    if (waiting) choice = { id: waiting.id, prompt: "Choose a supporting skill", candidates: await Promise.all(waiting.candidates.map(async tool => {
      let label = tool.skillId
      try { label = (await resolveHostManifest(ctx, tool)).name } catch { /* Retained run history remains readable if a snapshot is unavailable. */ }
      return { tool, label }
    })) }
  }
  if (!uncertainSteps.some(step => step.recovery?.kind === "native_revision") && run.nativeRunRef?.kind === "deep-review" && ["waiting_for_choice", "needs_attention", "paused_limit", "interrupted", "waiting_for_setup"].includes(run.status)) {
    const review = await (await import("../review/store")).loadReview(ctx.storage, run.nativeRunRef.id)
    const limited = review.status === "partial" && review.versions.at(-1)?.verification === "checked-draft" && review.versions.at(-1)?.answerCoverage?.status === "limited"
    nativeReview = { retry: ["awaiting-approval", "paused", "interrupted", "failed", "partial"].includes(review.status) && !limited,
      keep: ["partial", "paused", "interrupted", "failed", "completed"].includes(review.status) && review.versions.length > 0 }
  }
  return ToolRunDtoSchema.strip().parse({ ...run, ...usage, observation: {
    text, phase: events.filter(e => e.seq <= run.eventCursor && e.type === "text").map(e => e.type === "text" ? workflowPublicPhase(e.text) : undefined).filter(Boolean).at(-1), usage: detailedUsage, choice, nativeReview, ...saves, diagnostics,
    uncertainSteps,
  } })
}
