import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { UuidSchema } from "@/lib/extensions/contracts"
import { ImportActionSchema } from "@/lib/extensions/ui-contract"
import { actOnImport, inspectImportState } from "@/lib/extensions/import-ui"
type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => workflowJson(await inspectImportState(ctx, UuidSchema.parse((await context.params).id))))
}
export async function POST(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => workflowJson(await actOnImport(ctx, UuidSchema.parse((await context.params).id), await workflowBody(request, ImportActionSchema))))
}
