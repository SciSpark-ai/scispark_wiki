import { getServerVault } from "@/lib/server/vault"
import { actOnReview, reviewSnapshot } from "@/lib/review/coordinator"
import { getSkillTestOverrides } from "@/lib/server/skill-route"
import { ReviewId } from "@/lib/review/contracts"

export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) {
  try { return Response.json(await reviewSnapshot(await getServerVault(), ReviewId.parse((await context.params).id)), { headers: { "cache-control": "no-store" } }) }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not read review" }, { status: 400 }) }
}
export async function POST(request: Request, context: Context) {
  try {
    if (Number(request.headers.get("content-length")) > 500_000) return Response.json({ error: "Review edit is too large" }, { status: 413 })
    const overrides = getSkillTestOverrides()
    const result = await actOnReview(await getServerVault(), ReviewId.parse((await context.params).id), await request.json(),
      { provider: overrides.providerOverride?.strong, search: overrides.searchFn, fetch: overrides.fetchFn })
    return Response.json({ result }, { headers: { "cache-control": "no-store" } })
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not update review" }, { status: 409 }) }
}
