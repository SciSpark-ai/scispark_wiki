import { getServerVault } from "@/lib/server/vault"
import { getPaperSourceSettings, savePaperSourceSettings, paperSourcePatchSchema } from "@/lib/server/paper-source-settings"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"

const headers = { "Cache-Control": "no-store" }

export async function GET() {
  try {
    return Response.json(await getPaperSourceSettings(), { headers })
  } catch {
    return Response.json({ error: "Could not load paper source settings." }, { status: 500, headers })
  }
}

export async function PUT(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403, headers })
  const parsed = paperSourcePatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose at least one supported source or enter a valid Semantic Scholar API key." }, { status: 400, headers })
  try {
    await savePaperSourceSettings(await getServerVault(), parsed.data)
    return Response.json(await getPaperSourceSettings(), { headers })
  } catch {
    return Response.json({ error: "Could not save paper source settings." }, { status: 500, headers })
  }
}
