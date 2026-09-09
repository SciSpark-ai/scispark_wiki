import { getServerVault } from "@/lib/server/vault"
import { attachReviewPdf } from "@/lib/review/pdf"
import { ReviewId } from "@/lib/review/contracts"
export const runtime = "nodejs"
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Require a bounded upload before materializing multipart content.
    const size = Number(request.headers.get("content-length"))
    if (!Number.isFinite(size) || size <= 0 || size > 5_100_000) return Response.json({ error: "Choose a PDF up to 5 MB" }, { status: 413 })
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File) || form.get("permission") !== "yes") throw new Error("Confirm you may use this PDF")
    const result = await attachReviewPdf(await getServerVault(), ReviewId.parse((await context.params).id), Number(form.get("revision")),
      { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, title: String(form.get("title") ?? ""), doi: String(form.get("doi") ?? "") })
    return Response.json({ result }, { headers: { "cache-control": "no-store" } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not attach PDF" }, { status: 400 }) }
}
