import type { NextRequest } from "next/server"
import { z } from "zod"
import { UuidSchema } from "@/lib/extensions/contracts"
import { workflowApi, workflowSnapshot } from "@/lib/server/workflow-api"
import { listRunEvents } from "@/lib/workflows/store"
/** Finite NDJSON replay. Reconnect with the last consumed sequence; observation
 * never holds a worker or starts recovery and disconnect has no execution effect. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workflowApi(request, async ctx => {
    const id = UuidSchema.parse((await params).id)
    const raw = request.nextUrl.searchParams.get("after") ?? "0"
    const after = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().nonnegative().safe()).parse(raw)
    await workflowSnapshot(ctx, id)
    const events = await listRunEvents(ctx, id, after)
    return new Response(events.map(e => JSON.stringify(e) + "\n").join(""), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } })
  })
}
