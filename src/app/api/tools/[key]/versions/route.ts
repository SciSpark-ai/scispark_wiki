import type { NextRequest } from "next/server"
import { workflowApi, workflowJson } from "@/lib/server/workflow-api"
import { ToolKeySchema } from "@/lib/extensions/contracts"
import { listToolVersions } from "@/lib/extensions/versions"
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  return workflowApi(request, async ctx => workflowJson(await listToolVersions(ctx, ToolKeySchema.parse((await context.params).key))))
}
