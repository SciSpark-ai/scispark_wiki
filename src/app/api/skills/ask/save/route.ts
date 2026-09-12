import { SaveReadingAnswerSchema } from "@/lib/reader/save-answer-contract"
import { saveAnswerAsQuery } from "@/lib/chat/save-query"
import { getServerVault } from "@/lib/server/vault"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"

export async function POST(req: Request): Promise<Response> {
  const rejected = mutationRequestRejection(req)
  if (rejected) return Response.json({ error: rejected }, { status: 403 })
  const parsed = SaveReadingAnswerSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid reading answer." }, { status: 400 })
  try {
    const { question, answer, citedPageIds, ...readingSource } = parsed.data
    const result = await saveAnswerAsQuery(await getServerVault(), { question, answer, citedPageIds, readingSource })
    return Response.json({ result })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not integrate this answer." }, { status: 500 })
  }
}
