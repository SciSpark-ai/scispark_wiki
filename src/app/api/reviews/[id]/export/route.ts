import { getServerVault } from "@/lib/server/vault"
import { loadReview } from "@/lib/review/store"
import { exportReview } from "@/lib/review/report"
import { ReviewId } from "@/lib/review/contracts"

export const runtime = "nodejs"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const run = await loadReview(await getServerVault(), ReviewId.parse((await context.params).id))
    const url = new URL(request.url)
    const version = run.versions.find((v) => v.id === url.searchParams.get("version"))
    if (!version) throw new Error("Report version not found")
    const format = url.searchParams.get("format") === "bibtex" ? "bibtex" : "markdown"
    return new Response(exportReview(run, version, format), { headers: {
      "content-type": "text/plain; charset=utf-8", "cache-control": "no-store",
      "content-disposition": `attachment; filename="${run.id}-${version.id}.${format === "bibtex" ? "bib" : "md"}"`,
    } })
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 400 }) }
}
