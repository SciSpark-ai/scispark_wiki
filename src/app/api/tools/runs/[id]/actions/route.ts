import type { NextRequest } from "next/server"
import { UuidSchema } from "@/lib/extensions/contracts"
import { RunActionInputSchema } from "@/lib/workflows/contracts"
import { workflowApi, workflowBody, workflowJson, workflowSnapshot } from "@/lib/server/workflow-api"
import { cancelRun, resumeRun, chooseHelper, resolveUncertain, reconcileWiki, reconcileAccounting } from "@/lib/workflows/coordinator"
import { extendAllowance } from "@/lib/workflows/usage"
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => {
    const id = UuidSchema.parse((await params).id), input = await workflowBody(request, RunActionInputSchema)
    await workflowSnapshot(ctx, id)
    if (input.action === "cancel") await cancelRun(ctx, id, input.operationId)
    else if (input.action === "resume") await resumeRun(ctx, id, input.operationId)
    else if (input.action === "choose-helper") await chooseHelper(ctx, id, input.choiceId, input.tool, input.operationId)
    else if (input.action === "resolve-uncertain") await resolveUncertain(ctx, id, input.operationId, input.stepId, input.resolution)
    else if (input.action === "native-review") await (await import("@/lib/server/native-workflow")).continueNativeReview(ctx, id, input.operationId, input.resolution)
    else if (input.action === "reconcile-accounting") await reconcileAccounting(ctx, id, input.operationId, input.resolution)
    else if (input.action === "reconcile-wiki") await reconcileWiki(ctx, id, input.changesetId, input.operationId)
    else await extendAllowance(ctx, id, input.operationId, input.delta)
    return workflowJson(await workflowSnapshot(ctx, id))
  })
}
