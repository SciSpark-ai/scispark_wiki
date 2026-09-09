import { getServerVault } from "@/lib/server/vault"
import { getSkillTestOverrides } from "@/lib/server/skill-route"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"
import { testConnection } from "@/lib/llm/test-connection"
import { z } from "zod"

export async function POST(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  if (!z.object({}).strict().safeParse(await request.json().catch(() => null)).success) {
    return Response.json({ error: "Invalid connection-test request" }, { status: 400 })
  }
  try {
    return Response.json({ result: await testConnection(await getServerVault(), getSkillTestOverrides().providerOverride) })
  } catch {
    return Response.json({ error: "The connection could not be tested. Check your provider settings and retry." }, { status: 500 })
  }
}
