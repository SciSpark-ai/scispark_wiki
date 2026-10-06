import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { UuidSchema } from "@/lib/extensions/contracts"
import { ImportActionSchema } from "@/lib/extensions/ui-contract"
import { actOnImport, inspectImportState, ImportPrerequisiteError } from "@/lib/extensions/import-ui"
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => workflowJson(await inspectImportState(ctx, UuidSchema.parse((await context.params).id))))
}
export async function POST(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => {
    try { return workflowJson(await actOnImport(ctx, UuidSchema.parse((await context.params).id), await workflowBody(request, ImportActionSchema))) }
    catch (error) {
      if (error instanceof ImportPrerequisiteError) return Response.json({ error: error.message }, { status: 409, headers: { "cache-control": "no-store" } })
      throw error
    }
  })
}
