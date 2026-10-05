import type { NextRequest } from "next/server"
import { workflowApi, workflowBody, workflowJson, workflowSnapshot } from "@/lib/server/workflow-api"
import { StartRunInputSchema } from "@/lib/workflows/contracts"
import { startRun } from "@/lib/workflows/coordinator"
export async function POST(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const run = await startRun(ctx, await workflowBody(request, StartRunInputSchema))
    return workflowJson(await workflowSnapshot(ctx, run.id), 202)
  })
}
export async function GET(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const paths = await ctx.storage.list(".scispark/tool-runs/")
    const ids = paths.flatMap(path => { const match = /^\.scispark\/tool-runs\/([0-9a-f-]{36})\/run\.json$/.exec(path); return match ? [match[1]] : [] })
    const runs = await Promise.all(ids.map(id => workflowSnapshot(ctx, id)))
    return workflowJson(runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)))
  })
}
