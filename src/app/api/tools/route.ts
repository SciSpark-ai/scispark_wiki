import type { NextRequest } from "next/server"
import { z } from "zod"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { listToolLibrary, applyToolsAction } from "@/lib/extensions/library"
import { ToolsActionSchema } from "@/lib/extensions/ui-contract"
import { ToolSummarySchema } from "@/lib/workflows/contracts"
export async function GET(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const entries = [...request.nextUrl.searchParams]
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return Response.json({ error: "Duplicate Tools query." }, { status: 400 })
    const query = z.object({ view: z.literal("library").optional() }).strict().parse(Object.fromEntries(entries))
    const library = await listToolLibrary(ctx)
    return workflowJson(query.view ? library : library.tools.map(tool => ToolSummarySchema.strip().parse(tool)))
  })
}
export async function POST(request: NextRequest) {
  return workflowApi(request, async ctx => workflowJson(await applyToolsAction(ctx, await workflowBody(request, ToolsActionSchema))))
}
