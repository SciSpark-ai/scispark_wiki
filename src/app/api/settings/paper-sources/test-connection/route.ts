import { z } from "zod"
import { testS2Connection } from "@/lib/server/paper-source-settings"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403, headers })
  if (!z.object({}).strict().safeParse(await request.json().catch(() => null)).success) {
    return Response.json({ error: "Invalid connection-test request." }, { status: 400, headers })
  }
  try {
    return Response.json({ result: await testS2Connection({ signal: request.signal }) }, { headers })
  } catch {
    return Response.json({ error: "Could not test the saved Semantic Scholar connection." }, { status: 500, headers })
  }
}
