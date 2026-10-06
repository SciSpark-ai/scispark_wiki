import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { ToolKeySchema } from "@/lib/extensions/contracts"
import { ToolMutationSchema, EnvironmentRecordSchema } from "@/lib/extensions/import-contract"
import { applyToolAction, listToolVersions, readSavedToolMetadata, readToolUpdate, projectToolSetup } from "@/lib/extensions/versions"
type Context = { params: Promise<{ key: string }> }
export async function GET(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => {
    const key = ToolKeySchema.parse((await context.params).key)
    const versions = await listToolVersions(ctx, key)
    // Saved preview observation must never reread a source.
    const update = await readSavedToolMetadata(ctx, key)
    return workflowJson({ versions, update, pendingUpdate: await readToolUpdate(ctx, key) })
  })
}
export async function POST(request: NextRequest, context: Context) {
  return workflowApi(request, async ctx => {
    const key = ToolKeySchema.parse((await context.params).key)
    const action = await workflowBody(request, ToolMutationSchema)
    let result
    try { result = await applyToolAction(ctx, key, action) }
    catch (error) {
      const message = error instanceof Error ? error.message : ""
      const actionable = ["Original source needs explicit re-import", "Original inspected proposal is unavailable; re-import explicitly"].includes(message)
        ? "Re-import this tool from Add tools to review its current source and setup."
        : message === "Renew original package read consent before checking updates" ? "Allow access to the exact original package folder, then check again."
        : ["Updated tool environment needs setup", "Tool is not ready; review access and setup requirements"].includes(message) ? "Review the saved setup requirements before enabling or applying this tool." : null
      if (actionable) return Response.json({ error: actionable }, { status: 409, headers: { "cache-control": "no-store" } })
      throw error
    }
    return workflowJson(action.action === "acknowledge-and-discard-setup" ? projectToolSetup(EnvironmentRecordSchema.parse(result)) : result)
  })
}
