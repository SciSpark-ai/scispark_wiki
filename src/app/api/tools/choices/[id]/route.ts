import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson, workflowSnapshot } from "@/lib/server/workflow-api"
import { ChooseToolInputSchema, UuidSchema } from "@/lib/extensions/contracts"
import { chooseTool, ToolChoiceConflict } from "@/lib/extensions/choice-store"
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => {
    const id = UuidSchema.parse((await context.params).id), input = await workflowBody(request, ChooseToolInputSchema)
    try {
      const run = await chooseTool(ctx, id, input.tool, input.operationId)
      return workflowJson(await workflowSnapshot(ctx, run.id))
    } catch (error) {
      if (error instanceof ToolChoiceConflict) return Response.json({ error: error.message, choice: error.choice }, { status: 409, headers: { "cache-control": "no-store" } })
      throw error
    }
  })
}
