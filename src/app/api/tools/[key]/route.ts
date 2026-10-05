import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { ToolKeySchema } from "@/lib/extensions/contracts"
import { ToolMutationSchema, EnvironmentRecordSchema } from "@/lib/extensions/import-contract"
import { applyToolAction, checkToolUpdate, listToolVersions, readToolUpdate, projectToolSetup } from "@/lib/extensions/versions"
type Context = { params: Promise<{ key: string }> }
export async function GET(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => {
    const key = ToolKeySchema.parse((await context.params).key)
    const versions = await listToolVersions(ctx, key)
    // Network errors do not make retained management state unreadable.
    const update = await checkToolUpdate(ctx, key).catch(() => null)
    return workflowJson({ versions, update, pendingUpdate: await readToolUpdate(ctx, key) })
  })
}
export async function POST(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => {
    const key = ToolKeySchema.parse((await context.params).key)
    const action = await workflowBody(request, ToolMutationSchema)
    const result = await applyToolAction(ctx, key, action)
    return workflowJson(action.action === "acknowledge-and-discard-setup" ? projectToolSetup(EnvironmentRecordSchema.parse(result)) : result)
  })
}
