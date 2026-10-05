import type { NextRequest } from "next/server"
import { UuidSchema } from "@/lib/extensions/contracts"
import { RunActionInputSchema } from "@/lib/workflows/contracts"
import { workflowApi, workflowBody, workflowJson, workflowSnapshot } from "@/lib/server/workflow-api"
import { cancelRun, resumeRun } from "@/lib/workflows/coordinator"
import { extendAllowance } from "@/lib/workflows/usage"
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => {
    const id = UuidSchema.parse((await params).id), input = await workflowBody(request, RunActionInputSchema)
    await workflowSnapshot(ctx, id)
    if (input.action === "cancel") await cancelRun(ctx, id, input.operationId)
    else if (input.action === "resume") await resumeRun(ctx, id, input.operationId)
    else await extendAllowance(ctx, id, input.operationId, input.delta)
    return workflowJson(await workflowSnapshot(ctx, id))
  })
}
