import { z } from "zod"
import { FeedbackReasonSchema } from "@/lib/recommendation/contract"
import { readRecommendationFeedback, recordRecommendationFeedback, clearRecommendationFeedback, feedbackRevision, RecommendationFeedbackError } from "@/lib/recommendation/feedback"
import { getServerVault } from "@/lib/server/vault"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"
import { ChangesetConflictError } from "@/lib/vault/changesets"

const Input = z.object({ paperKey: z.string().min(1).max(500), reason: FeedbackReasonSchema,
  note: z.string().trim().max(600).optional(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
}).strict().refine((value) => value.reason !== "other" || Boolean(value.note), { message: "Tell Sparky what missed the mark." })

export async function GET() {
  const { entries, warning } = await readRecommendationFeedback(await getServerVault())
  return Response.json({ entries: entries.map((entry) => ({ ...entry, revision: feedbackRevision(entry) })), warning })
}

export async function DELETE(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  const input = z.object({ paperKey: z.string().min(1).max(500), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: "Invalid feedback request" }, { status: 400 })
  try {
    return Response.json(await clearRecommendationFeedback(await getServerVault(), input.data.paperKey, input.data.expectedRevision))
  } catch (error) {
    const status = error instanceof RecommendationFeedbackError ? error.status : error instanceof ChangesetConflictError ? 409 : 500
    return Response.json({ error: status === 500 ? "Feedback could not be cleared. Please try again." : (error as Error).message }, { status })
  }
}

export async function POST(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }) }
  const input = Input.safeParse(body)
  if (!input.success) return Response.json({ error: "Invalid feedback request" }, { status: 400 })
  try {
    return Response.json(await recordRecommendationFeedback(await getServerVault(), input.data.paperKey, input.data.reason, new Date(), input.data))
  } catch (error) {
    const status = error instanceof RecommendationFeedbackError ? error.status : error instanceof ChangesetConflictError ? 409 : 500
    return Response.json({ error: status === 500 ? "Feedback could not be saved. Please try again." : (error as Error).message }, { status })
  }
}
