import type { NextRequest } from "next/server"
import { workflowApi, workflowJson } from "@/lib/server/workflow-api"
import { readProfileTools, readImportedManifests } from "@/lib/extensions/store"
import { getToolManifest } from "@/lib/extensions/registry"
import { NATIVE_TOOL_MANIFESTS } from "@/lib/extensions/native-catalog"
import { toolKey } from "@/lib/extensions/contracts"
import { checkToolUpdate } from "@/lib/extensions/versions"
import { ToolSummarySchema } from "@/lib/workflows/contracts"
export async function GET(request: NextRequest) {
  return workflowApi(request, async ctx => {
    const state = await readProfileTools(ctx)
    // Curated native choices are shared. Imported choices need an owning
    // profile binding/pin, including disabled installations for management.
    const refs = new Map(NATIVE_TOOL_MANIFESTS.map(m => [toolKey(m.ref), m.ref]))
    for (const ref of state?.pins ?? []) refs.set(toolKey(ref), ref)
    for (const binding of state?.enabled ?? []) refs.set(toolKey(binding.tool), binding.tool)
    const imports = [...refs.values()].some(ref => !getToolManifest(ref)) ? await readImportedManifests(ctx) : []
    const tools = [...refs.values()].flatMap(ref => {
      const manifest = getToolManifest(ref) ?? imports.find(m => JSON.stringify(m.ref) === JSON.stringify(ref))
      const enabled = state?.enabled.some(b => b.enabled && JSON.stringify(b.tool) === JSON.stringify(ref)) ?? false
      return manifest ? [ToolSummarySchema.strip().parse({ ...manifest, enabled })] : []
    })
    // Opening Tools checks only metadata of already approved remote origins.
    // Local/agent sources are never touched here. Failures retain saved tools.
    for (const tool of tools) if (tool.kind !== "native") await checkToolUpdate(ctx, toolKey(tool.ref)).catch(() => null)
    return workflowJson(tools)
  })
}
