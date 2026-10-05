import type { NextRequest } from "next/server"
import { workflowApi } from "@/lib/server/workflow-api"
import { readArtifact } from "@/lib/workflows/artifacts"
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  return workflowApi(request, async ctx => {
    const { id, artifactId } = await params
    const { metadata, bytes } = await readArtifact(ctx, id, artifactId)
    // All payloads download as attachments. HTML/SVG never become same-origin UI.
    const extension = metadata.kind === "markdown" ? "md" : metadata.kind === "bibtex" ? "bib" : "bin"
    return new Response(new Uint8Array(bytes), { headers: {
      "content-type": metadata.mediaType, "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="artifact-${metadata.id}.${extension}"`,
      "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "no-store",
    } })
  })
}
