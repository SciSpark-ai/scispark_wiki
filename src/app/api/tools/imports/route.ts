import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { ImportRequestSchema } from "@/lib/extensions/ui-contract"
import { previewImport, previewZipUpload } from "@/lib/extensions/import-ui"
export async function POST(request: NextRequest) {
  return workflowApi(request, async ctx => {
    if (request.headers.get("content-type")?.split(";")[0] === "application/zip") {
      const preview = await previewZipUpload(ctx, request)
      return preview instanceof Response ? preview : workflowJson(preview)
    }
    const input = await workflowBody(request, ImportRequestSchema)
    try { return workflowJson(await previewImport(ctx, input)) }
    catch { return Response.json({ error: "Could not inspect this source. Check the selected folder or repository, its access and package structure." }, { status: 409, headers: { "cache-control": "no-store" } }) }
  })
}
