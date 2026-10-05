import type { NextRequest } from "next/server"
import { workflowApi, workflowJson } from "@/lib/server/workflow-api"
import { readProfileTools } from "@/lib/extensions/store"
import { getToolManifest } from "@/lib/extensions/registry"
import { NATIVE_TOOL_MANIFESTS } from "@/lib/extensions/native-catalog"
import { toolKey } from "@/lib/extensions/contracts"
import { ToolSummarySchema } from "@/lib/workflows/contracts"
export async function GET(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const state = await readProfileTools(ctx)
    // Curated native choices are shared. Imported choices need an owning
    // profile binding/pin, including disabled installations for management.
    const refs = new Map(NATIVE_TOOL_MANIFESTS.map(m => [toolKey(m.ref), m.ref]))
    for (const ref of state?.pins ?? []) refs.set(toolKey(ref), ref)
    for (const binding of state?.enabled ?? []) refs.set(toolKey(binding.tool), binding.tool)
    const tools = [...refs.values()].flatMap(ref => {
      const manifest = getToolManifest(ref)
      const enabled = state?.enabled.some(b => b.enabled && JSON.stringify(b.tool) === JSON.stringify(ref)) ?? false
      return manifest ? [ToolSummarySchema.strip().parse({ ...manifest, enabled })] : []
    })
    return workflowJson(tools)
  })
}
