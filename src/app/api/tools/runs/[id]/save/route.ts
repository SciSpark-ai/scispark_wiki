import type { NextRequest } from "next/server"
import { UuidSchema } from "@/lib/extensions/contracts"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { SaveRunInputSchema } from "@/lib/workflows/contracts"
import { saveRunToWiki } from "@/lib/workflows/wiki-save"
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => {
    const id = UuidSchema.parse((await params).id), input = await workflowBody(request, SaveRunInputSchema)
    return workflowJson(await saveRunToWiki(ctx, id, input.artifactIds, input.operationId))
  })
}
