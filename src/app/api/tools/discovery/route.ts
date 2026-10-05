import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson } from "@/lib/server/workflow-api"
import { applyDiscoveryAction, readDiscoveryResults } from "@/lib/extensions/discovery"
import { DiscoveryActionSchema, DiscoveryGrantDtoSchema, DiscoveryQuerySchema, DiscoveryStageDtoSchema } from "@/lib/extensions/import-contract"
export async function GET(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const entries = [...request.nextUrl.searchParams]
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return Response.json({ error: "Duplicate discovery query." }, { status: 400 })
    const query = DiscoveryQuerySchema.parse(Object.fromEntries(entries))
    return workflowJson(await readDiscoveryResults(ctx, query.grantId))
  })
}
export async function POST(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const action = await workflowBody(request, DiscoveryActionSchema), result = await applyDiscoveryAction(ctx, action)
    if (action.action === "grant") return workflowJson(DiscoveryGrantDtoSchema.strip().parse(result))
    if (action.action === "stage") return workflowJson(DiscoveryStageDtoSchema.strip().parse(result))
    return workflowJson(result)
  })
}
