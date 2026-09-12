import { z } from "zod"
import { LocalEngineSchema } from "@/lib/engines/contracts"
import { localEngineStatus } from "@/lib/engines/status"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"

export const runtime = "nodejs"
/** POST makes CLI inspection opt-in, protected by the same-origin boundary.
 * No inference, login mutation, token material or account email is returned. */
export async function POST(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  const parsed = z.object({ engine: LocalEngineSchema }).strict().safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose Codex or Claude Code." }, { status: 400 })
  return Response.json({ status: await localEngineStatus(parsed.data.engine) }, { headers: { "Cache-Control": "no-store" } })
}
