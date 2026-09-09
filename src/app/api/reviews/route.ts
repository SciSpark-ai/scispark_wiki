import { getServerVault } from "@/lib/server/vault"
import { createReview } from "@/lib/review/store"

export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 20_000) return Response.json({ error: "Review request is too large" }, { status: 413 })
    const run = await createReview(await getServerVault(), await request.json())
    return Response.json({ run }, { headers: { "cache-control": "no-store" } })
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not prepare review" }, { status: 400 }) }
}
