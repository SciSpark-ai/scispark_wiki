import type { NextRequest } from "next/server"
import { UuidSchema } from "@/lib/extensions/contracts"
import { workflowApi, workflowJson, workflowSnapshot } from "@/lib/server/workflow-api"
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => workflowJson(await workflowSnapshot(ctx, UuidSchema.parse((await params).id))))
}
