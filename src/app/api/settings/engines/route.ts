import { z } from "zod"
import { LocalEngineSchema } from "@/lib/engines/contracts"
import { localEngineStatus } from "@/lib/engines/status"
import { codexModels } from "@/lib/engines/models"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"

export const runtime = "nodejs"
/** POST makes CLI inspection opt-in, protected by the same-origin boundary.
 * No inference, login mutation, token material or account email is returned. */
export async function POST(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  const parsed = z.object({ engine: LocalEngineSchema }).strict().safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose Codex or Claude Code." }, { status: 400 })
  const status = await localEngineStatus(parsed.data.engine)
  if (status.engine === "codex" && status.state === "ready") {
    try { status.models = await codexModels(true) }
    catch { status.modelsError = "Could not load available models from this Codex CLI. Check the connection again." }
  }
  return Response.json({ status }, { headers: { "Cache-Control": "no-store" } })
}
